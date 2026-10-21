import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  capOutput,
  createOutputCollector,
  killTree,
  renderProcessResult,
  runProcess,
} from '../lib/run-process.js'

/**
 * Fake child process for the injected spawnImpl: captures stdout/stderr data
 * listeners and close/error listeners so the test can feed chunks and settle a
 * run deterministically. No real subprocess is ever spawned.
 */
function fakeChild({ exitCode = 0, signal = null } = {}) {
  const stdout = []
  const stderr = []
  const errorListeners = []
  const closeListeners = []
  const child = {
    pid: 4242,
    stdout: { on: (event, fn) => { if (event === 'data') stdout.push(fn) } },
    stderr: { on: (event, fn) => { if (event === 'data') stderr.push(fn) } },
    on: (event, fn) => {
      if (event === 'error') errorListeners.push(fn)
      if (event === 'close') closeListeners.push(fn)
    },
  }
  return {
    child,
    emitStdout(chunk) { for (const fn of stdout) fn(Buffer.from(chunk)) },
    emitStderr(chunk) { for (const fn of stderr) fn(Buffer.from(chunk)) },
    emitClose(code = exitCode, sig = signal) { for (const fn of closeListeners) fn(code, sig) },
    emitError(error) { for (const fn of errorListeners) fn(error) },
  }
}

const baseOptions = (overrides = {}) => ({
  argv: ['prog', 'arg'],
  cwd: 'C:\\proj',
  timeoutMs: 1000,
  tailChars: 100,
  labels: { program: 'prog', abort: 'mc_prog' },
  internals: { platform: 'win32' },
  ...overrides,
})

test('runProcess resolves with the canonical result shape', async () => {
  const fake = fakeChild({ exitCode: 0 })
  const promise = runProcess(baseOptions({ internals: { platform: 'win32', spawnImpl: () => fake.child } }))
  fake.emitStdout('hello ')
  fake.emitStderr('world')
  fake.emitClose(0)
  const result = await promise
  assert.deepEqual(result, {
    exitCode: 0,
    signal: null,
    timedOut: false,
    aborted: false,
    timeoutMs: 1000,
    output: { text: 'hello world', truncated: false },
  })
})

test('runProcess reports a non-zero exit instead of throwing', async () => {
  const fake = fakeChild({ exitCode: 1 })
  const promise = runProcess(baseOptions({ internals: { platform: 'win32', spawnImpl: () => fake.child } }))
  fake.emitClose(1)
  const result = await promise
  assert.equal(result.exitCode, 1)
  assert.equal(result.timedOut, false)
})

test('runProcess kills the tree and flags the timeout', async () => {
  const fake = fakeChild()
  const killed = []
  const promise = runProcess(baseOptions({
    timeoutMs: 5,
    internals: { platform: 'win32', spawnImpl: () => fake.child, killTreeImpl: (platform, pid) => killed.push([platform, pid]) },
  }))
  await new Promise(resolve => setTimeout(resolve, 25))
  fake.emitClose(null, null)
  const result = await promise
  assert.equal(result.timedOut, true)
  assert.deepEqual(killed, [['win32', 4242]])
})

test('runProcess flags an abort and kills the tree', async () => {
  const fake = fakeChild()
  const controller = new AbortController()
  const killed = []
  const promise = runProcess(baseOptions({
    signal: controller.signal,
    internals: { platform: 'win32', spawnImpl: () => fake.child, killTreeImpl: (platform, pid) => killed.push(pid) },
  }))
  controller.abort('user')
  fake.emitClose(null, 'SIGTERM')
  const result = await promise
  assert.equal(result.aborted, true)
  assert.equal(result.signal, 'SIGTERM')
  assert.deepEqual(killed, [4242])
})

test('runProcess catches an abort that fires while spawnImpl is running', async () => {
  const fake = fakeChild()
  const controller = new AbortController()
  const killed = []
  const promise = runProcess(baseOptions({
    signal: controller.signal,
    internals: {
      platform: 'win32',
      spawnImpl: () => { controller.abort('mid-spawn'); return fake.child },
      killTreeImpl: (platform, pid) => killed.push(pid),
    },
  }))
  fake.emitClose(null, 'SIGTERM')
  const result = await promise
  assert.equal(result.aborted, true)
  assert.deepEqual(killed, [4242])
})

test('runProcess decodes UTF-8 split across Buffer chunks', async () => {
  const fake = fakeChild()
  const promise = runProcess(baseOptions({ internals: { platform: 'win32', spawnImpl: () => fake.child } }))
  const stdout = Buffer.from('你好')
  const stderr = Buffer.from('世界')
  fake.emitStdout(stdout.subarray(0, 2))
  fake.emitStdout(stdout.subarray(2))
  fake.emitStderr(stderr.subarray(0, 1))
  fake.emitStderr(stderr.subarray(1))
  fake.emitClose(0)
  const result = await promise
  assert.equal(result.output.text, '你好世界')
})

test('runProcess asks for verbatim argv only when spawning cmd.exe on win32', async () => {
  const seen = []
  const runWith = async (argv, override) => {
    const fake = fakeChild()
    const promise = runProcess(baseOptions({
      argv,
      ...(override === undefined ? {} : { windowsVerbatimArguments: override }),
      internals: {
        platform: 'win32',
        spawnImpl: (command, args, options) => { seen.push(options.windowsVerbatimArguments); return fake.child },
      },
    }))
    fake.emitClose(0)
    await promise
  }
  await runWith(['prog', 'arg'])
  await runWith(['cmd.exe', '/d', '/s', '/c', '"prog arg"'])
  await runWith(['cmd.exe', '/d', '/s', '/c', '"prog arg"'], false)
  assert.deepEqual(seen, [false, true, false])
})

test('runProcess rejects invalid limits and a pre-aborted signal', async () => {
  await assert.rejects(runProcess(baseOptions({ argv: [] })), /argv must be a non-empty array/)
  await assert.rejects(runProcess(baseOptions({ argv: [42] })), /argv must be a non-empty array/)
  await assert.rejects(runProcess(baseOptions({ timeoutMs: 0 })), /invalid timeoutMs/)
  await assert.rejects(runProcess(baseOptions({ tailChars: -1 })), /invalid tailChars/)
  const controller = new AbortController()
  controller.abort('stop')
  await assert.rejects(runProcess(baseOptions({ signal: controller.signal })), /mc_prog aborted before spawn/)
})

test('runProcess rejects with a readable message when spawn throws or errors', async () => {
  await assert.rejects(
    runProcess(baseOptions({ internals: { platform: 'win32', spawnImpl: () => { throw new Error('ENOENT') } } })),
    /failed to start prog in C:\\proj: ENOENT/,
  )
  const fake = fakeChild()
  const promise = runProcess(baseOptions({ internals: { platform: 'win32', spawnImpl: () => fake.child } }))
  fake.emitError(new Error('boom'))
  await assert.rejects(promise, /failed to run prog in C:\\proj: boom/)
})

test('createOutputCollector matches capOutput byte-for-byte', () => {
  const collector = createOutputCollector(40)
  for (const chunk of ['A'.repeat(30), 'B'.repeat(30), 'C'.repeat(30)]) collector.push(chunk)
  assert.deepEqual(collector.finalize(), capOutput('A'.repeat(30) + 'B'.repeat(30) + 'C'.repeat(30), 40))
})

test('renderProcessResult keeps the legacy gradle shape when no header/footer is given', () => {
  const ok = { exitCode: 0, signal: null, timedOut: false, timeoutMs: 1000, output: { text: 'body' } }
  assert.equal(renderProcessResult(ok), 'body')
  assert.equal(
    renderProcessResult({ ...ok, output: { text: '' } }),
    '(no output)',
  )
  assert.equal(
    renderProcessResult({ ...ok, exitCode: 3 }),
    'body\n[exit code: 3]',
  )
  assert.equal(
    renderProcessResult({ ...ok, timedOut: true, output: { text: 'body\n' } }),
    'body\n[timed out after 1000ms]',
  )
  assert.equal(
    renderProcessResult({ ...ok, signal: 'SIGTERM' }),
    'body\n[killed by signal: SIGTERM]',
  )
})

test('renderProcessResult places header before the body and footer before the markers', () => {
  const result = { exitCode: 1, signal: null, timedOut: false, timeoutMs: 1000, output: { text: 'body' } }
  const text = renderProcessResult(result, {
    header: ['$ prog arg', 'cwd: C:\\proj'],
    footer: ['files changed: 2', 'session: abc'],
  })
  assert.equal(text, [
    '$ prog arg',
    'cwd: C:\\proj',
    'body',
    'files changed: 2',
    'session: abc',
    '[exit code: 1]',
  ].join('\n'))
})

test('killTree is a no-op for a non-positive pid and signals the group on posix', () => {
  const calls = []
  killTree('win32', -1, { spawnSyncImpl: (...args) => calls.push(args) })
  assert.deepEqual(calls, [])
  killTree('linux', 123, { processKillImpl: (pid, signal) => calls.push([pid, signal]) })
  assert.deepEqual(calls, [[-123, 'SIGTERM']])
})

test('killTree falls back to a root-only SIGKILL when win32 taskkill cannot kill the tree', () => {
  const killed = []
  // Missing taskkill binary: spawnSync resolves with `error` instead of throwing.
  killTree('win32', 4242, {
    spawnSyncImpl: () => ({ error: Object.assign(new Error('spawn taskkill ENOENT'), { code: 'ENOENT' }), status: null }),
    processKillImpl: (pid, signal) => killed.push([pid, signal]),
  })
  assert.deepEqual(killed, [[4242, 'SIGKILL']])

  // taskkill itself throws (EPERM in a locked-down environment).
  const thrown = []
  killTree('win32', 7, {
    spawnSyncImpl: () => { throw new Error('spawn EPERM') },
    processKillImpl: (...args) => thrown.push(args),
  })
  assert.deepEqual(thrown, [[7, 'SIGKILL']])

  // taskkill ran but reported a failure (access denied, process gone).
  const failed = []
  killTree('win32', 10, {
    spawnSyncImpl: () => ({ status: 128, error: undefined }),
    processKillImpl: (...args) => failed.push(args),
  })
  assert.deepEqual(failed, [[10, 'SIGKILL']])
})

test('killTree does not fall back when win32 taskkill succeeds', () => {
  const killed = []
  killTree('win32', 9, {
    spawnSyncImpl: () => ({ status: 0, error: undefined }),
    processKillImpl: (...args) => killed.push(args),
  })
  assert.deepEqual(killed, [])
})

test('killTree honours an explicit SIGKILL override on posix', () => {
  const calls = []
  killTree(
    'linux',
    321,
    { processKillImpl: (pid, signal) => calls.push([pid, signal]) },
    { signal: 'SIGKILL' },
  )
  assert.deepEqual(calls, [[-321, 'SIGKILL']])
})

test('runProcess escalates SIGTERM to SIGKILL and settles when close never arrives', async () => {
  const fake = fakeChild()
  const kills = []
  const result = await runProcess(baseOptions({
    timeoutMs: 5,
    internals: {
      platform: 'linux',
      spawnImpl: () => fake.child,
      killTreeImpl: (platform, pid, options) => kills.push([platform, pid, options?.signal ?? 'SIGTERM']),
      killEscalationMs: 10,
      killSettleMs: 10,
    },
  }))
  // The child never emits close (a grandchild kept the pipe open): the runner
  // must force-kill the group and still resolve instead of hanging forever.
  assert.equal(result.timedOut, true)
  assert.equal(result.exitCode, null)
  assert.equal(result.signal, 'SIGKILL')
  assert.deepEqual(kills, [['linux', 4242, 'SIGTERM'], ['linux', 4242, 'SIGKILL']])
})
