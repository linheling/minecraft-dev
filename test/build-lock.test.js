import { test } from 'node:test'
import assert from 'node:assert/strict'
import { acquireBuildLock, releaseBuildLock } from '../lib/build-lock.js'

/**
 * The lock is shared by mc_gradle and mc_smoke: two Gradle processes in the
 * same project corrupt each other's locks and build directories. It is
 * process-local (Map keyed by the resolved project dir), so these tests only
 * cover the refusal / release / re-acquire contract, not cross-process safety.
 */
test('the second claim on the same project is refused and names the holder', () => {
  const key = acquireBuildLock('/tmp/project', 'build', 'mc_gradle')
  assert.throws(
    () => acquireBuildLock('/tmp/project', 'runServer', 'mc_smoke'),
    /another mc_gradle run is already active in \/tmp\/project \(task "build" started \d+ms ago\)/,
  )
  releaseBuildLock(key)
})

test('the slot can be claimed again after release', () => {
  const first = acquireBuildLock('/tmp/project', 'build', 'mc_gradle')
  releaseBuildLock(first)
  const second = acquireBuildLock('/tmp/project', 'runServer', 'mc_smoke')
  releaseBuildLock(second)
  assert.doesNotThrow(() => releaseBuildLock(second), 'releasing twice is a no-op')
})

test('different projects do not contend', () => {
  const a = acquireBuildLock('/tmp/a', 'build', 'mc_gradle')
  const b = acquireBuildLock('/tmp/b', 'build', 'mc_gradle')
  releaseBuildLock(a)
  releaseBuildLock(b)
})
