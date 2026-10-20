import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Single-source drift guard for the plugin's hand-maintained catalogues.
 *
 * Adding a skill or a tool touches four places that no runtime keeps in sync:
 * the `SKILLS` array in skills.js, the `assets/skills/<name>/SKILL.md` tree,
 * the README tables (plus their item counts), and the persona bullets of both
 * agent presets. These tests assert all four agree, so a half-finished addition
 * fails here with the missing location named instead of shipping a plugin whose
 * README advertises something the router cannot load.
 */
const root = fileURLToPath(new URL('..', import.meta.url))
const read = relative => readFile(path.join(root, relative), 'utf8')

/**
 * Parse the skill rows declared in skills.js. The file's imports require the
 * dsh peer packages, so the array is read from source rather than imported
 * (importing it is test/modules.test.js's job, which needs a profile install).
 * @returns {Promise<string[]>} declared skill names in declaration order.
 */
async function declaredSkills() {
  const source = await read('skills.js')
  const start = source.indexOf('const SKILLS = [')
  assert.ok(start >= 0, 'skills.js should declare a SKILLS array')
  const end = source.indexOf('\n]', start)
  assert.ok(end > start, 'skills.js SKILLS array should be closed by a `]` at column 0')
  const block = source.slice(start, end)
  const names = [...block.matchAll(/name:\s*'([a-z0-9-]+)'/g)].map(match => match[1])
  assert.ok(names.length > 0, 'skills.js SKILLS array should declare at least one named skill')
  return names
}

/**
 * List the bundled skill directories that contain a SKILL.md.
 * @returns {Promise<string[]>} directory names, sorted.
 */
async function bundledSkills() {
  const entries = await readdir(path.join(root, 'assets', 'skills'), { withFileTypes: true })
  const names = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const body = await readFile(path.join(root, 'assets', 'skills', entry.name, 'SKILL.md'), 'utf8').catch(() => null)
    if (body === null) continue
    names.push(entry.name)
  }
  return names.sort()
}

/**
 * Extract the tool names registered by tools.js and codex.js (the architect
 * preset's mc_codex row lives in its own module).
 * @returns {Promise<string[]>} unique tool names, sorted.
 */
async function declaredTools() {
  const names = new Set()
  for (const file of ['tools.js', 'codex.js']) {
    const source = await read(file)
    for (const match of source.matchAll(/name:\s*'(mc_[a-z_]+)'/g)) names.add(match[1])
  }
  return [...names].sort()
}

test('every skill declared in skills.js has a bundled SKILL.md and vice versa', async () => {
  const declared = await declaredSkills()
  const bundled = await bundledSkills()
  assert.deepEqual([...declared].sort(), bundled, 'skills.js SKILLS and assets/skills/SKILL.md directories drifted')
  assert.ok(declared.length >= 9, `expected 9+ declared skills, got ${declared.length}`)
  for (const name of declared) {
    const body = await read(path.join('assets', 'skills', name, 'SKILL.md'))
    assert.match(body, /^# /, `assets/skills/${name}/SKILL.md should start with a heading`)
    assert.ok(body.length > 200, `assets/skills/${name}/SKILL.md looks truncated`)
  }
})

test('README documents every skill and states the matching count', async () => {
  const declared = await declaredSkills()
  const readme = await read('README.md')
  for (const name of declared) {
    assert.match(readme, new RegExp(`^\\| \`${name}\` \\|`, 'm'), `README skill table is missing a row for ${name}`)
  }
  assert.match(readme, new RegExp(`### ${declared.length} 个技能`), `README should announce ${declared.length} skills`)
  assert.match(
    readme,
    new RegExp(`\\*\\*${declared.length} model-loaded skills`),
    `README TL;DR should announce ${declared.length} model-loaded skills`,
  )
})

test('README documents every tool and states the matching count', async () => {
  const tools = await declaredTools()
  const readme = await read('README.md')
  for (const name of tools) {
    assert.match(readme, new RegExp(`^\\| \`${name}\` \\|`, 'm'), `README tool table is missing a row for ${name}`)
  }
  assert.match(readme, new RegExp(`### ${tools.length} 个工具`), `README should announce ${tools.length} tools`)
  assert.match(readme, new RegExp(`\\+ ${tools.length} tools\\*\\*`), `README TL;DR should announce ${tools.length} tools`)
})

test('both agent presets (both preset forms) mention every bundled skill', async () => {
  const declared = await declaredSkills()
  const personaFiles = [
    'preset/minecraft/rows.js',
    'preset/minecraft/agent.cordis.yml',
    'preset/minecraft-architect/agent.cordis.yml',
  ]
  for (const file of personaFiles) {
    const text = await read(file)
    for (const name of declared) {
      assert.ok(text.includes(name), `${file} persona does not mention ${name}`)
    }
  }
})
