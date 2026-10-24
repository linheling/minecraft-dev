/**
 * Single-tool component: `mc_gradle` alone.
 *
 * Opt-in. Mount this row instead of `minecraft-dev/tools` (disable that row
 * first) when only the Gradle runner is wanted. Exported as
 * `minecraft-dev/tools-gradle` and declared disabled in cordis.patch.yml.
 * @module minecraft-dev/lib/tools/gradle-component
 */

import Schema from '@deepseek-ai/schemastery'
import { createGradleTool } from './gradle.js'

/** Cordis plugin name. */
export const name = 'minecraft-tool-gradle'
/** Service required by the tool consumer. */
export const inject = ['tools']

/** Same tunables as the combined component, so a standalone mount behaves alike. */
export const Config = Schema.object({
  /** Default mc_gradle timeout in milliseconds (old lines download slowly on first build). */
  gradleTimeoutMs: Schema.number().default(600_000),
  /** Characters mc_gradle keeps from merged output (head + tail around the truncation marker). */
  outputTailChars: Schema.number().default(12_000),
})

/** Register mc_gradle on `ctx.tools`. */
export function apply(ctx, config = {}) {
  ctx.tools.register(createGradleTool(config))
}
