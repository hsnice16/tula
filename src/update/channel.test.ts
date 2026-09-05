import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { nativeInstall } from './channel.js'

/**
 * `process.execPath` is what says where the running bytes are, and it is not
 * writable. The tests put a real tree on disk and point it at that instead, so
 * what is exercised is the same `realpath` and `lstat` the real call makes.
 */
let root: string
const realExecPath = process.execPath

const setExecPath = (to: string) => {
  Object.defineProperty(process, 'execPath', { value: to, configurable: true })
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'tula-channel-'))
  process.env['TULA_INSTALL_DIR'] = root
})

afterEach(async () => {
  setExecPath(realExecPath)
  delete process.env['TULA_INSTALL_DIR']
  await rm(root, { recursive: true, force: true })
})

/** The tree `install.sh` leaves behind. */
async function nativeTree(version = '0.1.0'): Promise<string> {
  const dir = join(root, 'versions', version)
  await mkdir(dir, { recursive: true })
  await mkdir(join(root, 'bin'), { recursive: true })
  const binary = join(dir, 'tula')
  await writeFile(binary, '')
  await symlink(binary, join(root, 'bin', 'tula'))
  return binary
}

describe('deciding whether tula may move itself', () => {
  test('a binary under the install tree, behind the link, is ours to move', async () => {
    setExecPath(await nativeTree())
    const found = await nativeInstall()
    expect(found).not.toBeNull()
    expect(found?.launcher).toBe(join(root, 'bin', 'tula'))
  })

  // Homebrew and npm keep their own record of what is installed. A binary that
  // swapped itself underneath either leaves the package manager reporting a
  // version that is not running.
  test('a binary somewhere else is not', async () => {
    await nativeTree()
    const elsewhere = join(root, 'somewhere', 'tula')
    await mkdir(join(root, 'somewhere'), { recursive: true })
    await writeFile(elsewhere, '')
    setExecPath(elsewhere)
    expect(await nativeInstall()).toBeNull()
  })

  /**
   * `install.sh` refuses to overwrite a launcher somebody put there themselves,
   * because it may be a wrapper pinning a version on purpose. Replacing it from
   * in here would discard exactly what the installer was careful to keep.
   */
  test('a launcher the user replaced with a real file is left alone', async () => {
    const binary = await nativeTree()
    await rm(join(root, 'bin', 'tula'))
    await writeFile(join(root, 'bin', 'tula'), '#!/bin/sh\n')
    setExecPath(binary)
    expect(await nativeInstall()).toBeNull()
  })

  test('a tree with no launcher at all is not ours to move', async () => {
    const binary = await nativeTree()
    await rm(join(root, 'bin', 'tula'))
    setExecPath(binary)
    expect(await nativeInstall()).toBeNull()
  })

  // `versions` is a prefix of `versions-of-my-own`, and a plain string compare
  // would call the second one an install tree.
  test('a directory that merely starts with the same name is not the tree', async () => {
    await nativeTree()
    const near = join(`${root}/versions-mine`, 'tula')
    await mkdir(`${root}/versions-mine`, { recursive: true })
    await writeFile(near, '')
    setExecPath(near)
    expect(await nativeInstall()).toBeNull()
  })
})
