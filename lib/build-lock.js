/**
 * One live Gradle-backed run per project root.
 *
 * Two Gradle processes in the same project corrupt each other's locks and
 * build directories, so both `mc_gradle` (a task) and `mc_smoke` (a
 * `runServer`) claim the project's slot before spawning and release it when
 * the process tree is gone. The lock is a process-local Map: it guards
 * concurrent tool calls from one dsh session, which is where the damage comes
 * from; it is not a filesystem lock and does not coordinate separate dsh
 * processes.
 * @module minecraft-dev/lib/build-lock
 */

import path from 'node:path'

/** Project roots with a live run, keyed by `path.resolve(projectDir)`. */
const activeRuns = new Map()

/**
 * Claim the project's build slot, or reject if another run already holds it.
 *
 * The message names the caller (`mc_gradle` / `mc_smoke`), the task that holds
 * the slot and its age, so the model can decide to wait instead of retrying in
 * a loop.
 * @param {string} projectDir - project root as given by the caller.
 * @param {string} task - the task being run (diagnostic only).
 * @param {string} [owner] - tool name that is claiming the slot.
 * @returns {string} the resolved key to pass back to {@link releaseBuildLock}.
 */
export function acquireBuildLock(projectDir, task, owner = 'mc_gradle') {
  const key = path.resolve(projectDir)
  const active = activeRuns.get(key)
  if (active !== undefined) {
    throw new Error(
      `another ${active.owner} run is already active in ${projectDir} (task "${active.task}" started `
      + `${Date.now() - active.startedAt}ms ago): wait for it to finish instead of starting a parallel build.`,
    )
  }
  activeRuns.set(key, { owner, task, startedAt: Date.now() })
  return key
}

/**
 * Release a slot claimed by {@link acquireBuildLock}. Safe to call twice.
 * @param {string} key - the key returned by {@link acquireBuildLock}.
 */
export function releaseBuildLock(key) {
  activeRuns.delete(key)
}
