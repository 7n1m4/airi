import { beforeEach, describe, expect, it, vi } from 'vitest'

const fsMock = vi.hoisted(() => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  writeFileSync: vi.fn(),
}))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, ...fsMock }
})

vi.mock('electrobun/main', () => ({
  Utils: { paths: { userData: '/tmp/airi-single-instance-test' } },
}))

const { claimSingleInstance } = await import('./single-instance')

function eexist(): NodeJS.ErrnoException {
  const err = new Error('file already exists') as NodeJS.ErrnoException
  err.code = 'EEXIST'
  return err
}

function lockRecord(pid: number): string {
  return JSON.stringify({ pid, startedAt: new Date().toISOString() })
}

describe('claimSingleInstance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fsMock.mkdirSync.mockReturnValue(undefined)
    fsMock.unlinkSync.mockReturnValue(undefined)
  })

  it('surrenders to a live lock that already exists instead of writing', () => {
    fsMock.existsSync.mockReturnValue(true)
    fsMock.readFileSync.mockReturnValue(lockRecord(process.ppid))

    expect(claimSingleInstance('/fake/userdata', 'main').primary).toBe(false)
    expect(fsMock.writeFileSync).not.toHaveBeenCalled()
  })

  it('returns primary:false when losing the create race (EEXIST) to a live instance', () => {
    fsMock.existsSync.mockReturnValue(false)
    fsMock.writeFileSync.mockImplementation(() => {
      throw eexist()
    })
    fsMock.readFileSync.mockReturnValue(lockRecord(process.ppid))

    expect(claimSingleInstance('/fake/userdata', 'main').primary).toBe(false)
    expect(fsMock.unlinkSync).not.toHaveBeenCalled()
  })

  it('takes over the lock when the EEXIST lock file is stale and the retry succeeds', () => {
    fsMock.existsSync.mockReturnValue(false)
    fsMock.writeFileSync
      .mockImplementationOnce(() => {
        throw eexist()
      })
      .mockImplementationOnce(() => undefined)
    // A pid that is effectively guaranteed not to exist on this host.
    fsMock.readFileSync.mockReturnValue(lockRecord(99999999))

    expect(claimSingleInstance('/fake/userdata', 'main').primary).toBe(true)
    expect(fsMock.writeFileSync).toHaveBeenCalledTimes(2)
  })
})
