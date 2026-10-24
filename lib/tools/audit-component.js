/**
 * Single-tool component: `mc_port_audit` alone.
 *
 * Opt-in. Mount this row instead of `minecraft-dev/tools` (disable that row
 * first) when only the read-only migration audit is wanted. Exported as
 * `minecraft-dev/tools-audit` and declared disabled in cordis.patch.yml.
 * @module minecraft-dev/lib/tools/audit-component
 */

import { createAuditTool } from './audit.js'

/** Cordis plugin name. */
export const name = 'minecraft-tool-audit'
/** Service required by the tool consumer. */
export const inject = ['tools']

/** Register mc_port_audit on `ctx.tools`. */
export function apply(ctx) {
  ctx.tools.register(createAuditTool())
}
