/**
 * Minecraft development tools for DeepSeek Harness. v0.3 registers
 * `mc_scaffold` for Paper, Fabric, Forge (1.7.10/1.12.2/1.16.5/1.20.1),
 * NeoForge and Spigot (1.7.10/1.12.2), plus `mc_gradle` (v0.3) which runs a
 * Gradle task via the project wrapper, and `mc_port_audit` (v0.11) which
 * statically audits a project against a target platform/version before a port.
 * Deployment tunables (gradle timeout, output tail) are Config fields —
 * see cordis.patch.yml.
 * @module minecraft-dev/tools
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import Schema from '@deepseek-ai/schemastery'
import { GRADLE_DESCRIPTION, PORT_AUDIT_DESCRIPTION, SCAFFOLD_DESCRIPTION } from './lib/descriptions.js'
import { renderGradleResult, runGradle } from './lib/gradle.js'
import { appendNextSteps, auditNextSteps, gradleNextSteps, scaffoldNextSteps } from './lib/next-steps.js'
import { auditProject } from './lib/port-audit.js'
import { gradleCallView, gradleResultView, scaffoldCallView } from './lib/present.js'
import { scaffoldProject } from './lib/scaffold.js'
import { SUPPORTED_PLATFORMS } from './lib/versions.js'

/** Shared description of the `next` output field: the hint block every tool returns. */
const NEXT_OUTPUT_DESCRIPTION = 'Concrete next tool calls / files to read after this result, in order. '
  + 'Empty when there is nothing actionable left.'

const SCAFFOLD_OUTPUT_DESCRIPTION = {
  platform: 'The platform scaffolded.',
  minecraftVersion: 'The Minecraft version the project targets.',
  projectDir: 'Absolute path of the created project root.',
  filesCreated: 'Root-relative paths of every file written.',
  buildCommand: 'The shell command that builds the project.',
  wrapperReady: 'Whether the Gradle wrapper files were included.',
}

/** Cordis plugin name. */
export const name = 'minecraft-tools'
/** Service required by the tool consumer. */
export const inject = ['tools']

/**
 * Deployment configuration. Defaults match the values written out in
 * cordis.patch.yml; the schema default is the source of truth.
 */
export const Config = Schema.object({
  /** Default mc_gradle timeout in milliseconds (old lines download slowly on first build). */
  gradleTimeoutMs: Schema.number().default(600_000),
  /** Characters mc_gradle keeps from merged output (head + tail around the truncation marker). */
  outputTailChars: Schema.number().default(12_000),
})

/** One-line summary of an audit run, followed by every finding with file:line. */
function renderAuditResult(value) {
  const lines = [
    `Migration audit against ${value.project.platform} ${value.project.minecraftVersion} `
      + `(line ${value.target.line}, Java ${value.target.javaVersion}): `
      + (value.ok ? 'no blockers.' : 'blocked.'),
    `Project: ${value.project.dir}`,
    `Findings: ${value.summary.blockers} blocker(s), ${value.summary.warnings} warning(s), `
      + `${value.summary.infos} info(s).`,
  ]
  const order = { blocker: 0, warning: 1, info: 2 }
  const sorted = [...value.findings].sort(
    (a, b) => (order[a.severity] ?? 3) - (order[b.severity] ?? 3),
  )
  for (const finding of sorted) {
    const where = finding.file
      ? ` — ${finding.file}${typeof finding.line === 'number' ? `:${finding.line}` : ''}`
      : ''
    lines.push(`- [${finding.severity}] ${finding.code}: ${finding.message}${where}`)
    if (finding.hint) lines.push(`  hint: ${finding.hint}`)
  }
  if (sorted.length === 0) {
    lines.push('No issues detected. Still verify API signatures against the target version before porting.')
  }
  return lines.join('\n')
}

/** Register the minecraft-dev tools on `ctx.tools`. */
export function apply(ctx, config = {}) {
  ctx.tools.register(defineTool({
    name: 'mc_scaffold',
    description: SCAFFOLD_DESCRIPTION,
    parameters: {
      platform: {
        type: 'string',
        required: true,
        enum: [...SUPPORTED_PLATFORMS],
        description: `Project platform. Supported: ${SUPPORTED_PLATFORMS.join(', ')}.`,
      },
      targetDir: {
        type: 'string',
        required: true,
        description: 'Absolute path of the new project root directory; must not exist or must be empty.',
      },
      name: {
        type: 'string',
        required: true,
        description: 'Project name in lowercase kebab-case (e.g. my-plugin); used as the jar name and plugin/mod id.',
      },
      packageName: {
        type: 'string',
        required: true,
        description: 'Java package name, e.g. com.example.myplugin.',
      },
      minecraftVersion: {
        type: 'string',
        required: true,
        description: 'Target Minecraft version, e.g. 1.7.10, 1.12.2, 1.16.5, 1.21.8, 1.21.x, 26.3. Supported lines per platform are listed in the error when unknown.',
      },
      javaVersion: {
        type: 'integer',
        enum: [8, 17, 21, 25],
        description: 'Java language level (8, 17, 21, or 25). Omit to use the era default: 8 for the 1.7.10/1.12.2/1.16.5 lines (spigot/forge); 17 for fabric/neoforge 1.20.x; 21 for paper 1.20.x and the 1.21.x lines; 25 for 26.x.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          platform: { type: 'string', required: true, description: SCAFFOLD_OUTPUT_DESCRIPTION.platform },
          minecraftVersion: { type: 'string', required: true, description: SCAFFOLD_OUTPUT_DESCRIPTION.minecraftVersion },
          projectDir: { type: 'string', required: true, description: SCAFFOLD_OUTPUT_DESCRIPTION.projectDir },
          filesCreated: {
            type: 'array',
            required: true,
            items: { type: 'string' },
            description: SCAFFOLD_OUTPUT_DESCRIPTION.filesCreated,
          },
          buildCommand: { type: 'string', required: true, description: SCAFFOLD_OUTPUT_DESCRIPTION.buildCommand },
          wrapperReady: { type: 'boolean', required: true, description: SCAFFOLD_OUTPUT_DESCRIPTION.wrapperReady },
          next: {
            type: 'array',
            required: true,
            items: { type: 'string' },
            description: NEXT_OUTPUT_DESCRIPTION,
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: appendNextSteps(
          `Created ${value.platform} project ${value.projectDir} for Minecraft ${value.minecraftVersion} `
          + `(${value.filesCreated.length} files, Gradle wrapper included). `
          + `Build with: ${value.buildCommand} — the first build downloads dependencies and takes several minutes.`
          + (value.platform === 'spigot' && value.minecraftVersion.startsWith('1.7')
            ? `\nNote: before building, place the vendored API jar into ${value.projectDir}\\libs\\ per libs/README.txt (no public maven hosts 1.7.10 spigot-api).`
            : ''),
          value.next,
        ),
      }],
    },
    async execute(args, exec) {
      const value = await scaffoldProject({
        platform: args.platform,
        targetDir: args.targetDir,
        name: args.name,
        packageName: args.packageName,
        minecraftVersion: args.minecraftVersion,
        javaVersion: args.javaVersion,
        signal: exec.signal,
      })
      return { ...value, next: scaffoldNextSteps(value) }
    },
    presentCall: scaffoldCallView,
  }))

  ctx.tools.register(defineTool({
    name: 'mc_gradle',
    description: GRADLE_DESCRIPTION,
    parameters: {
      projectDir: { type: 'string', required: true, description: 'Absolute path of the Gradle project root (must contain gradlew or gradlew.bat).' },
      task: { type: 'string', required: true, description: 'Gradle task to run, e.g. build, clean, runClient, runServer, runData. No whitespace or shell metacharacters.' },
      args: { type: 'array', items: { type: 'string' }, description: 'Extra arguments appended to the task, e.g. --no-daemon, -Pfoo=bar. No empty strings, control characters, or cmd.exe metacharacters on Windows.' },
      timeoutMs: { type: 'number', description: 'Timeout in milliseconds; defaults to the plugin config gradleTimeoutMs (600000). Kills the whole process tree on expiry.' },
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
        timeoutMs: args.timeoutMs ?? config.gradleTimeoutMs,
        signal: exec.signal,
        tailChars: config.outputTailChars,
      })
      return { ...result, next: gradleNextSteps({ task: args.task, projectDir: args.projectDir }, result) }
    },
    presentCall: gradleCallView,
    presentResult: gradleResultView,
  }))

  ctx.tools.register(defineTool({
    name: 'mc_port_audit',
    description: PORT_AUDIT_DESCRIPTION,
    parameters: {
      projectDir: {
        type: 'string',
        required: true,
        description: 'Absolute path of the existing project root to inspect (read-only).',
      },
      platform: {
        type: 'string',
        required: true,
        enum: [...SUPPORTED_PLATFORMS],
        description: `Target platform to migrate to. Supported: ${SUPPORTED_PLATFORMS.join(', ')}.`,
      },
      minecraftVersion: {
        type: 'string',
        required: true,
        description: 'Target Minecraft version line, e.g. 1.20.1, 1.21.11, 26.3. Must be one of the '
          + 'platform lines listed by mc_scaffold (unknown lines throw with the supported list).',
      },
    },
    output: {
      // Every object node needs an explicit `additionalProperties` boolean: the
      // harness value-schema compiler rejects one without it, and defineTool
      // runs that compile the moment this entry activates. The nested shapes are
      // produced by auditProject and are opaque here, so they stay open; the root
      // stays closed because auditProject returns exactly these five keys.
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          project: { type: 'object', additionalProperties: true, required: true },
          target: { type: 'object', additionalProperties: true, required: true },
          findings: {
            type: 'array',
            required: true,
            items: { type: 'object', additionalProperties: true },
          },
          summary: { type: 'object', additionalProperties: true, required: true },
          next: {
            type: 'array',
            required: true,
            items: { type: 'string' },
            description: NEXT_OUTPUT_DESCRIPTION,
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: appendNextSteps(renderAuditResult(value), value.next) }],
    },
    async execute(args) {
      const value = await auditProject({
        projectDir: args.projectDir,
        platform: args.platform,
        minecraftVersion: args.minecraftVersion,
      })
      return { ...value, next: auditNextSteps(value) }
    },
  }))
}
