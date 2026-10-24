import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  evaluateExpectation,
  loadScenario,
  normalizeScenario,
  renderSmokeResult,
  runSmoke,
} from '../lib/smoke.js'
import { smokeNextSteps } from '../lib/next-steps.js'

/** A ChildProcess stand-in: stdout/stderr are emitters, stdin records writes. */
function fakeChild() {
  const child = new EventEmitter()
  child.pid = 4242
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  const writes = []
  child.stdin = {
    writable: true,
    write(text) {
      writes.push(text)
      return true
    },
  }
  child.writes = writes
  return child
}

const PASS_SCENARIO = {
  id: 'paper-startup',
  steps: [{ id: 'ready', expect: { contains: ['Done ('] } }],
}

const FAST = { killSettleMs: 25, stopGraceMs: 40 }

test('normalizeScenario fills the documented defaults', () => {
  const scenario = normalizeScenario({ steps: [{ expect: { contains: 'Done (' } }] })
  assert.equal(scenario.id, 'smoke')
  assert.equal(scenario.task, 'runServer')
  assert.deepEqual(scenario.args, ['--no-daemon'])
  assert.equal(scenario.steps[0].id, 'step-1')
  assert.deepEqual(scenario.steps[0].expect, { contains: ['Done ('], notContains: [] })
})

test('normalizeScenario rejects malformed scenarios with the offending field', () => {
  assert.throws(() => normalizeScenario(null), /scenario must be a JSON object/)
  assert.throws(() => normalizeScenario({ steps: [] }), /non-empty array/)
  assert.throws(() => normalizeScenario({ steps: [{ expect: {} }] }), /needs "contains" or "notContains"/)
  assert.throws(() => normalizeScenario({ steps: [{ expect: { contains: [1] } }] }), /non-empty strings/)
  assert.throws(() => normalizeScenario({ steps: [{ expect: { contains: 'x' } }], args: [1] }), /array of strings/)
  assert.throws(
    () => normalizeScenario({ steps: Array.from({ length: 33 }, () => ({ expect: { contains: 'x' } })) }),
    /32 entries or fewer/,
  )
})

test('loadScenario accepts inline JSON and a file path', async () => {
  const fromJson = await loadScenario(JSON.stringify(PASS_SCENARIO))
  assert.equal(fromJson.id, 'paper-startup')

  const dir = await mkdtemp(path.join(os.tmpdir(), 'mc-smoke-scenario-'))
  const file = path.join(dir, 'scenario.json')
  await writeFile(file, JSON.stringify(PASS_SCENARIO), 'utf8')
  const fromFile = await loadScenario(file)
  assert.equal(fromFile.steps[0].id, 'ready')

  await assert.rejects(loadScenario(path.join(dir, 'missing.json')), /scenario file not found/)
  await assert.rejects(loadScenario('{not json'), /not valid JSON/)
})

test('evaluateExpectation needs every contains pattern and no notContains pattern', () => {
  const text = 'Starting minecraft server\nDone (3.2s)! For help'
  assert.deepEqual(evaluateExpectation(text, { contains: ['Done (', 'Starting'], notContains: [] }), {
    matched: true,
    missing: [],
  })
  const partial = evaluateExpectation(text, { contains: ['Done (', 'Loading 1 mods'], notContains: [] })
  assert.equal(partial.matched, false)
  assert.deepEqual(partial.missing, ['missing: "Loading 1 mods"'])
  const unexpected = evaluateExpectation(text, { contains: [], notContains: ['Done ('] })
  assert.deepEqual(unexpected.missing, ['unexpected: "Done ("'])
})

test('runSmoke passes when the patterns straddle output chunks, then stops the server', async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), 'mc-smoke-pass-'))
  const child = fakeChild()
  const spawnImpl = () => {
    setTimeout(() => {
      child.stdout.emit('data', Buffer.from('Starting minecraft server version 1.21.1\n'))
      child.stdout.emit('data', Buffer.from('Lo'))
      child.stdout.emit('data', Buffer.from('ading 1 mods\nDo'))
      child.stdout.emit('data', Buffer.from('ne (3.2s)! For help'))
      setTimeout(() => child.emit('close', 0, null), 5)
    }, 5)
    return child
  }

  const result = await runSmoke({
    projectDir,
    scenario: { id: 'paper-startup', steps: [{ id: 'ready', expect: { contains: ['Done (', 'Loading 1 mods'] } }] },
    internals: { skipPreflight: true, platform: 'linux', spawnImpl, ...FAST },
  })

  assert.equal(result.verdict, 'pass')
  assert.deepEqual(result.steps, [{ id: 'ready', matched: true, missing: [] }])
  assert.equal(result.timedOut, false)
  assert.equal(result.exitCode, 0)
  assert.ok(child.writes.includes('stop\n'), 'a matched run must ask the server to stop')
  assert.ok(result.evidenceDir !== '', 'evidence directory should be recorded')
  assert.ok(existsSync(path.join(result.evidenceDir, 'results.json')))
  assert.ok(existsSync(path.join(result.evidenceDir, 'summary.md')))
  assert.ok(existsSync(path.join(result.evidenceDir, 'console.log')))
  const evidence = JSON.parse(await readFile(path.join(result.evidenceDir, 'results.json'), 'utf8'))
  assert.equal(evidence.verdict, 'pass')
  assert.match(evidence.output.text, /Done \(3\.2s\)/)
})

test('runSmoke fails with the missing patterns when the server exits early', async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), 'mc-smoke-fail-'))
  const child = fakeChild()
  const spawnImpl = () => {
    setTimeout(() => {
      child.stdout.emit('data', Buffer.from('Loading mods\n'))
      child.stderr.emit('data', Buffer.from('Exception in thread "main"'))
      child.emit('close', 1, null)
    }, 5)
    return child
  }

  const result = await runSmoke({
    projectDir,
    scenario: PASS_SCENARIO,
    internals: { skipPreflight: true, platform: 'linux', spawnImpl, ...FAST },
  })

  assert.equal(result.verdict, 'fail')
  assert.equal(result.exitCode, 1)
  assert.equal(result.steps[0].matched, false)
  assert.deepEqual(result.steps[0].missing, ['missing: "Done ("'])
  assert.match(result.output.text, /Exception in thread/)
})

test('runSmoke kills the process tree and reports timedOut when the pattern never appears', async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), 'mc-smoke-timeout-'))
  const child = fakeChild()
  const killed = []
  const result = await runSmoke({
    projectDir,
    scenario: PASS_SCENARIO,
    timeoutMs: 40,
    internals: {
      skipPreflight: true,
      platform: 'linux',
      spawnImpl: () => child,
      killTreeImpl: (platform, pid) => killed.push({ platform, pid }),
      killSettleMs: 20,
    },
  })

  assert.equal(result.timedOut, true)
  assert.equal(result.verdict, 'fail')
  assert.equal(result.exitCode, null)
  assert.deepEqual(killed, [{ platform: 'linux', pid: 4242 }])
  assert.ok(result.durationMs >= 40)
})

test('runSmoke reports aborted when the exec signal is already aborted', async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), 'mc-smoke-abort-'))
  const child = fakeChild()
  const controller = new AbortController()
  controller.abort()
  const result = await runSmoke({
    projectDir,
    scenario: PASS_SCENARIO,
    signal: controller.signal,
    internals: {
      skipPreflight: true,
      platform: 'linux',
      spawnImpl: () => child,
      killTreeImpl: () => {},
      killSettleMs: 20,
    },
  })

  assert.equal(result.aborted, true)
  assert.equal(result.verdict, 'fail')
})

test('runSmoke rejects before spawning when the wrapper is missing', async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), 'mc-smoke-nowrapper-'))
  await assert.rejects(
    runSmoke({
      projectDir,
      scenario: PASS_SCENARIO,
      internals: { platform: 'linux', spawnImpl: () => { throw new Error('must not spawn') } },
    }),
    /no Gradle wrapper/,
  )
})

test('renderSmokeResult and smokeNextSteps describe pass, fail and timeout', async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), 'mc-smoke-render-'))
  const child = fakeChild()
  const result = await runSmoke({
    projectDir,
    scenario: PASS_SCENARIO,
    internals: {
      skipPreflight: true,
      platform: 'linux',
      spawnImpl: () => {
        setTimeout(() => {
          child.stdout.emit('data', Buffer.from('Done (1.0s)!'))
          setTimeout(() => child.emit('close', 0, null), 5)
        }, 5)
        return child
      },
      ...FAST,
    },
  })
  const withNext = { ...result, next: smokeNextSteps(result) }
  const text = renderSmokeResult(withNext)
  assert.match(text, /\[smoke\] paper-startup: pass/)
  assert.match(text, /✓ ready/)
  assert.match(text, /Next steps:/)

  const failed = { ...result, verdict: 'fail', timedOut: false, steps: [{ id: 'ready', matched: false, missing: ['missing: "Done ("'] }] }
  assert.match(renderSmokeResult({ ...failed, next: smokeNextSteps(failed) }), /✗ ready — missing: "Done \("/)
  assert.match(smokeNextSteps(failed)[0], /console\.log/)

  const timedOut = { ...failed, timedOut: true }
  assert.match(smokeNextSteps(timedOut)[0], /timeoutMs/)
  assert.match(smokeNextSteps({ ...failed, aborted: true })[0], /--stop/)
})

test('the bundled scenario examples parse and cover ready + error patterns', async () => {
  const { fileURLToPath } = await import('node:url')
  for (const name of ['paper-startup.json', 'fabric-startup.json']) {
    const file = fileURLToPath(new URL(`../assets/scenarios/${name}`, import.meta.url))
    const scenario = await loadScenario(file)
    assert.ok(scenario.steps.length >= 2, `${name} should assert readiness and an error pattern`)
  }
})
