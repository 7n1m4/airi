import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createS3Provider } from './s3'

const mockClient = vi.hoisted(() => ({
  putObject: vi.fn(),
  listObjects: vi.fn(),
  deleteObjects: vi.fn(),
  getEtag: vi.fn(),
}))

vi.mock('s3mini', () => ({ S3mini: class { constructor() { return mockClient } } }))

describe('s3 unit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('upload reads file and puts object', async () => {
    const file = join(tmpdir(), 'warp-upload.txt')
    await writeFile(file, 'hello')
    const p = createS3Provider({ endpoint: 'https://e', accessKeyId: 'a', secretAccessKey: 's' })
    await p.upload(file, '/key.txt', 'text/plain')
    expect(mockClient.putObject).toHaveBeenCalledWith('key.txt', expect.any(Buffer), 'text/plain')
  })

  it('getPublicUrl defaults to endpoint', () => {
    const p = createS3Provider({ endpoint: 'https://e/', accessKeyId: 'a', secretAccessKey: 's' })
    expect(p.getPublicUrl('a/b')).toBe('https://e/a/b')
  })

  it('cleanPrefix empty prefix returns', async () => {
    const p = createS3Provider({ endpoint: 'https://e', accessKeyId: 'a', secretAccessKey: 's' })
    await p.cleanPrefix!('///')
    expect(mockClient.listObjects).not.toHaveBeenCalled()
  })

  it('cleanPrefix deletes objects', async () => {
    mockClient.listObjects.mockResolvedValue([{ Key: 'prefix/a' }, { Key: 'prefix/b' }])
    const p = createS3Provider({ endpoint: 'https://e', accessKeyId: 'a', secretAccessKey: 's' })
    await p.cleanPrefix!('prefix')
    expect(mockClient.deleteObjects).toHaveBeenCalledWith(['prefix/a', 'prefix/b'])
  })

  it('shouldSkipUpload false when disabled', async () => {
    const p = createS3Provider({ endpoint: 'https://e', accessKeyId: 'a', secretAccessKey: 's', skipNotModified: false })
    const file = join(tmpdir(), 'x.txt')
    await writeFile(file, 'x')
    expect(await p.shouldSkipUpload!(file, 'key')).toBe(false)
  })

  it('shouldSkipUpload matches md5', async () => {
    const data = Buffer.from('hello')
    const hash = createHash('md5').update(data).digest('hex')
    mockClient.getEtag.mockResolvedValue(`"${hash}"`)
    const file = join(tmpdir(), 'y.txt')
    await writeFile(file, data)
    const p = createS3Provider({ endpoint: 'https://e', accessKeyId: 'a', secretAccessKey: 's' })
    expect(await p.shouldSkipUpload!(file, 'key')).toBe(true)
  })

  it('shouldSkipUpload false on throw', async () => {
    mockClient.getEtag.mockRejectedValue(new Error('boom'))
    const file = join(tmpdir(), 'u.txt')
    await writeFile(file, 'hello')
    const p = createS3Provider({ endpoint: 'https://e', accessKeyId: 'a', secretAccessKey: 's' })
    expect(await p.shouldSkipUpload!(file, 'key')).toBe(false)
  })
})
