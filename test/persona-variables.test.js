import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

/**
 * Prompt-template variables are a hard contract with the running harness.
 *
 * `@deepseek-ai/dsh-system-prompt` expands `{{name}}` in every prompt section and
 * THROWS when the name is not registered:
 *
 *     unknown prompt variable "{{cwd}}" in section "deployment:persona-prefix";
 *     registered variables: provider, model
 *
 * dsh 0.2.1 registers exactly `provider` and `model` (see `dsh-agent`: it merges
 * `{ provider, model }` from the selected route into the assembled prompt). There
 * is no cwd/workspace variable, so a persona that mentions one fails EVERY turn
 * for that preset before the model request is even sent — reported as issue #3
 * against v0.10.0, whose personas said "working in {{cwd}}".
 *
 * This test pins the allowed set. Add a variable here only after confirming the
 * running harness registers it (grep `dsh-system-prompt` + its callers), because
 * an unregistered one is not a warning: it is a hard prompt-assembly error.
 */

const REPO = fileURLToPath(new URL('../', import.meta.url))
const REGISTERED_VARIABLES = new Set(['provider', 'model'])

/** Every file that can carry a persona/prompt template into a preset. */
const TEMPLATE_FILES = [
  'preset/minecraft/agent.cordis.yml',
  'preset/minecraft/rows.js',
  'preset/minecraft-architect/agent.cordis.yml',
  'preset/minecraft-architect/rows.js',
  'preset/roles.js',
]

test('persona templates only reference prompt variables dsh actually registers', async () => {
  for (const file of TEMPLATE_FILES) {
    const text = await readFile(`${REPO}${file}`, 'utf8')
    const used = new Set([...text.matchAll(/\{\{([A-Za-z0-9_]+)\}\}/g)].map(match => match[1]))
    for (const name of used) {
      assert.ok(
        REGISTERED_VARIABLES.has(name),
        `${file} uses {{${name}}}; dsh 0.2.1 only registers ${[...REGISTERED_VARIABLES].join(', ')} ` +
        'and prompt assembly throws on anything else (issue #3)',
      )
    }
  }
})

test('no persona template mentions the retired cwd variable', async () => {
  for (const file of TEMPLATE_FILES) {
    const text = await readFile(`${REPO}${file}`, 'utf8')
    assert.equal(
      text.includes('{{cwd}}'),
      false,
      `${file} must not reference {{cwd}}: dsh 0.2.1 does not register it (issue #3)`,
    )
  }
})
