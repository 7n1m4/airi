import fs from 'node:fs'
import path from 'node:path'

const CACHE_DIR = path.resolve('.turbo/cache')
const MAX_CACHE_SIZE_BYTES = 2 * 1024 * 1024 * 1024 // 2 GB limit

function getDirSizeAndFiles(dirPath) {
  let totalSize = 0
  const filesList = []

  function traverse(currentPath) {
    if (!fs.existsSync(currentPath))
      return
    const stats = fs.statSync(currentPath)
    if (stats.isDirectory()) {
      const files = fs.readdirSync(currentPath)
      for (const file of files) {
        traverse(path.join(currentPath, file))
      }
    }
    else if (stats.isFile()) {
      totalSize += stats.size
      filesList.push({
        path: currentPath,
        size: stats.size,
        mtime: stats.mtimeMs,
      })
    }
  }

  traverse(dirPath)
  return { totalSize, filesList }
}

function pruneCache() {
  if (!fs.existsSync(CACHE_DIR)) {
    return
  }

  const { totalSize, filesList } = getDirSizeAndFiles(CACHE_DIR)
  if (totalSize <= MAX_CACHE_SIZE_BYTES) {
    return
  }

  console.log(`[Turbo Cache Pruner] Cache size is ${(totalSize / (1024 * 1024 * 1024)).toFixed(2)} GB, which exceeds the limit of 2.00 GB. Pruning oldest entries...`)

  // Sort files by last modification time (oldest first)
  filesList.sort((a, b) => a.mtime - b.mtime)

  let currentSize = totalSize
  let deletedCount = 0

  for (const file of filesList) {
    try {
      fs.unlinkSync(file.path)
      currentSize -= file.size
      deletedCount++

      if (currentSize <= MAX_CACHE_SIZE_BYTES) {
        break
      }
    }
    catch (err) {
      console.error(`[Turbo Cache Pruner] Failed to delete ${file.path}:`, err.message)
    }
  }

  console.log(`[Turbo Cache Pruner] Pruned ${deletedCount} files. New cache size: ${(currentSize / (1024 * 1024 * 1024)).toFixed(2)} GB`)
}

pruneCache()
