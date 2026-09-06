/**
 * Keccak-256, for EIP-55 address checksums.
 *
 * Hand-written because neither runtime has it: Node and Bun both offer
 * `sha3-256`, which is the same permutation under a different padding byte and
 * therefore a different digest. The alternative was a dependency, and this
 * process reads exchange API keys — the runtime dependency list is kept
 * near-empty on purpose.
 *
 * Used for a checksum and nothing else. It never signs, so a defect here
 * refuses a good address rather than authorising a bad one, and `keccak.test.ts`
 * pins it against the published vectors.
 */

const ROUNDS = 24

const RC: readonly bigint[] = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
]

/** Rotation offsets, indexed by lane. */
const R: readonly number[] = [
  0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14,
]

const MASK = (1n << 64n) - 1n

const rotl = (x: bigint, n: number): bigint =>
  n === 0 ? x : ((x << BigInt(n)) | (x >> BigInt(64 - n))) & MASK

function keccakF(a: bigint[]): void {
  for (let round = 0; round < ROUNDS; round++) {
    // theta
    const c = new Array<bigint>(5)
    for (let x = 0; x < 5; x++) {
      c[x] = a[x]! ^ a[x + 5]! ^ a[x + 10]! ^ a[x + 15]! ^ a[x + 20]!
    }
    for (let x = 0; x < 5; x++) {
      const d = c[(x + 4) % 5]! ^ rotl(c[(x + 1) % 5]!, 1)
      for (let y = 0; y < 25; y += 5) a[x + y] = a[x + y]! ^ d
    }

    // rho and pi
    const b = new Array<bigint>(25).fill(0n)
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        b[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(a[x + 5 * y]!, R[x + 5 * y]!)
      }
    }

    // chi
    for (let y = 0; y < 25; y += 5) {
      for (let x = 0; x < 5; x++) {
        a[x + y] = b[x + y]! ^ (~b[((x + 1) % 5) + y]! & MASK & b[((x + 2) % 5) + y]!)
      }
    }

    // iota
    a[0] = a[0]! ^ RC[round]!
  }
}

/** Rate in bytes for a 256-bit digest: 1600 bits of state less twice the 256. */
const RATE = 136

export function keccak256(input: Uint8Array): Uint8Array {
  // Pad10*1 with keccak's original domain byte. SHA-3 writes 0x06 here, and
  // that one byte is the whole difference between the two functions.
  const padded = new Uint8Array(Math.ceil((input.length + 1) / RATE) * RATE)
  padded.set(input)
  padded[input.length] = 0x01
  padded[padded.length - 1] = (padded[padded.length - 1] ?? 0) | 0x80

  const state = new Array<bigint>(25).fill(0n)
  for (let offset = 0; offset < padded.length; offset += RATE) {
    for (let i = 0; i < RATE / 8; i++) {
      let lane = 0n
      // Little-endian, which is the byte order the sponge absorbs in.
      for (let j = 7; j >= 0; j--) lane = (lane << 8n) | BigInt(padded[offset + i * 8 + j] ?? 0)
      state[i] = state[i]! ^ lane
    }
    keccakF(state)
  }

  const out = new Uint8Array(32)
  for (let i = 0; i < 4; i++) {
    let lane = state[i]!
    for (let j = 0; j < 8; j++) {
      out[i * 8 + j] = Number(lane & 0xffn)
      lane >>= 8n
    }
  }
  return out
}

export const keccak256Hex = (text: string): string =>
  Array.from(keccak256(new TextEncoder().encode(text)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
