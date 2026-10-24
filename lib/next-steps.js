/**
 * Model-facing "next steps" attached to every tool result: the answer to
 * "what do I do now", derived from the value the tool just produced. Pure
 * functions, so a live call and a session-log replay render the same hints.
 *
 * The hints name the next tool call, the argument it needs, and the file worth
 * reading. A model that stops after a green result — or that retries the same
 * failing build unchanged — is the failure mode this contract exists to
 * prevent. Each list stays short (2–4 items): a wall of advice reads like
 * documentation and gets skimmed past.
 * @module minecraft-dev/lib/next-steps
 */

/**
 * Description of the `next` output field every tool result carries. One
 * constant so the four tool schemas cannot describe the contract differently.
 */
export const NEXT_OUTPUT_DESCRIPTION = 'What to do next, derived from this result: the next tool call and its '
  + 'arguments, or the file worth reading. Empty when the workflow is finished.'

/** Platform → the bundled skill that owns the build/deploy loop for it. */
export const SKILL_BY_PLATFORM = {
  paper: 'minecraft-paper-plugin',
  spigot: 'minecraft-spigot-legacy',
  fabric: 'minecraft-fabric-mod',
  forge: 'minecraft-forge-mod',
  neoforge: 'minecraft-neoforge-mod',
}

/**
 * Format hints as the shared block appended to every tool result.
 * @param {string[] | undefined} next - hints, empty/undefined for none.
 * @returns {string} the `Next steps:` block, or '' when there is nothing to say.
 */
export function formatNextSteps(next) {
  if (!Array.isArray(next) || next.length === 0) return ''
  return `Next steps:\n${next.map((step) => `- ${step}`).join('\n')}`
}

/**
 * Append the block to a rendered body, keeping exactly one blank line between
 * and dropping trailing newlines the body already carried.
 * @param {string} text - rendered tool text (never undefined).
 * @param {string[] | undefined} next - hints.
 * @returns {string} the text with the block appended, or the text unchanged.
 */
export function appendNextSteps(text, next) {
  const block = formatNextSteps(next)
  if (block === '') return text
  if (text === '') return block
  return `${text.replace(/\n+$/, '')}\n\n${block}`
}

/** Path separator matching the projectDir the caller sees, for hint paths. */
function shellSeparator(projectDir) {
  return projectDir.includes('\\') ? '\\' : '/'
}

/**
 * Hints after a successful mc_scaffold: build it, then run or deploy it.
 * The platform decides which skill owns the rest of the loop and whether the
 * artifact is copied into a server or started by a Gradle run task.
 * @param {{ platform: string, minecraftVersion: string, projectDir: string, buildCommand: string }} value
 * @returns {string[]} next-step hints.
 */
export function scaffoldNextSteps(value) {
  const steps = [
    `Build it: mc_gradle task="build" projectDir="${value.projectDir}" — or run "${value.buildCommand}" in that directory `
      + '(the first build downloads dependencies and takes several minutes).',
  ]
  if (value.platform === 'spigot' && value.minecraftVersion.startsWith('1.7')) {
    const sep = shellSeparator(value.projectDir)
    steps.push(
      `Before the build, place the vendored spigot-api jar into ${value.projectDir}${sep}libs${sep} `
        + '(no public maven hosts 1.7.10 spigot-api; see libs/README.txt).',
    )
  }
  const skill = SKILL_BY_PLATFORM[value.platform]
  steps.push(skill
    ? `Load the ${skill} skill for this platform's build and deploy steps.`
    : 'Load the minecraft-java-build skill for the JDK × Gradle matrix and common build failures.')
  if (value.platform === 'paper' || value.platform === 'spigot') {
    steps.push('When the build passes, copy build/libs/*.jar into the server plugins/ directory and restart the server.')
  } else {
    steps.push('When the build passes, run it: mc_gradle task="runClient" (needs a display) or task="runServer" (accept the EULA once).')
  }
  return steps
}

/** Substrings that identify a JDK/toolchain mismatch in Gradle output. */
const JDK_MISMATCH_RE = /unsupported class file major version|has been compiled by a more recent version|invalid (?:source|target|release)|no matching toolchain|could not determine java version|requires at least jvm runtime version/
/** Substrings that identify a dependency-download failure in Gradle output. */
const NETWORK_FAILURE_RE = /could not resolve|could not download|could not get resource|unknownhost|pkix|sslhandshake|connect timed out|connection reset|unable to load maven meta-data/

/**
 * Hints after one mc_gradle run: the next tool call on success, and the most
 * likely cause plus the retry with the right flag on failure. The classification
 * reads the captured output (which is already truncated head+tail), so it looks
 * for the loud error strings rather than parsing Gradle's log format.
 * @param {{ task: string, projectDir: string }} args - the call arguments.
 * @param {{ exitCode: number | null, signal: string | null, timedOut: boolean, aborted: boolean, timeoutMs: number, output: { text: string } }} value
 * @returns {string[]} next-step hints.
 */
export function gradleNextSteps(args, value) {
  const { task, projectDir } = args
  const output = value.output?.text ?? ''
  if (value.aborted) {
    return [
      'The run was cancelled; a Gradle daemon may still hold the project — run mc_gradle task="--stop" in that project, then retry.',
    ]
  }
  if (value.timedOut) {
    return [
      `Killed at the ${value.timeoutMs}ms timeout. Re-run the same task with a larger timeoutMs, or add args ["--no-daemon"] so no daemon keeps the run alive.`,
      'If this was the first build, the time went into downloading dependencies — the next run reuses the cache and is much faster.',
    ]
  }
  if (value.exitCode === 0) {
    if (task === 'build' || task === 'assemble') {
      return [
        'Build passed. Run it with mc_gradle task="runClient" (requires a display) or task="runServer" (accept the EULA first).',
        'Tests not run yet? mc_gradle task="test" runs the unit tests before shipping the jar.',
      ]
    }
    if (task === 'test' || task === 'check') {
      return ['Tests passed. Build the distributable with mc_gradle task="build".']
    }
    if (task === 'runData') {
      return ['Data generation finished; review the regenerated files under src/main/generated (or the paths your datagen config writes).']
    }
    if (task === 'runClient' || task === 'runServer') {
      return [`The game run exited cleanly. Check logs/latest.log and run/crash-reports/ in ${projectDir} if the session ended earlier than expected.`]
    }
    if (task === '--stop') {
      return ['Daemons stopped. Re-run the task that was blocked — the project lock is released now.']
    }
    return ['Task passed. Continue with mc_gradle task="build" once the code for the next step is in place.']
  }
  const lower = output.toLowerCase()
  const steps = []
  if (JDK_MISMATCH_RE.test(lower)) {
    steps.push(
      'JDK/toolchain mismatch: run Gradle on the JDK the project targets, or let the toolchain resolver provision it '
        + '(the minecraft-java-build skill has the Java × Gradle table).',
    )
  }
  if (NETWORK_FAILURE_RE.test(lower)) {
    steps.push('Dependency resolution failed — check the network/proxy, then retry with args ["--refresh-dependencies"].')
  }
  if (/outofmemoryerror/.test(lower)) {
    steps.push('The build JVM ran out of memory — raise org.gradle.jvmargs (e.g. -Xmx2g) in gradle.properties.')
  }
  if (/daemon/.test(lower) && /(could not|failed|lock|busy)/.test(lower)) {
    steps.push(`A leftover Gradle daemon may hold the project lock — run mc_gradle task="--stop" in ${projectDir}, then retry.`)
  }
  steps.push('Read the last FAILURE/error block above, fix one cause, then re-run the same task; add args ["--stacktrace"] when the cause is not obvious.')
  steps.push('Only one mc_gradle run per projectDir at a time — wait for this one to be fixed instead of starting a parallel run.')
  return steps
}

/**
 * Hints after an mc_port_audit: blockers first, then the actual migration path.
 * @param {{ ok: boolean, project: { platform: string, minecraftVersion: string, dir: string } }} value
 * @returns {string[]} next-step hints.
 */
export function auditNextSteps(value) {
  const dir = value.project.dir
  if (!value.ok) {
    return [
      'Fix every blocker first — each finding above carries file:line and a repair hint.',
      `Then re-run the same audit: mc_port_audit projectDir="${dir}" platform="${value.project.platform}" minecraftVersion="${value.project.minecraftVersion}".`,
      'Load the minecraft-porting skill for the version-family breakpoints and the regenerate-skeleton procedure.',
    ]
  }
  return [
    `No blockers. Scaffold the target skeleton in a new empty directory: mc_scaffold platform="${value.project.platform}" `
      + `minecraftVersion="${value.project.minecraftVersion}" (fabric/forge/neoforge require a pinned version; paper/spigot are lenient).`,
    'Port module by module with mc_gradle task="build" as the gate after each module, or upgrade in place for a small same-loader step.',
  ]
}

/**
 * Hints after an mc_codex architect run: verify the handed-back skeleton, or
 * fall back to the subagent chain when Codex stayed unavailable.
 * @param {{ exitCode: number | null, signal: string | null, timedOut: boolean, aborted: boolean, projectDir: string, lastMessageFile: string }} value
 * @returns {string[]} next-step hints.
 */
export function codexNextSteps(value) {
  if (value.aborted) {
    return ['The run was cancelled; the Codex session may still exist — resume it from the Codex desktop app or fall back to the mc-plan/mc-skeleton chain.']
  }
  if (value.timedOut) {
    return ['The architect run hit timeoutMs and was killed — retry with a narrower goal or a larger timeoutMs; do not retry blindly.']
  }
  if (value.exitCode !== 0) {
    return [
      'Codex reported a failure (auth, quota or the prompt); the output above is unmodified. Do not retry blindly.',
      `Read the last message file for what it did produce: ${value.lastMessageFile}.`,
      'Fall back to the subagent_mc_plan/skeleton/content/verify chain if Codex stays unavailable.',
    ]
  }
  return [
    `Verify the skeleton: mc_gradle task="build" projectDir="${value.projectDir}".`,
    'Confirm the [TODO: Agent B] marker count is 0 and FILL-SPEC.md signatures are unchanged (see the minecraft-codex-architect skill).',
  ]
}

/**
 * Hints after an mc_smoke run: point at the evidence, or at the first log error
 * when a pattern never appeared.
 * @param {{ verdict: string, timedOut: boolean, aborted: boolean, evidenceDir: string }} value
 * @returns {string[]} next-step hints.
 */
export function smokeNextSteps(value) {
  if (value.aborted) {
    return ['The smoke run was cancelled; a server JVM may still be starting — run mc_gradle task="--stop" in that project, then retry.']
  }
  if (value.verdict === 'pass') {
    return [
      `Evidence: ${value.evidenceDir} — results.json records when each pattern matched, console.log keeps the full output.`,
      'Repeat the scenario against a real server (copy the built jar into plugins/ or mods/) before declaring the feature done.',
    ]
  }
  if (value.timedOut) {
    return [
      'The run hit timeoutMs before the pattern appeared: read the output above, then widen timeoutMs only after the cause is clear.',
      'A server that never prints "Done (" usually has a JDK or loader mismatch — see the minecraft-java-build skill for this version line.',
    ]
  }
  return [
    `Read ${value.evidenceDir}/console.log (or the output above): the missing patterns name where startup stalled.`,
    'Fix the first error in the log, then rerun the same scenario — the run is cheap after the first dependency download.',
  ]
}
