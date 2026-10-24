/**
 * `mc_smoke` definition: the opt-in server smoke runner.
 *
 * Mounted by its own component (`minecraft-dev/tools-smoke`, disabled by default
 * in cordis.patch.yml) because it starts a real JVM and needs a JDK + network
 * for the first `runServer`. The run itself lives in lib/smoke.js.
 * @module minecraft-dev/lib/tools/smoke
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { NEXT_OUTPUT_DESCRIPTION, smokeNextSteps } from '../next-steps.js'
import { renderSmokeResult, runSmoke } from '../smoke.js'

const SMOKE_DESCRIPTION = [
  'Start a Gradle run task in the project (default `runServer`), watch the merged console for patterns, then stop '
  + 'the server and write evidence under `<projectDir>/.dsh/smoke/`. The tool returns a pass/fail verdict per scenario '
  + 'step — not a code review and not a substitute for mc_gradle build.',
  'Use it after `mc_gradle task="build"` is green when the question is "does it actually start and reach the expected '
  + 'state" (server up, plugin/mod loaded, no startup exception). Do not use it as a build check, and do not run it '
  + 'concurrently with another Gradle task in the same project.',
  'Constraints: this starts a real JVM, so the JDK must match the version line (see minecraft-java-build); the first '
  + 'run downloads dependencies and may take several minutes — the overall budget defaults to 600000 ms and can be '
  + 'raised with timeoutMs. The scenario is plain JSON: `{"id":"paper-startup","task":"runServer","args":["--no-daemon"],'
  + '"steps":[{"id":"ready","expect":{"contains":["Done ("]}}]}`. Pass it inline, or pass a path to a JSON file. Every '
  + '`contains` pattern must appear and every `notContains` pattern must stay absent before the run passes. '
  + 'On timeout or abort the process tree is killed. When it fails, read `console.log` in the returned evidenceDir: '
  + 'the missing patterns name where startup stalled.',
].join('\n\n')

/** @returns {object} the compiled mc_smoke tool definition. */
export function createSmokeTool(config = {}) {
  const defaultTimeoutMs = config.timeoutMs ?? 600_000
  const outputTailChars = config.outputTailChars ?? 12_000
  return defineTool({
    name: 'mc_smoke',
    description: SMOKE_DESCRIPTION,
    parameters: {
      projectDir: {
        type: 'string',
        required: true,
        description: 'Absolute path of the Gradle project root (must contain gradlew or gradlew.bat).',
      },
      scenario: {
        type: 'string',
        required: true,
        description: 'Inline scenario JSON (starts with `{`) or a path to a JSON file. Shape: '
          + '{"id":"...","task":"runServer","args":["--no-daemon"],"steps":[{"id":"ready","expect":{"contains":["Done ("]}}]}. '
          + 'Each expect needs contains and/or notContains.',
      },
      timeoutMs: {
        type: 'number',
        description: `Overall budget in milliseconds for the server run; defaults to ${defaultTimeoutMs}. `
          + 'On expiry the process tree is killed and the verdict is fail with timedOut=true.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          verdict: { type: 'string', required: true, description: 'pass when every step matched before the timeout.' },
          scenario: { type: 'string', required: true, description: 'The scenario id (default "smoke").' },
          steps: {
            type: 'array',
            required: true,
            description: 'Per-step match results, in scenario order.',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                matched: { type: 'boolean', required: true },
                missing: { type: 'array', required: true, items: { type: 'string' } },
              },
            },
          },
          durationMs: { type: 'number', required: true },
          timedOut: { type: 'boolean', required: true },
          aborted: { type: 'boolean', required: true },
          exitCode: { required: true, oneOf: [{ type: 'integer' }, { type: 'null' }] },
          signal: { required: true, oneOf: [{ type: 'string' }, { type: 'null' }] },
          timeoutMs: { type: 'number', required: true },
          warnings: {
            type: 'array',
            required: true,
            items: { type: 'string' },
            description: 'Preflight findings (missing JDK, JDK/toolchain mismatch) detected before the spawn.',
          },
          evidenceDir: {
            type: 'string',
            required: true,
            description: 'Directory holding results.json, summary.md and console.log; empty when writing failed.',
          },
          output: {
            type: 'object',
            additionalProperties: false,
            required: true,
            properties: {
              text: { type: 'string', required: true },
              truncated: { type: 'boolean', required: true },
            },
          },
          next: {
            type: 'array',
            required: true,
            items: { type: 'string' },
            description: NEXT_OUTPUT_DESCRIPTION,
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderSmokeResult(value) }],
    },
    async execute(args, exec) {
      const result = await runSmoke({
        projectDir: args.projectDir,
        scenario: args.scenario,
        timeoutMs: args.timeoutMs ?? defaultTimeoutMs,
        tailChars: outputTailChars,
        signal: exec.signal,
      })
      return { ...result, next: smokeNextSteps(result) }
    },
  })
}
