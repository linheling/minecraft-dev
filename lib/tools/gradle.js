/**
 * `mc_gradle` definition, extracted from tools.js so it can be mounted either as
 * part of the combined `minecraft-tools` component or alone through
 * `minecraft-dev/tools-gradle`. The timeout and output tail come from the
 * owning component's Config, so a standalone mount keeps the same defaults.
 * @module minecraft-dev/lib/tools/gradle
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { GRADLE_DESCRIPTION } from '../descriptions.js'
import { renderGradleResult, runGradle } from '../gradle.js'
import { NEXT_OUTPUT_DESCRIPTION, gradleNextSteps } from '../next-steps.js'
import { gradleCallView, gradleResultView } from '../present.js'

/**
 * @param {{ gradleTimeoutMs?: number, outputTailChars?: number }} config
 * @returns {object} the compiled mc_gradle tool definition.
 */
export function createGradleTool(config = {}) {
  const gradleTimeoutMs = config.gradleTimeoutMs ?? 600_000
  const outputTailChars = config.outputTailChars ?? 12_000
  return defineTool({
    name: 'mc_gradle',
    description: GRADLE_DESCRIPTION,
    parameters: {
      projectDir: { type: 'string', required: true, description: 'Absolute path of the Gradle project root (must contain gradlew or gradlew.bat).' },
      task: { type: 'string', required: true, description: 'Gradle task to run, e.g. build, clean, runClient, runServer, runData. No whitespace or shell metacharacters.' },
      args: { type: 'array', items: { type: 'string' }, description: 'Extra arguments appended to the task, e.g. --no-daemon, -Pfoo=bar. No empty strings, control characters, or cmd.exe metacharacters on Windows.' },
      timeoutMs: { type: 'number', description: `Timeout in milliseconds; defaults to ${gradleTimeoutMs}. Kills the whole process tree on expiry.` },
      description: { type: 'string', description: 'Short human description for the terminal card.' },
    },
    output: {
      // Field names mirror the tool-bash foreground branch (canonicalBashResult),
      // minus sandbox/spillPath: mc_gradle has no sandbox and writes no spill
      // file — stdout+stderr are one merged stream with an inline truncation marker.
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          exitCode: { required: true, oneOf: [{ type: 'integer' }, { type: 'null' }] },
          signal: { required: true, oneOf: [{ type: 'string' }, { type: 'null' }] },
          timedOut: { type: 'boolean', required: true },
          aborted: { type: 'boolean', required: true },
          timeoutMs: { type: 'number', required: true },
          output: {
            type: 'object',
            additionalProperties: false,
            required: true,
            properties: {
              text: { type: 'string', required: true },
              truncated: { type: 'boolean', required: true },
            },
          },
          warnings: {
            type: 'array',
            required: true,
            items: { type: 'string' },
            description: 'Environment findings detected before Gradle started (missing JDK, JDK/toolchain mismatch, '
              + 'Gradle version too old for the running JDK, Gradle 9 needing Java 17+). Empty when clean.',
          },
          next: {
            type: 'array',
            required: true,
            items: { type: 'string' },
            description: NEXT_OUTPUT_DESCRIPTION,
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderGradleResult(value) }],
    },
    async execute(args, exec) {
      const result = await runGradle({
        projectDir: args.projectDir,
        task: args.task,
        args: args.args,
        timeoutMs: args.timeoutMs ?? gradleTimeoutMs,
        signal: exec.signal,
        tailChars: outputTailChars,
      })
      return { ...result, next: gradleNextSteps({ task: args.task, projectDir: args.projectDir }, result) }
    },
    presentCall: gradleCallView,
    presentResult: gradleResultView,
  })
}
