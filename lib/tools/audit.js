/**
 * `mc_port_audit` definition, extracted from tools.js so it can be mounted
 * either as part of the combined `minecraft-tools` component or alone through
 * `minecraft-dev/tools-audit`. Read-only: it never writes to the project.
 * @module minecraft-dev/lib/tools/audit
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { PORT_AUDIT_DESCRIPTION } from '../descriptions.js'
import { NEXT_OUTPUT_DESCRIPTION, appendNextSteps, auditNextSteps } from '../next-steps.js'
import { auditProject } from '../port-audit.js'
import { SUPPORTED_PLATFORMS } from '../versions.js'

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

/** @returns {object} the compiled mc_port_audit tool definition. */
export function createAuditTool() {
  return defineTool({
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
  })
}
