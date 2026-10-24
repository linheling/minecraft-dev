/**
 * Server smoke runner (`mc_smoke`): start a Gradle `runServer` task, watch the
 * merged console for a set of patterns, then stop the server and leave evidence
 * behind.
 *
 * minecraft-dev could only prove "it compiles" before this module existed. A
 * real acceptance run answers the next question — "does the server actually
 * start and reach the state we expect" — without the Windows + GUI + client
 * machinery other tools need: the scenario is plain JSON, the process is a
 * normal Gradle wrapper spawn, and the assertions are console patterns.
 *
 * Shape of a scenario (`JSON.stringify`, or a path to a JSON file):
 * `{ "id": "paper-startup", "task": "runServer", "args": ["--no-daemon"],
 *    "steps": [{ "id": "ready", "expect": { "contains": ["Done ("] } }] }`
 * Every `contains` pattern must appear; every `notContains` pattern must not.
 * The run passes when all steps match before the timeout.
 *
 * The spawn implementation and the tree killer are injectable, so the unit
 * tests exercise the timing/stopping logic with a fake child and no real JVM.
 * @module minecraft-dev/lib/smoke
 */

import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { gradleArgv } from './gradle.js'
import { preflightGradle } from './preflight.js'
import { createOutputCollector, killTree, renderProcessResult } from './run-process.js'

/** Overall budget for one smoke run; a first `runServer` downloads dependencies. */
export const DEFAULT_SMOKE_TIMEOUT_MS = 600_000
/** How long a matched run may take to shut down after `stop` before the tree is killed. */
const STOP_GRACE_MS = 15_000
/** How long a killed run may take to report `close` before the result is returned anyway. */
const KILL_SETTLE_MS = 1_000
/** Rolling window used to detect patterns that straddle two output chunks. */
const SCAN_WINDOW_CHARS = 512 * 1024

/** Normalize a `contains`/`notContains` value to an array of strings. */
function asPatterns(value) {
  if (value === undefined) return []
  const list = Array.isArray(value) ? value : [value]
  return list.map((entry) => {
    if (typeof entry !== 'string' || entry.length === 0) {
      throw new Error('scenario expect patterns must be non-empty strings')
    }
    return entry
  })
}

/**
 * Validate a parsed scenario object and fill in defaults.
 * @param {object} value - parsed JSON object.
 * @returns {{ id: string, task: string, args: string[], steps: Array<{ id: string, expect: { contains: string[], notContains: string[] } }> }}
 */
export function normalizeScenario(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('scenario must be a JSON object with a "steps" array')
  }
  if (!Array.isArray(value.steps) || value.steps.length === 0) {
    throw new Error('scenario.steps must be a non-empty array')
  }
  if (value.steps.length > 32) throw new Error('scenario.steps must have 32 entries or fewer')
  const id = typeof value.id === 'string' && value.id.trim() !== '' ? value.id.trim() : 'smoke'
  const task = typeof value.task === 'string' && value.task.trim() !== '' ? value.task.trim() : 'runServer'
  const args = value.args === undefined ? ['--no-daemon'] : value.args
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) {
    throw new Error('scenario.args must be an array of strings')
  }
  const steps = value.steps.map((step, index) => {
    if (step === null || typeof step !== 'object' || Array.isArray(step)) {
      throw new Error(`scenario.steps[${index}] must be an object`)
    }
    const contains = asPatterns(step.expect?.contains)
    const notContains = asPatterns(step.expect?.notContains)
    if (contains.length === 0 && notContains.length === 0) {
      throw new Error(`scenario.steps[${index}].expect needs "contains" or "notContains"`)
    }
    const stepId = typeof step.id === 'string' && step.id.trim() !== '' ? step.id.trim() : `step-${index + 1}`
    return { id: stepId, expect: { contains, notContains } }
  })
  return { id, task, args, steps }
}

/**
 * Load a scenario from an inline JSON string, an object, or a file path.
 * @param {object | string} raw - inline object, inline JSON text, or path to a JSON file.
 * @param {{ cwd?: string }} [options] - base directory for relative paths.
 * @returns {Promise<{ id: string, task: string, args: string[], steps: object[] }>}
 */
export async function loadScenario(raw, options = {}) {
  if (raw !== null && typeof raw === 'object') return normalizeScenario(raw)
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new Error('scenario is required: pass inline JSON or a path to a JSON file')
  }
  const text = raw.trim()
  if (!text.startsWith('{')) {
    const file = path.resolve(options.cwd ?? process.cwd(), text)
    let body
    try {
      body = await readFile(file, 'utf8')
    } catch (error) {
      if (error?.code === 'ENOENT') throw new Error(`scenario file not found: ${file}`)
      throw error
    }
    return parseScenarioText(body, file)
  }
  return parseScenarioText(text, 'inline scenario')
}

/** Parse JSON text into a scenario, naming the source in the error message. */
function parseScenarioText(text, source) {
  let value
  try {
    value = JSON.parse(text)
  } catch (error) {
    throw new Error(`${source} is not valid JSON: ${error.message}`)
  }
  return normalizeScenario(value)
}

/**
 * Check one step's expectations against captured console text.
 * @param {string} text - everything captured so far.
 * @param {{ contains: string[], notContains: string[] }} expect - patterns.
 * @returns {{ matched: boolean, missing: string[] }} result plus what is still absent.
 */
export function evaluateExpectation(text, expect) {
  const missing = []
  for (const pattern of expect.contains) {
    if (!text.includes(pattern)) missing.push(`missing: ${JSON.stringify(pattern)}`)
  }
  for (const pattern of expect.notContains) {
    if (text.includes(pattern)) missing.push(`unexpected: ${JSON.stringify(pattern)}`)
  }
  return { matched: missing.length === 0, missing }
}

/** Render a smoke result for the terminal card, reusing the process card. */
export function renderSmokeResult(value) {
  const stepLines = value.steps.map(
    (step) => `${step.matched ? '✓' : '✗'} ${step.id}${step.matched ? '' : ` — ${step.missing.join(', ')}`}`,
  )
  const header = [
    `[smoke] ${value.scenario}: ${value.verdict} (${value.durationMs}ms)`,
    ...stepLines,
    `Evidence: ${value.evidenceDir}`,
  ]
  const footer = value.next?.length ? ['', 'Next steps:', ...value.next.map((step) => `- ${step}`)] : []
  return renderProcessResult(value, { header, footer })
}

/** File-safe segment for the evidence directory name. */
function safeSegment(text) {
  return String(text).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'smoke'
}

/** Timestamp segment: 2026-10-25T01-23-45-678Z (colon-free for Windows). */
function stamp() {
  return new Date().toISOString().replace(/[:]/g, '-')
}

/**
 * Start the server, watch the console, stop it, and write evidence.
 *
 * Only a missing wrapper rejects (the run cannot work). Everything else — a
 * timeout, a crash, a missing pattern — comes back as a `fail` verdict with the
 * captured output, so the model can read why instead of catching an exception.
 * @param {object} options
 * @param {string} options.projectDir - Gradle project root (must contain the wrapper).
 * @param {object | string} options.scenario - scenario object, inline JSON, or file path.
 * @param {number} [options.timeoutMs] - overall budget; defaults to {@link DEFAULT_SMOKE_TIMEOUT_MS}.
 * @param {number} [options.tailChars] - characters kept from merged output (head+tail).
 * @param {AbortSignal} [options.signal] - exec.signal; kills the tree and reports aborted.
 * @param {object} [options.internals] - test seams: spawnImpl, killTreeImpl, platform,
 *   skipPreflight, javaVersionImpl, cwd, stopGraceMs.
 * @returns {Promise<object>} { verdict, scenario, steps, durationMs, timedOut, aborted,
 *   exitCode, signal, timeoutMs, warnings, evidenceDir, output: { text, truncated } }
 */
export async function runSmoke(options) {
  const {
    projectDir,
    scenario: rawScenario,
    timeoutMs = DEFAULT_SMOKE_TIMEOUT_MS,
    tailChars = 12_000,
    signal,
    internals = {},
  } = options
  if (typeof projectDir !== 'string' || projectDir.trim() === '') {
    throw new Error('projectDir is required: pass the Gradle project root')
  }
  const platform = internals.platform ?? process.platform
  const dir = path.resolve(projectDir)
  const scenario = await loadScenario(rawScenario, { cwd: internals.cwd })
  const preflight = internals.skipPreflight
    ? { wrapper: 'gradlew', warnings: [] }
    : await preflightGradle({ projectDir: dir, platform, internals })
  const argv = gradleArgv({ platform, projectDir: dir, task: scenario.task, args: scenario.args })
  const [program, ...spawnArgs] = argv
  const spawnImpl = internals.spawnImpl ?? spawn
  const killTreeImpl = internals.killTreeImpl ?? killTree
  const stopGraceMs = internals.stopGraceMs ?? STOP_GRACE_MS
  const killSettleMs = internals.killSettleMs ?? KILL_SETTLE_MS
  const startedAt = Date.now()

  const collector = createOutputCollector(tailChars)
  const decoder = new StringDecoder('utf8')
  const steps = scenario.steps.map((step) => ({ ...step, matched: false, matchedAtMs: null }))
  let scan = ''

  const child = spawnImpl(program, spawnArgs, {
    cwd: dir,
    windowsHide: true,
    windowsVerbatimArguments: platform === 'win32' && program === 'cmd.exe',
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  return await new Promise((resolve, reject) => {
    let finished = false
    let stopping = false
    let exit = null
    let timedOut = false
    let aborted = false
    let killTimer = null
    let timeoutTimer = null

    const cleanupTimers = () => {
      if (timeoutTimer !== null) clearTimeout(timeoutTimer)
      if (killTimer !== null) clearTimeout(killTimer)
      timeoutTimer = null
      killTimer = null
    }

    const settle = async (reason) => {
      if (finished) return
      finished = true
      cleanupTimers()
      if (signal?.removeEventListener) signal.removeEventListener('abort', onAbort)
      const text = (() => {
        const tail = collector.finalize()
        return tail
      })()
      const result = {
        verdict: reason === 'matched' ? 'pass' : 'fail',
        scenario: scenario.id,
        steps: steps.map((step) => ({ id: step.id, matched: step.matched, missing: step.missing ?? [] })),
        durationMs: Date.now() - startedAt,
        timedOut,
        aborted,
        exitCode: exit?.exitCode ?? null,
        signal: exit?.signal ?? null,
        timeoutMs,
        warnings: preflight.warnings,
        output: text,
        evidenceDir: '',
      }
      try {
        result.evidenceDir = await writeEvidence(dir, scenario, result)
      } catch {
        result.evidenceDir = ''
      }
      resolve(result)
    }

    const requestStop = (reason) => {
      if (finished || stopping) return
      stopping = true
      if (reason === 'timeout') timedOut = true
      if (reason === 'abort') aborted = true
      // A timeout or an abort kills immediately: waiting for a stalled server
      // would double the budget. A matched run gets the graceful `stop` first.
      if (reason !== 'matched') {
        killTreeImpl(platform, child.pid, {})
        killTimer = setTimeout(() => { void settle(reason) }, killSettleMs)
        return
      }
      try {
        if (child.stdin?.writable) child.stdin.write('stop\n')
      } catch {
        // The child may already be gone; the kill timer below covers it.
      }
      killTimer = setTimeout(() => {
        killTreeImpl(platform, child.pid, {})
        setTimeout(() => { void settle(reason) }, killSettleMs)
      }, stopGraceMs)
    }

    const onAbort = () => requestStop('abort')
    if (signal?.addEventListener) {
      if (signal.aborted) return requestStop('abort')
      signal.addEventListener('abort', onAbort, { once: true })
    }

    const consume = (chunk) => {
      const textChunk = typeof chunk === 'string' ? chunk : decoder.write(chunk)
      if (textChunk === '') return
      collector.push(textChunk)
      scan = (scan + textChunk).length > SCAN_WINDOW_CHARS
        ? (scan + textChunk).slice(-SCAN_WINDOW_CHARS)
        : scan + textChunk
      let allMatched = true
      for (const step of steps) {
        if (step.matched) continue
        const { matched, missing } = evaluateExpectation(scan, step.expect)
        step.missing = missing
        if (matched) {
          step.matched = true
          step.matchedAtMs = Date.now() - startedAt
        } else {
          allMatched = false
        }
      }
      if (allMatched && steps.every((step) => step.matched)) requestStop('matched')
    }

    child.stdout?.on('data', consume)
    child.stderr?.on('data', consume)
    child.on('error', (error) => {
      cleanupTimers()
      if (signal?.removeEventListener) signal.removeEventListener('abort', onAbort)
      finished = true
      reject(new Error(`failed to start ${program}: ${error.message}`))
    })
    child.on('close', (exitCode, exitSignal) => {
      exit = { exitCode, signal: exitSignal }
      const allMatched = steps.length > 0 && steps.every((step) => step.matched)
      void settle(allMatched && !timedOut && !aborted ? 'matched' : 'exited')
    })

    timeoutTimer = setTimeout(() => requestStop('timeout'), timeoutMs)
  })
}

/**
 * Write results.json, summary.md and console.log into the evidence directory.
 * @param {string} projectDir - project root; evidence lands under `.dsh/smoke/`.
 * @param {{ id: string }} scenario - scenario identity.
 * @param {object} result - the smoke result.
 * @returns {Promise<string>} absolute evidence directory.
 */
async function writeEvidence(projectDir, scenario, result) {
  const evidenceDir = path.join(projectDir, '.dsh', 'smoke', `${safeSegment(scenario.id)}-${stamp()}`)
  await mkdir(evidenceDir, { recursive: true })
  await writeFile(path.join(evidenceDir, 'results.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  await writeFile(path.join(evidenceDir, 'console.log'), result.output.text, 'utf8')
  const lines = [
    `# Smoke run: ${result.scenario}`,
    '',
    `- verdict: ${result.verdict}`,
    `- duration: ${result.durationMs} ms`,
    `- exit code: ${result.exitCode}`,
    `- timed out: ${result.timedOut}`,
    '',
    '## Steps',
    '',
    ...result.steps.map((step) => `- [${step.matched ? 'x' : ' '}] ${step.id}${step.missing?.length ? ` — ${step.missing.join(', ')}` : ''}`),
    '',
  ]
  if (result.warnings.length > 0) {
    lines.push('## Preflight warnings', '', ...result.warnings.map((warning) => `- ${warning}`), '')
  }
  await writeFile(path.join(evidenceDir, 'summary.md'), lines.join('\n'), 'utf8')
  return evidenceDir
}
