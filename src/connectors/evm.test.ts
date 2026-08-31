import { describe, expect, test } from 'bun:test'
import { decodeString, encodeAddress, SELECTOR, toBigInt, wordToAddress, words } from './evm.js'

describe('ABI helpers', () => {
  test('encodes an address left-padded to 32 bytes', () => {
    expect(encodeAddress(SELECTOR.balanceOf, '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2')).toBe(
      '0x70a08231000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
    )
  })

  test('splits a return value into 32-byte words', () => {
    expect(words(`0x${'11'.repeat(32)}${'22'.repeat(32)}`)).toHaveLength(2)
  })

  test('reads an address out of its right-hand 20 bytes', () => {
    expect(wordToAddress(`${'0'.repeat(24)}c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2`)).toBe(
      '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
    )
  })

  test('a missing word is zero, not NaN', () => {
    expect(toBigInt(undefined)).toBe(0n)
  })

  test('decodes an ABI string past its offset and length', () => {
    // offset, length 4, then "WETH" right-padded
    const hex =
      '0x' +
      '20'.padStart(64, '0') +
      '4'.padStart(64, '0') +
      Buffer.from('WETH').toString('hex').padEnd(64, '0')
    expect(decodeString(hex)).toBe('WETH')
  })

  test('a too-short string returns empty rather than throwing', () => {
    expect(decodeString('0x00')).toBe('')
  })
})
