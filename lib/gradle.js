/**
 * Execution mechanism for the mc_gradle tool: runs one gradlew task in a
 * project directory via node:child_process spawn, with bounded output
 * collection, timeout/abort process-tree termination, and the dsh canonical
 * result shape.
 *
 * The generic runner (spawn, output cap, tree kill, markers) lives in
 * `./run-process.js`, shared with mc_codex; this module owns only what is
 * gradle-specific: the argv shape and the gradlew wording. The spawn
 * implementation stays injectable (`internals.spawnImpl`) so unit tests run a
 * fake child process with no real subprocess.
 * @module minecraft-dev/lib/gradle
 */

import path from 'node:path'
import { cmdShimArgv, quoteCmdArg } from './cmd-quote.js'
import { formatNextSteps } from './next-steps.js'
import { acquireBuildLock, releaseBuildLock } from './build-lock.js'
import { preflightGradle } from './preflight.js'
import { capOutput, killTree, renderProcessResult, runProcess } from './run-process.js'

// Re-exported for callers (and tests) that reach the generic helpers through
// this module, exactly as before the extraction.
export { capOutput, killTree }

/** Characters cmd.exe treats specially even next to a quoted argument. */
const CMD_METACHARACTERS = /["&|<>^()%!]/
/** C0 controls, DEL, and the newline family: never valid in one argv token. */
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/

/**
 * Reject task/args that could escape the cmd.exe quoting on Windows (or that
 * cannot be a Gradle token at all). Validation happens on every platform so a
 * result never depends on where the model-authored call runs; only the cmd.exe
 * metacharacter set is Windows-specific, because POSIX passes argv straight to
 * execve with no shell.
 * @param {{ task: unknown, args?: unknown, platform?: string }} options
 * @returns {void}
 */
export function validateGradleInvocation({ task, args = [], platform = process.platform }) {
  if (typeof task !== 'string' || task.length === 0) {
    throw new Error('gradle task must be a non-empty string')
  }
  if (/\s/.test(task)) {
    throw new Error('gradle task must not contain whitespace')
  }
  if (CONTROL_CHARACTERS.test(task)) {
    throw new Error('gradle task must not contain control characters')
  }
  if (CMD_METACHARACTERS.test(task)) {
    throw new Error('gradle task must not contain cmd.exe metacharacters (one of " & | < > ^ ( ) % !)')
  }
  if (!Array.isArray(args)) {
    throw new Error('gradle args must be an array of strings')
  }
  for (const arg of args) {
    if (typeof arg !== 'string') {
      throw new Error('gradle args must be an array of strings')
    }
    if (arg.length === 0) {
      throw new Error('gradle args must not contain an empty argument')
    }
    if (CONTROL_CHARACTERS.test(arg)) {
      throw new Error('gradle args must not contain control characters')
    }
    if (platform === 'win32' && CMD_METACHARACTERS.test(arg)) {
      throw new Error('gradle args must not contain cmd.exe metacharacters (one of " & | < > ^ ( ) % !) on win32')
    }
  }
}

/**
 * Construct the full argv for one gradlew run. Windows executes the .bat
 * through cmd.exe (`/d /s /c`), with each extra argument quoted and embedded
 * quotes rejected by {@link validateGradleInvocation}; POSIX runs `./gradlew`
 * directly. The quoting rule itself is shared with the Codex paths
 * (`./cmd-quote.js`), so a token cmd.exe cannot express fails the same way
 * everywhere instead of being rewritten differently per call site.
 *
 * win32 specifics (real-Windows smoke, V03 R10): the wrapper is resolved to an
 * absolute path inside projectDir and the whole command is wrapped in outer
 * quotes (`""C:\proj\gradlew.bat" build"`), so cmd never depends on its
 * current-directory command search (the `NoDefaultCurrentDirectoryInExePath`
 * env var disables it on hardened hosts) and `/s /c` strips only the outer
 * quotes. The caller must spawn with `windowsVerbatimArguments: true` on
 * win32: node's default quoting escapes `"` to `\"`, which cmd.exe does not
 * parse, and this argv already carries the exact quotes cmd needs.
 * @param {object} options
 * @param {string} [options.platform] - host platform; defaults to process.platform.
 * @param {string} [options.gradlew] - wrapper script name (defaults to
 *   `gradlew.bat` on win32, `./gradlew` elsewhere); resolved against projectDir on win32.
 * @param {string} [options.projectDir] - project root the win32 wrapper is
 *   resolved against; defaults to the process cwd.
 * @param {string} options.task - the Gradle task to run, e.g. 'build'.
 * @param {string[]} [options.args] - extra arguments appended to the task.
 * @returns {string[]} the complete spawn argv.
 */
export function gradleArgv(options) {
  const { platform = process.platform, gradlew, task, args = [], projectDir = '.' } = options
  validateGradleInvocation({ task, args, platform })
  if (platform === 'win32') {
    const wrapper = path.win32.resolve(projectDir, gradlew ?? 'gradlew.bat')
    // `task` is a bare token (validateGradleInvocation rejects whitespace and
    // metacharacters); the wrapper and the extra args carry quoting.
    const tokens = [
      quoteCmdArg(wrapper, 'gradlew wrapper path'),
      task,
      ...args.map((arg) => quoteCmdArg(arg, 'gradle argument')),
    ]
    return cmdShimArgv(tokens.join(' '))
  }
  return [gradlew ?? './gradlew', task, ...args]
}

/**
 * Run one gradlew task in the foreground and return the canonical result.
 * Non-zero exits are reported in the result, never thrown; only failures that
 * prevent the spawn (missing wrapper, a concurrent run in the same project, a
 * spawn error) reject, with a readable message.
 *
 * Before spawning, {@link preflightGradle} checks the wrapper and the JDK the
 * build would use; its findings ride back as `warnings` so the model can fix
 * the environment instead of re-reading a wall of Gradle log. Only one run per
 * project at a time is admitted: two concurrent Gradle builds corrupt each
 * other's locks and build directories, and the second one is always a mistake.
 * The timeout timer races the exec abort signal, and whoever fires first kills
 * the process tree via {@link runProcess}.
 * @param {object} options
 * @param {string} options.projectDir - project root; must contain gradlew/gradlew.bat.
 * @param {string} options.task - gradle task, e.g. 'build'.
 * @param {string[]} [options.args] - extra arguments appended to the task.
 * @param {number} options.timeoutMs - timeout in milliseconds; kills the tree on expiry.
 * @param {AbortSignal} [options.signal] - exec.signal; kills the tree on abort.
 * @param {number} options.tailChars - characters to keep from merged output (head+tail).
 * @param {{ spawnImpl?: Function, killTreeImpl?: Function, platform?: string, skipPreflight?: boolean, javaVersionImpl?: Function }} [internals]
 *   - spawnImpl(program, args, options) -> ChildProcess-like; defaults to node's spawn.
 *   - killTreeImpl(platform, pid) -> void; defaults to {@link killTree}.
 *   - platform: host override for argv selection, spawn flags and the kill branch.
 *   - skipPreflight: test seam for the runner tests that fake the spawn; the
 *     tool always preflights, so this is never set in production.
 *   - javaVersionImpl: test seam forwarded to {@link preflightGradle}.
 * @returns {Promise<{ exitCode: number|null, signal: string|null, timedOut: boolean, aborted: boolean, timeoutMs: number, output: { text: string, truncated: boolean }, warnings: string[] }>}
 */
export async function runGradle(options) {
  const { projectDir, task, args = [], timeoutMs, signal, tailChars, internals = {} } = options
  const platform = internals.platform ?? process.platform
  // Validate the invocation before touching the filesystem: an injection-shaped
  // task must fail the same way whether or not the project exists.
  const argv = gradleArgv({ platform, projectDir, task, args })
  const projectKey = acquireBuildLock(projectDir, task, 'mc_gradle')
  try {
    const preflight = internals.skipPreflight === true
      ? { warnings: [] }
      : await preflightGradle({ projectDir, platform, internals })
    const result = await runProcess({
      argv,
      cwd: projectDir,
      timeoutMs,
      tailChars,
      signal,
      labels: { program: 'gradlew', abort: 'mc_gradle' },
      internals,
    })
    return { ...result, warnings: preflight.warnings }
  } finally {
    releaseBuildLock(projectKey)
  }
}

/**
 * Render a canonical mc_gradle result into the model-facing text, reusing the
 * shared dsh marker contract (tool-bash render.ts): optional `[preflight] …`
 * warnings above the body, the output body, the `Next steps:` block, then the
 * timeout / signal / exit markers, with the exit marker last because the
 * terminal-card parse anchors there. `[stderr]` sections never appear —
 * stdout and stderr are one merged stream — and the truncation notice is
 * already inline in output.text (no spill file is written).
 * @param {{ exitCode: number|null, signal: string|null, timedOut: boolean, timeoutMs: number, output: { text: string }, warnings?: string[], next?: string[] }} result
 * @returns {string} the marker-suffixed output text.
 */
export function renderGradleResult(result) {
  const warnings = Array.isArray(result.warnings) ? result.warnings : []
  const header = warnings.map((warning) => `[preflight] ${warning}`)
  const nextBlock = formatNextSteps(result.next)
  const footer = nextBlock === '' ? [] : ['', ...nextBlock.split('\n')]
  return renderProcessResult(result, { header, footer })
}
