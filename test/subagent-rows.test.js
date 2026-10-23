import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'

/**
 * The dsh 0.2.1 subagent contract.
 *
 * `@deepseek-ai/dsh-tool-subagent@0.2.1-rc.2` removed three config keys and made
 * two of them fatal:
 *
 * ```js
 * for (const field of ["persona", "toolFilter"])
 *   if (Object.hasOwn(config, field))
 *     throw new Error(`tool-subagent: ${field} is no longer supported; configure
 *       persona and tool plugins in an Agent Preset and select it with agentPreset`)
 * ```
 *
 * `backgroundMode` and `enableRunInBackground` are merely gone (schemastery keeps
 * unknown keys, the tool ignores them), so they are dead config rather than a
 * crash — but leaving dead keys around is how the next reader gets misled.
 *
 * These tests pin the post-migration shape: the four host rows carry only
 * `provider` / `toolName` / `agentPreset` / `maxDepth`, every `agentPreset` names
 * a registered role preset, and no retired key survives anywhere.
 */

const REPO = fileURLToPath(new URL('../', import.meta.url))
const RETIRED_KEYS = ['persona', 'toolFilter', 'backgroundMode', 'enableRunInBackground']
const HOST_ROWS = ['subagent-mc-plan', 'subagent-mc-skeleton', 'subagent-mc-content', 'subagent-mc-verify']

const patch = (await readFile(`${REPO}cordis.patch.yml`, 'utf8')).replace(/\r\n/g, '\n')
const { rolePresets, ROLE_PRESET_IDS, ROLE_TOOL_NAMES } = await import(pathToFileURL(`${REPO}preset/roles.js`).href)

/**
 * Slice one `- id: <rowId>` entry out of the patch list, returning its config
 * keys mapped to their scalar text. The patch is a flat insert list of small
 * mapping entries, so an indentation scan is enough — the repo keeps no YAML
 * dependency on purpose.
 */
function hostBlock(rowId) {
  const lines = patch.split('\n')
  const start = lines.findIndex(line => line.trim() === `- id: ${rowId}`)
  assert.notEqual(start, -1, `cordis.patch.yml must declare ${rowId}`)
  const rest = lines.slice(start + 1)
  const stop = rest.findIndex(line => /^\s{4}- id: /.test(line))
  return stop === -1 ? rest : rest.slice(0, stop)
}

function hostRow(rowId) {
  const block = hostBlock(rowId)
  const configAt = block.findIndex(line => line.trim() === 'config:')
  assert.notEqual(configAt, -1, `${rowId} must keep a config block`)
  const config = {}
  for (const line of block.slice(configAt + 1)) {
    if (line.trim() === '') continue
    const match = /^\s+([A-Za-z][\w]*): (.+)$/.exec(line)
    if (match) config[match[1]] = match[2].trim()
  }
  return config
}

test('the four host rows wait for the agentPresets service before applying', () => {
  for (const rowId of HOST_ROWS) {
    const block = hostBlock(rowId).join('\n')
    assert.match(block, /^\s{6}inject:\s*\['agentPresets'\]$/m,
      `${rowId} must declare entry-level inject: ['agentPresets']; without it tool-subagent applies before the preset service exists and the row shows 异常 until toggled`)
  }
})

test('the four host rows use only the 0.2.1 tool-subagent config keys', () => {
  for (const rowId of HOST_ROWS) {
    const config = hostRow(rowId)
    assert.deepEqual(
      Object.keys(config).sort(),
      ['agentPreset', 'maxDepth', 'provider', 'toolName'],
      `${rowId} must carry exactly provider/toolName/agentPreset/maxDepth; got ${Object.keys(config).join(', ')}`,
    )
    assert.equal(config.provider, 'spawn', `${rowId} must stay on the in-process spawn provider`)
    assert.equal(config.maxDepth, '1', `${rowId} keeps the depth budget explicit`)
  }
})

test('each host row points at a registered role preset and a distinct tool name', () => {
  const seen = new Set()
  HOST_ROWS.forEach((rowId, index) => {
    const config = hostRow(rowId)
    assert.equal(config.agentPreset, ROLE_PRESET_IDS[index], `${rowId} must select ${ROLE_PRESET_IDS[index]}`)
    assert.equal(config.toolName, ROLE_TOOL_NAMES[index], `${rowId} must register ${ROLE_TOOL_NAMES[index]}`)
    assert.equal(seen.has(config.toolName), false, `${config.toolName} must stay unique across the four rows`)
    seen.add(config.toolName)
  })
  assert.equal(ROLE_PRESET_IDS.length, 4, 'the team is four roles')
})

test('no retired tool-subagent key survives in the host patch or the presets', async () => {
  const files = [
    ['cordis.patch.yml', patch],
    ['preset/minecraft/rows.js', await readFile(`${REPO}preset/minecraft/rows.js`, 'utf8')],
    ['preset/minecraft-architect/rows.js', await readFile(`${REPO}preset/minecraft-architect/rows.js`, 'utf8')],
    ['preset/minecraft/agent.cordis.yml', await readFile(`${REPO}preset/minecraft/agent.cordis.yml`, 'utf8')],
    ['preset/minecraft-architect/agent.cordis.yml', await readFile(`${REPO}preset/minecraft-architect/agent.cordis.yml`, 'utf8')],
  ]
  for (const [file, text] of files) {
    for (const key of RETIRED_KEYS) {
      // The host patch documents the removal in a comment; only real keys count.
      const asKey = new RegExp(`^\\s*(?:- )?${key}:`, 'm')
      assert.equal(asKey.test(text), false, `${file} must not configure the retired key ${key}`)
    }
  }
})

test('every role preset composes a persona and a filesystem tool set', () => {
  assert.equal(rolePresets.length, 4)
  for (const preset of rolePresets) {
    assert.match(preset.id, /^mc-/, `${preset.id} must stay in the mc- namespace`)
    const persona = preset.plugins.find(row => row.id === 'persona')
    assert.ok(persona, `${preset.id} needs a persona row`)
    assert.equal(persona.name, '@deepseek-ai/dsh-persona', `${preset.id} persona must use the shipped plugin`)
    assert.ok(persona.config.prefix.length > 500, `${preset.id} persona must carry the real role text`)
    for (const rowId of ['tool-fs', 'tool-fs-search']) {
      assert.ok(preset.plugins.some(row => row.id === rowId), `${preset.id} needs ${rowId}`)
    }
    assert.equal(
      preset.plugins.some(row => row.id === 'tool-web'),
      preset.id === 'mc-plan',
      'only the research role may reach the network',
    )
  }
})

test('role personas describe the 0.2.1 asynchronous delegation contract', () => {
  for (const preset of rolePresets) {
    const prefix = preset.plugins.find(row => row.id === 'persona').config.prefix
    assert.ok(prefix.includes('立即返回一个 id'), `${preset.id} must tell the role the call returns an id`)
    assert.ok(prefix.includes('最后一条消息'), `${preset.id} must tell the role where the result goes`)
  }
})

test('the role presets are registered with the two user-facing ones', async () => {
  // preset.js imports @deepseek-ai/*, so it cannot be imported by the dependency-free
  // test run; assert the wiring textually instead (the parity tests cover the rest).
  const registry = await readFile(`${REPO}preset.js`, 'utf8')
  assert.match(registry, /import \{ rolePresets \} from '\.\/preset\/roles\.js'/)
  assert.match(registry, /PRESET_DEFINITIONS = \[minecraftPreset, minecraftArchitectPreset, \.\.\.rolePresets\]/)
})
