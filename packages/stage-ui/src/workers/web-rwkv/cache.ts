/**
 * OPFS (Origin Private File System) cache for converted web-rwkv weights.
 *
 * The worker normally fetches a safetensors checkpoint over HTTP Range and casts
 * every tensor to f16 (see `./safetensors`) on each load — hundreds of MB of
 * download plus a CPU cast, repeated on every page reload. This module persists
 * the *converted* f16 tensors to OPFS so subsequent loads skip both the network
 * and the cast.
 *
 * Why f16 (not the raw checkpoint): the cast is one-way and lossy-shaped (bf16/f32
 * → f16), so caching the converted bytes is half the disk of an f32 checkpoint and
 * removes the per-load cast. Why OPFS (not localStorage/Cache API): weights are
 * tens of MB to multi-GB — far past localStorage's ~5 MB string quota — and the
 * worker-only synchronous access handle gives fast random-access writes/reads
 * without buffering the whole model in JS.
 *
 * File layout (one file per model):
 *
 *   [ tensor data, concatenated in write order ]
 *   [ index JSON: { v, tensors: [{ name, shape, offset, byteLength }, …] } ]
 *   [ 8-byte footer: index JSON byte length (little-endian u64) ]
 *
 * The index is written last (its size isn't known until all tensors are in), and
 * a read validates the footer + total size before trusting the file, so an
 * aborted/partial write is detected and re-downloaded rather than read as garbage.
 *
 * This module is pure IO + serialization (no wasm): it deals in plain
 * {@link CachedTensor} parts and lets the worker construct wasm `Tensor`s via the
 * mapper passed to {@link readCachedModel}, keeping the cache decoupled from the
 * model runtime and avoiding a second full-model copy on the hit path.
 */

/** Serializable form of one converted weight tensor (little-endian f16 bytes). */
export interface CachedTensor {
  /** Tensor name as it appears in the safetensors header. */
  name: string
  /** Oriented (post-transpose) row-major shape. */
  shape: number[]
  /** Little-endian f16 bytes (2 bytes/element). */
  data: Uint8Array
}

/**
 * Write sink for streaming converted tensors to OPFS during a model download.
 *
 * Tensors are written through as they are produced (no full-model buffering);
 * {@link ModelCacheWriter.finalize} appends the index + footer to commit the file,
 * and {@link ModelCacheWriter.abort} discards a partial file on error/abort.
 */
export interface ModelCacheWriter {
  /**
   * Persist one tensor's f16 bytes. `index` is its header order (so the index is
   * emitted in header order regardless of which concurrent fetch finished first);
   * the on-disk byte offset is assigned in call order.
   */
  add: (index: number, tensor: CachedTensor) => void
  /** Append the index + footer and close the file, committing the cache entry. */
  finalize: () => Promise<void>
  /** Close and delete the (partial) file. Safe to call after any failure. */
  abort: () => Promise<void>
}

/** Per-tensor record in the on-disk index. */
interface IndexEntry {
  name: string
  shape: number[]
  offset: number
  byteLength: number
}

/** Bump when the on-disk layout changes; older files then fail validation and re-download. */
const FORMAT_VERSION = 1
/** Footer is a single little-endian u64 holding the index JSON byte length. */
const FOOTER_BYTES = 8
/** OPFS subdirectory holding one file per cached model. */
const CACHE_DIR = 'web-rwkv'

/**
 * Minimal synchronous access handle shape (worker-only OPFS API). Declared
 * locally so the cache compiles regardless of whether the ambient DOM lib in use
 * includes `FileSystemSyncAccessHandle`.
 */
interface SyncAccessHandle {
  read: (buffer: AllowSharedBufferSource, options?: { at?: number }) => number
  write: (buffer: AllowSharedBufferSource, options?: { at?: number }) => number
  truncate: (newSize: number) => void
  getSize: () => number
  flush: () => void
  close: () => void
}

type FileHandleWithSync = FileSystemFileHandle & {
  createSyncAccessHandle: () => Promise<SyncAccessHandle>
}

/** OPFS + worker-only sync access handles are required; otherwise caching is skipped. */
function opfsAvailable(): boolean {
  return typeof navigator !== 'undefined'
    && !!navigator.storage
    && typeof navigator.storage.getDirectory === 'function'
}

/** Open (optionally creating) the model cache directory in OPFS. */
async function openCacheDir(create: boolean): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory()
  return root.getDirectoryHandle(CACHE_DIR, { create })
}

/** Cache filename for a model key. */
function cacheFileName(key: string): string {
  return `${key}.f16cache`
}

/**
 * Derive a stable, filesystem-safe cache key from a model URL.
 *
 * Use when:
 * - Keying {@link createCacheWriter}/{@link readCachedModel} for a model.
 *
 * Expects:
 * - The *stable* model URL (e.g. an HF `resolve/main` URL), not a signed CDN URL —
 *   signed URLs carry per-request query params and would never cache-hit.
 *
 * Returns:
 * - The lowercase hex SHA-256 of the URL.
 */
export async function cacheKeyForModel(modelUrl: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(modelUrl))
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
}

/** No-op writer used when OPFS is unavailable or the file can't be opened. */
const NOOP_WRITER: ModelCacheWriter = {
  add() {},
  async finalize() {},
  async abort() {},
}

/**
 * Open a streaming OPFS writer for a model's converted f16 tensors.
 *
 * Use when:
 * - About to download + convert a model whose weights should be cached.
 *
 * Returns:
 * - A {@link ModelCacheWriter}. Falls back to a no-op writer when OPFS is
 *   unavailable, or when the file is already locked (e.g. a concurrent load of the
 *   same model) — caching is best-effort and never blocks the load.
 */
export async function createCacheWriter(key: string): Promise<ModelCacheWriter> {
  if (!opfsAvailable()) {
    console.warn('[web-rwkv:cache] OPFS unavailable; weights will not be cached')
    return NOOP_WRITER
  }

  let handle: SyncAccessHandle
  try {
    const dir = await openCacheDir(true)
    const fileHandle = await dir.getFileHandle(cacheFileName(key), { create: true }) as FileHandleWithSync
    if (typeof fileHandle.createSyncAccessHandle !== 'function') {
      console.warn('[web-rwkv:cache] createSyncAccessHandle unavailable here (worker-only API); weights will not be cached')
      return NOOP_WRITER
    }
    handle = await fileHandle.createSyncAccessHandle()
    handle.truncate(0)
  }
  catch (error) {
    console.warn('[web-rwkv:cache] could not open cache file for writing; weights will not be cached', error)
    return NOOP_WRITER
  }

  // Caching is best-effort: a write failure (quota, lock, …) must never break the
  // model load. The first failure latches `failed`, disabling further writes; the
  // partial file is dropped on finalize.
  let failed = false
  // Cursor and index live in closure state; `add` runs synchronously between
  // awaits in the worker's concurrent fetch loop, so offset assignment is atomic.
  let cursor = 0
  const entries: IndexEntry[] = []

  async function deleteFile(): Promise<void> {
    try {
      const dir = await openCacheDir(false)
      await dir.removeEntry(cacheFileName(key))
    }
    catch {}
  }

  function closeHandle(): void {
    try {
      handle.close()
    }
    catch {}
  }

  return {
    add(index, tensor) {
      if (failed)
        return
      try {
        const byteLength = tensor.data.byteLength
        const offset = cursor
        handle.write(tensor.data, { at: offset })
        cursor += byteLength
        // Slot by header index so the index array is in header order regardless of
        // which concurrent write landed first.
        entries[index] = { name: tensor.name, shape: tensor.shape, offset, byteLength }
      }
      catch (error) {
        failed = true
        console.warn('[web-rwkv:cache] tensor write failed; disabling cache for this load', error)
      }
    },
    async finalize() {
      if (failed) {
        closeHandle()
        await deleteFile()
        return
      }
      try {
        const indexBytes = new TextEncoder().encode(JSON.stringify({ v: FORMAT_VERSION, tensors: entries }))
        handle.write(indexBytes, { at: cursor })
        const footer = new DataView(new ArrayBuffer(FOOTER_BYTES))
        footer.setBigUint64(0, BigInt(indexBytes.byteLength), true)
        handle.write(new Uint8Array(footer.buffer), { at: cursor + indexBytes.byteLength })
        handle.flush()
        handle.close()
        console.info(`[web-rwkv:cache] cached ${entries.length} tensors (${cursor} bytes) for ${key.slice(0, 12)}…`)

        // Single-slot eviction guarantee: clean up any other .f16cache files in OPFS so
        // only the newly finalized model remains cached on disk.
        try {
          const dir = await openCacheDir(false)
          const currentFileName = cacheFileName(key)
          for await (const entry of (dir as any).values()) {
            if (entry.kind === 'file' && entry.name.endsWith('.f16cache') && entry.name !== currentFileName) {
              console.info(`[web-rwkv:cache] single-slot eviction: removing previous model cache ${entry.name}`)
              await dir.removeEntry(entry.name)
            }
          }
        }
        catch (evictErr) {
          console.warn('[web-rwkv:cache] single-slot eviction notice:', evictErr)
        }
      }
      catch (error) {
        console.warn('[web-rwkv:cache] finalize failed; dropping partial cache file', error)
        closeHandle()
        await deleteFile()
      }
    },
    async abort() {
      closeHandle()
      await deleteFile()
    },
  }
}

/**
 * Read a cached model's converted f16 tensors, in header order.
 *
 * Use when:
 * - Loading a model, to skip the download + f16 cast on a cache hit.
 *
 * Expects:
 * - `mapTensor` builds the caller's per-tensor value (e.g. a wasm `Tensor`). It is
 *   called once per tensor as the bytes are read; the temporary {@link CachedTensor}
 *   is dropped afterward, so the full model is never held twice in memory.
 *
 * Returns:
 * - The mapped tensors in header order, or `null` on a miss (no file) or any
 *   validation failure (corrupt/partial/old-format file — which is then deleted).
 *
 * @typeParam T - The per-tensor value produced by `mapTensor`.
 */
export async function readCachedModel<T>(key: string, mapTensor: (tensor: CachedTensor) => T): Promise<T[] | null> {
  if (!opfsAvailable())
    return null

  // A missing dir/file is a normal miss (first load, or after a clear); resolve it
  // quietly and separately from the corrupt-file path below, which warns + deletes.
  let dir: FileSystemDirectoryHandle
  let fileHandle: FileHandleWithSync
  try {
    dir = await openCacheDir(false)
    fileHandle = await dir.getFileHandle(cacheFileName(key)) as FileHandleWithSync
  }
  catch {
    console.info(`[web-rwkv:cache] miss for ${key.slice(0, 12)}… (no cached file yet)`)
    return null
  }

  let handle: SyncAccessHandle | undefined
  try {
    handle = await fileHandle.createSyncAccessHandle()

    const size = handle.getSize()
    if (size < FOOTER_BYTES)
      throw new Error('web-rwkv cache: file smaller than footer')

    const footer = new Uint8Array(FOOTER_BYTES)
    handle.read(footer, { at: size - FOOTER_BYTES })
    const indexLen = Number(new DataView(footer.buffer).getBigUint64(0, true))
    if (indexLen <= 0 || indexLen > size - FOOTER_BYTES)
      throw new Error('web-rwkv cache: implausible index length')

    const dataEnd = size - FOOTER_BYTES - indexLen
    const indexBytes = new Uint8Array(indexLen)
    handle.read(indexBytes, { at: dataEnd })
    const parsed = JSON.parse(new TextDecoder().decode(indexBytes)) as { v: number, tensors: IndexEntry[] }
    if (parsed.v !== FORMAT_VERSION || !Array.isArray(parsed.tensors))
      throw new Error('web-rwkv cache: unsupported format')

    // The data block must exactly fill the space before the index — guards against
    // a truncated/partial file whose footer happens to parse.
    const dataBytes = parsed.tensors.reduce((sum, e) => sum + e.byteLength, 0)
    if (dataBytes !== dataEnd)
      throw new Error('web-rwkv cache: data size mismatch')

    const mapped = parsed.tensors.map((entry) => {
      const data = new Uint8Array(entry.byteLength)
      handle!.read(data, { at: entry.offset })
      return mapTensor({ name: entry.name, shape: entry.shape, data })
    })
    handle.close()
    console.info(`[web-rwkv:cache] hit for ${key.slice(0, 12)}… (${parsed.tensors.length} tensors, ${dataEnd} bytes)`)
    return mapped
  }
  catch (error) {
    try {
      handle?.close()
    }
    catch {}
    // Drop a corrupt/partial/old-format file so the next load re-downloads cleanly.
    console.warn('[web-rwkv:cache] cached file unusable; dropping and re-downloading', error)
    try {
      await dir.removeEntry(cacheFileName(key))
    }
    catch {}
    return null
  }
}

/** Cache filename for a raw prefab binary. */
function prefabCacheFileName(key: string): string {
  return `${key}.prefabcache`
}

/**
 * Read a cached raw .prefab binary from OPFS.
 */
export async function readCachedPrefab(key: string): Promise<Uint8Array | null> {
  if (!opfsAvailable())
    return null

  let dir: FileSystemDirectoryHandle
  let fileHandle: FileHandleWithSync
  try {
    dir = await openCacheDir(false)
    fileHandle = await dir.getFileHandle(prefabCacheFileName(key)) as FileHandleWithSync
  }
  catch {
    console.info(`[web-rwkv:cache] miss for prefab ${key.slice(0, 12)}… (no cached file yet)`)
    return null
  }

  let handle: SyncAccessHandle | undefined
  try {
    handle = await fileHandle.createSyncAccessHandle()
    const size = handle.getSize()
    if (size <= 0)
      throw new Error('web-rwkv cache: empty prefab cache file')
    const data = new Uint8Array(size)
    handle.read(data, { at: 0 })
    handle.close()
    console.info(`[web-rwkv:cache] hit for prefab ${key.slice(0, 12)}… (${size} bytes)`)
    return data
  }
  catch (error) {
    try {
      handle?.close()
    }
    catch {}
    console.warn('[web-rwkv:cache] cached prefab file unusable; dropping and re-downloading', error)
    try {
      await dir.removeEntry(prefabCacheFileName(key))
    }
    catch {}
    return null
  }
}

/**
 * Persist a raw .prefab binary into OPFS with single-slot eviction guarantee.
 */
export async function writeCachedPrefab(key: string, data: Uint8Array): Promise<void> {
  if (!opfsAvailable())
    return

  try {
    const dir = await openCacheDir(true)
    const fileName = prefabCacheFileName(key)
    const fileHandle = await dir.getFileHandle(fileName, { create: true }) as FileHandleWithSync
    if (typeof fileHandle.createSyncAccessHandle !== 'function')
      return

    const handle = await fileHandle.createSyncAccessHandle()
    handle.truncate(0)
    handle.write(data, { at: 0 })
    handle.flush()
    handle.close()
    console.info(`[web-rwkv:cache] cached prefab (${data.byteLength} bytes) for ${key.slice(0, 12)}…`)

    // Single-slot eviction: remove any other .f16cache or .prefabcache files
    try {
      for await (const entry of (dir as any).values()) {
        if (entry.kind === 'file' && (entry.name.endsWith('.f16cache') || entry.name.endsWith('.prefabcache')) && entry.name !== fileName) {
          console.info(`[web-rwkv:cache] single-slot eviction: removing previous cache ${entry.name}`)
          await dir.removeEntry(entry.name)
        }
      }
    }
    catch (evictErr) {
      console.warn('[web-rwkv:cache] single-slot eviction notice:', evictErr)
    }
  }
  catch (error) {
    console.warn('[web-rwkv:cache] failed to write cached prefab', error)
  }
}

const STATES_DIR = 'states'

async function openStatesDir(create: boolean): Promise<FileSystemDirectoryHandle | null> {
  if (!opfsAvailable())
    return null
  try {
    const root = await navigator.storage.getDirectory()
    const rwkvDir = await root.getDirectoryHandle(CACHE_DIR, { create })
    return await rwkvDir.getDirectoryHandle(STATES_DIR, { create })
  }
  catch {
    return null
  }
}

function stateCacheFileName(cartridgeKey: string): string {
  const safe = cartridgeKey.replace(/[^\w.-]/g, '_')
  return `${safe}.statecache`
}

/**
 * Read a cached Float32Array recurrent state from OPFS.
 */
export async function readCachedState(cartridgeKey: string): Promise<Float32Array | null> {
  if (!opfsAvailable())
    return null

  let handle: SyncAccessHandle | null = null
  try {
    const dir = await openStatesDir(false)
    if (!dir)
      return null
    const fileName = stateCacheFileName(cartridgeKey)
    const fileHandle = await dir.getFileHandle(fileName, { create: false }) as FileHandleWithSync
    if (typeof fileHandle.createSyncAccessHandle !== 'function')
      return null

    handle = await fileHandle.createSyncAccessHandle()
    const size = handle.getSize()
    if (size === 0 || size % 4 !== 0) {
      handle.close()
      return null
    }

    const byteBuffer = new ArrayBuffer(size)
    const bytesRead = handle.read(new Uint8Array(byteBuffer), { at: 0 })
    handle.close()
    handle = null

    if (bytesRead !== size)
      return null

    return new Float32Array(byteBuffer)
  }
  catch {
    try {
      handle?.close()
    }
    catch {}
    return null
  }
}

/**
 * Persist a raw Float32Array recurrent state into OPFS under states/.
 */
export async function writeCachedState(cartridgeKey: string, data: Float32Array): Promise<void> {
  if (!opfsAvailable())
    return

  try {
    const dir = await openStatesDir(true)
    if (!dir)
      return
    const fileName = stateCacheFileName(cartridgeKey)
    const fileHandle = await dir.getFileHandle(fileName, { create: true }) as FileHandleWithSync
    if (typeof fileHandle.createSyncAccessHandle !== 'function')
      return

    const handle = await fileHandle.createSyncAccessHandle()
    handle.truncate(0)
    const uint8View = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    handle.write(uint8View, { at: 0 })
    handle.flush()
    handle.close()
    console.info(`[web-rwkv:cache] cached state cartridge (${data.byteLength} bytes) for ${cartridgeKey}`)
  }
  catch (error) {
    console.warn(`[web-rwkv:cache] failed to write cached state for ${cartridgeKey}:`, error)
  }
}

/**
 * Check if a state cartridge exists in OPFS.
 */
export async function isStateCached(cartridgeKey: string): Promise<boolean> {
  if (!opfsAvailable())
    return false
  try {
    const dir = await openStatesDir(false)
    if (!dir)
      return false
    await dir.getFileHandle(stateCacheFileName(cartridgeKey), { create: false })
    return true
  }
  catch {
    return false
  }
}
