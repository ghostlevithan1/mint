import assert from 'node:assert/strict'
import test from 'node:test'
import {
  blockKindFor,
  clearBlock,
  describeDuration,
  formatCountdown,
  getBlock,
  resetBlocks,
  startBlock,
  subscribeBlock,
} from '../src/lib/blocks'

/** A stand-in for the browser's storage, so a "reload" can be simulated. */
function installStorage() {
  const data = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    },
  })
  return data
}

const T0 = 1_700_000_000_000

test('the countdown reads as m:ss, then h:mm:ss', () => {
  assert.equal(formatCountdown(0), '0:00')
  assert.equal(formatCountdown(-5_000), '0:00')
  assert.equal(formatCountdown(42_000), '0:42')
  assert.equal(formatCountdown(41_001), '0:42', 'a part second rounds up, so it never shows 0:00 early')
  assert.equal(formatCountdown(65_000), '1:05')
  assert.equal(formatCountdown(10 * 60_000), '10:00')
  assert.equal(formatCountdown(3_600_000), '1:00:00')
  assert.equal(formatCountdown(24 * 3_600_000), '24:00:00')
  assert.equal(formatCountdown(24 * 3_600_000 - 19_000), '23:59:41')
})

test('durations are described in words for screen readers', () => {
  assert.equal(describeDuration(10_000), '10 seconds')
  assert.equal(describeDuration(1_000), '1 second')
  assert.equal(describeDuration(125_000), '2 minutes 5 seconds')
  assert.equal(describeDuration(24 * 3_600_000), '24 hours')
})

test('only the server codes that mean "wait" start a pause', () => {
  assert.equal(blockKindFor('CLIENT_RATE_LIMIT'), 'rate')
  assert.equal(blockKindFor('NETWORK_RATE_LIMIT'), 'rate')
  assert.equal(blockKindFor('SPAM_BLOCK'), 'spam')
  assert.equal(blockKindFor('DEVICE_BANNED'), 'ban')
  for (const other of ['NO_KEY', 'MODEL_TIMEOUT', 'HTTP_ERROR', 'REQUEST_REJECTED', '', undefined]) {
    assert.equal(blockKindFor(other), null, String(other))
  }
})

test('a pause is in force until its time is up', () => {
  installStorage()
  resetBlocks()
  assert.equal(getBlock(T0), null)

  startBlock('rate', 45, T0)
  const block = getBlock(T0)
  assert.equal(block?.kind, 'rate')
  assert.equal(block?.until, T0 + 45_000)
  assert.equal(block?.startedAt, T0)
  assert.ok(getBlock(T0 + 44_999))
  assert.equal(getBlock(T0 + 45_000), null)
})

test('a ban is never replaced by a shorter pause, and a fresh pause restarts', () => {
  installStorage()
  resetBlocks()
  startBlock('ban', 86_400, T0)
  startBlock('rate', 30, T0 + 1_000)
  startBlock('spam', 10, T0 + 2_000)
  assert.equal(getBlock(T0 + 3_000)?.kind, 'ban')

  // Re-reporting the same ban keeps its start, so the progress bar does not jump.
  startBlock('ban', 86_400 - 60, T0 + 60_000)
  assert.equal(getBlock(T0 + 60_001)?.startedAt, T0)

  clearBlock('rate')
  assert.equal(getBlock(T0 + 3_000)?.kind, 'ban', 'clearing another kind leaves the ban')
  clearBlock('ban')
  assert.equal(getBlock(T0 + 3_000), null)

  // A repeat of a spam lock starts a new countdown.
  startBlock('spam', 10, T0)
  startBlock('spam', 10, T0 + 6_000)
  assert.equal(getBlock(T0 + 6_001)?.until, T0 + 16_000)
})

test('a pause survives a reload, but an expired one does not', () => {
  const data = installStorage()
  resetBlocks()
  const realNow = Date.now
  Date.now = () => T0
  try {
    startBlock('ban', 3_600, T0)
    assert.ok(data.get('mint.block'), 'it is saved to this browser')

    resetBlocks() // the page reloads: memory is gone, storage remains
    assert.equal(getBlock(T0 + 1_000)?.kind, 'ban')
    assert.equal(getBlock(T0 + 1_000)?.until, T0 + 3_600_000)

    resetBlocks()
    Date.now = () => T0 + 7_200_000 // two hours on
    assert.equal(getBlock(), null)

    // A damaged value is ignored rather than breaking the page.
    data.set('mint.block', '{ nope')
    resetBlocks()
    assert.equal(getBlock(), null)
    data.set('mint.block', JSON.stringify({ kind: 'laser', until: T0 + 99_999_999, startedAt: T0 }))
    resetBlocks()
    assert.equal(getBlock(), null)
  } finally {
    Date.now = realNow
  }
})

test('listeners hear about every change', () => {
  installStorage()
  resetBlocks()
  let calls = 0
  const stop = subscribeBlock(() => {
    calls += 1
  })
  startBlock('rate', 30, T0)
  clearBlock()
  stop()
  startBlock('rate', 30, T0)
  assert.equal(calls, 2)
})
