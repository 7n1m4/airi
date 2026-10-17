import initModule from './SpineSkeletonDataConverter.js'
import wasmUrl from './SpineSkeletonDataConverter.wasm?url'

/**
 * The subset of the emscripten module surface used to run the Spine converter:
 * an in-memory FS plus the `callMain` entry point of the linked converter.
 */
interface SpineConverterModule {
  FS: {
    writeFile: (path: string, data: Uint8Array) => void
    readFile: (path: string) => Uint8Array
    unlink: (path: string) => void
  }
  callMain: (args: string[]) => void
}

/**
 * Converts a Spine skeleton file from 3.x to a supported target version (default 4.1.20)
 * entirely in-memory using WebAssembly.
 *
 * @param inputBytes The raw Uint8Array of the 3.x skeleton file.
 * @param filename The name of the file (e.g. "skeleton.skel") to mount in virtual FS.
 * @param targetVersion The Spine target version to upgrade to (default "4.1.20").
 * @returns A promise resolving to the upgraded Uint8Array.
 */
export async function convertSpineSkeleton(
  inputBytes: Uint8Array,
  filename: string,
  targetVersion = '4.1.20',
): Promise<Uint8Array> {
  console.info(`[Spine-Wasm-Converter] Instantiating SpineSkeletonDataConverter WebAssembly for ${filename}...`)
  // NOTICE: the glue module is untyped, so the resolved value is asserted once against
  // the narrow surface we actually call instead of being treated as `any`.
  const Module = await initModule({
    locateFile: (path: string) => {
      if (path.endsWith('.wasm')) {
        console.info(`[Spine-Wasm-Converter] Loading Wasm from: ${wasmUrl}`)
        return wasmUrl
      }
      return path
    },
  }) as unknown as SpineConverterModule

  const inputPath = `/${filename}`
  const outputPath = `/output_${Date.now()}_${filename}`

  console.info(`[Spine-Wasm-Converter] Writing file ${filename} to MEMFS...`)
  Module.FS.writeFile(inputPath, inputBytes)

  try {
    console.info(`[Spine-Wasm-Converter] Calling callMain conversion for version: ${targetVersion}`)
    Module.callMain([inputPath, outputPath, '-v', targetVersion])

    console.info(`[Spine-Wasm-Converter] Reading output file from MEMFS...`)
    const outputBytes = Module.FS.readFile(outputPath)
    console.info(`[Spine-Wasm-Converter] Successfully converted skeleton: ${outputBytes.length} bytes.`)
    return outputBytes
  }
  finally {
    try {
      Module.FS.unlink(inputPath)
    }
    catch {}
    try {
      Module.FS.unlink(outputPath)
    }
    catch {}
  }
}
