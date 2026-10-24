/**
 * `mc_smoke` definition: the opt-in server smoke runner.
 *
 * Mounted by its own component (`minecraft-dev/tools-smoke`, disabled by default
 * in cordis.patch.yml) because it starts a real JVM and needs a JDK + network
 * for the first `runServer`. The run itself lives in lib/smoke.js.
 * @module minecraft-dev/lib/tools/smoke
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { SMOKE_DESCRIPTION } from '../descriptions.js'
import { NEXT_OUTPUT_DESCRIPTION, smokeNextSteps } from '../next-steps.js'
import { renderSmokeResult, runSmoke } from '../smoke.js'

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
