/**
 * Single-tool component: `mc_smoke` alone, disabled by default.
 *
 * Starting a real JVM is opt-in: mount this row by deleting `disabled: true`
 * from `minecraft-tool-smoke` in cordis.patch.yml. Exported as
 * `minecraft-dev/tools-smoke`.
 * @module minecraft-dev/lib/tools/smoke-component
 */

import Schema from '@deepseek-ai/schemastery'
import { createSmokeTool } from './smoke.js'

/** Cordis plugin name. */
export const name = 'minecraft-tool-smoke'
/** Service required by the tool consumer. */
export const inject = ['tools']

/** Tunables; the tool argument `timeoutMs` wins when given. */
export const Config = Schema.object({
  /** Overall server-run budget in milliseconds. */
  timeoutMs: Schema.number().default(600_000),
  /** Characters mc_smoke keeps from merged output (head + tail). */
  outputTailChars: Schema.number().default(12_000),
})

/** Register mc_smoke on `ctx.tools`. */
export function apply(ctx, config = {}) {
  ctx.tools.register(createSmokeTool(config))
}
