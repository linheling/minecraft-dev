/**
 * Single-tool component: `mc_scaffold` alone.
 *
 * Opt-in. Mount this row instead of `minecraft-dev/tools` (disable that row
 * first) when only project scaffolding is wanted. Exported as
 * `minecraft-dev/tools-scaffold` and declared disabled in cordis.patch.yml.
 * @module minecraft-dev/lib/tools/scaffold-component
 */

import { createScaffoldTool } from './scaffold.js'

/** Cordis plugin name. */
export const name = 'minecraft-tool-scaffold'
/** Service required by the tool consumer. */
export const inject = ['tools']

/** Register mc_scaffold on `ctx.tools`. */
export function apply(ctx) {
  ctx.tools.register(createScaffoldTool())
}
