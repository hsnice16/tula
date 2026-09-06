import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { unlink } from 'node:fs/promises'
import { keccak256, keccak256Hex } from './keccak.js'
import { addressProblem, checksumAddress } from './evm.js'

describe('keccak256', () => {
  // The published vectors. Keccak-256 is not SHA3-256 and the two differ only
  // in one padding byte, so a wrong constant here still produces a plausible
  // digest — these are the only thing that catches that.
  test.each([
    ['', 'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470'],
    ['abc', '4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45'],
    ['testing', '5f16f4c7f149ac4f9510d9cf8cf384038ad348b3bcdc01915f95de12df9d1b02'],
    [
      'The quick brown fox jumps over the lazy dog',
      '4d741b6f1eb29cb2a9b9911c82f56fa8d73b04959d3d9d222895df6c0b28aa15',
    ],
  ])('hashes %p', (input, want) => {
    expect(keccak256Hex(input)).toBe(want)
  })

  test('absorbs across the 136-byte rate boundary', () => {
    // Lengths either side of one and two blocks: an off-by-one in the sponge
    // passes every short vector above and fails here.
    for (const n of [135, 136, 137, 271, 272, 273]) {
      expect(keccak256(new Uint8Array(n)).length).toBe(32)
    }
    expect(keccak256Hex('a'.repeat(136))).not.toBe(keccak256Hex('a'.repeat(137)))
  })
})

describe('EIP-55 checksums', () => {
  // From the EIP itself.
  test.each([
    '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
    '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359',
    '0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB',
    '0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb',
  ])('round-trips %p', (address) => {
    expect(checksumAddress(address.toLowerCase())).toBe(address)
  })

  test('a mistyped checksummed address is refused', () => {
    // Last character's case flipped: the shape is still valid, which is the
    // whole reason a shape check alone cannot catch a typo.
    expect(addressProblem('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD')).toContain('checksum')
  })

  test('a single wrong hex digit is refused', () => {
    expect(addressProblem('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAec')).toContain('checksum')
  })

  test('an address in one case carries no checksum, so it is accepted', () => {
    expect(addressProblem('0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed')).toBeNull()
    expect(addressProblem('0x5AAEB6053F3E94C9B9A09F33669435E7EF1BEAED')).toBeNull()
  })

  test('the wrong shape is named as the wrong shape, not as a checksum failure', () => {
    expect(addressProblem('0xnope')).toContain('40 hex characters')
    expect(addressProblem('')).toContain('40 hex characters')
  })
})

describe('the permutation, cross-checked against the runtime', () => {
  // Keccak and SHA-3 share a permutation and differ by one padding byte, so
  // re-deriving SHA-3 from this code and comparing to the runtime's own
  // implementation checks the permutation and sponge against something this
  // repository did not write.
  test('re-padded as SHA-3, it matches node:crypto at every block boundary', async () => {
    const src = await Bun.file(new URL('./keccak.ts', import.meta.url)).text()
    const variant = src.replace('padded[input.length] = 0x01', 'padded[input.length] = 0x06')
    const path = `${process.env['TMPDIR'] ?? '/tmp'}/tula-sha3-variant-${process.pid}.ts`
    await Bun.write(path, variant)
    const { keccak256: sha3 } = (await import(path)) as { keccak256: (b: Uint8Array) => Uint8Array }

    try {
      for (const n of [0, 1, 135, 136, 137, 200, 272, 1000]) {
        const msg = new Uint8Array(n).map((_, i) => (i * 7) % 256)
        expect(Buffer.from(sha3(msg)).toString('hex')).toBe(
          createHash('sha3-256').update(Buffer.from(msg)).digest('hex'),
        )
      }
    } finally {
      await unlink(path)
    }
  })
})
