/**
 * Minecraft development tools for DeepSeek Harness — the combined component.
 *
 * Registers `mc_scaffold`, `mc_gradle` and `mc_port_audit` on one row
 * (`id: minecraft-tools` in cordis.patch.yml). Each tool also has a
 * single-tool component (`minecraft-dev/tools-scaffold`,
 * `minecraft-dev/tools-gradle`, `minecraft-dev/tools-audit`) for users who want
 * to enable one product without the other two; the definitions live in
 * lib/tools/ and are shared, so the two mounts cannot drift apart.
 *
 * `mc_codex` is separate on purpose: it is mounted only by the architect preset
 * (see codex.js). `mc_smoke` is the opt-in server smoke runner (tools-smoke).
 *
 * Deployment tunables (gradle timeout, output tail) are Config fields — see
 * cordis.patch.yml.
 * @module minecraft-dev/tools
 */

import Schema from '@deepseek-ai/schemastery'
import { createAuditTool } from './lib/tools/audit.js'
import { createGradleTool } from './lib/tools/gradle.js'
import { createScaffoldTool } from './lib/tools/scaffold.js'

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

/** Register the minecraft-dev tools on `ctx.tools`. */
export function apply(ctx, config = {}) {
  ctx.tools.register(createScaffoldTool())
  ctx.tools.register(createGradleTool(config))
  ctx.tools.register(createAuditTool())
}
