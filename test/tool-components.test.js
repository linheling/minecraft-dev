import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/**
 * Single-tool components (v0.17.0): mc_scaffold / mc_gradle / mc_port_audit can
 * be mounted one at a time through `minecraft-dev/tools-*` instead of the
 * combined `minecraft-dev/tools` row. Both paths must register the very same
 * definition, and the two must never be mounted together (duplicate tool
 * registration). The real peers only exist inside a dsh profile, so the default
 * local run skips; CI's plugin-load job installs them and sets
 * REQUIRE_PLUGIN_DEPS=1, which turns the skip into a failure.
 */
const root = fileURLToPath(new URL('..', import.meta.url))
const requirePluginDeps = process.env.REQUIRE_PLUGIN_DEPS === '1'

const COMPONENTS = [
  { subpath: './tools-scaffold', file: 'lib/tools/scaffold-component.js', tool: 'mc_scaffold' },
  { subpath: './tools-gradle', file: 'lib/tools/gradle-component.js', tool: 'mc_gradle' },
  { subpath: './tools-audit', file: 'lib/tools/audit-component.js', tool: 'mc_port_audit' },
]

/**
 * Import one component module, skipping locally and failing in CI when a peer
 * package is missing.
 * @param {string} file - repo-relative module path.
 * @param {import('node:test').TestContext} t
 * @returns {Promise<object | null>} the module namespace, or null when skipped.
 */
async function importComponent(file, t) {
  try {
    return await import(pathToFileURL(path.join(root, file)).href)
  } catch (error) {
    if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error
    if (requirePluginDeps) {
      throw new Error(
        `cannot import ${file}: a peer dependency is missing and REQUIRE_PLUGIN_DEPS=1 forbids skipping. ` +
          `Original error: ${error.message}`,
      )
    }
    t.skip('peer dependencies not installed')
    return null
  }
}

test('each package.json tools-* export points at an existing component file', async () => {
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
  assert.equal(pkg.exports['./tools'], './tools.js', 'the combined component stays the default mount')
  for (const { subpath, file } of COMPONENTS) {
    assert.equal(pkg.exports[subpath], `./${file}`, `package.json exports is missing ${subpath}`)
    await assert.doesNotReject(readFile(path.join(root, file), 'utf8'), `${file} should exist`)
  }
})

test('cordis.patch.yml declares every single-tool row as disabled', async () => {
  const patch = await readFile(path.join(root, 'cordis.patch.yml'), 'utf8')
  for (const { subpath } of COMPONENTS) {
    const name = `minecraft-dev/${subpath.replace('./', '')}`
    assert.ok(patch.includes(`name: ${name}`), `cordis.patch.yml should declare ${name}`)
    // Slice to the next row so `disabled: true` is read from this row only.
    const fromRow = patch.slice(patch.indexOf(`name: ${name}`))
    const nextRow = fromRow.indexOf('\n    - id:')
    const row = nextRow >= 0 ? fromRow.slice(0, nextRow) : fromRow
    assert.match(row, /\n\s+disabled: true/, `${name} must stay opt-in (disabled: true)`)
  }
})

test('each single-tool component registers exactly its own tool', async (t) => {
  const registered = new Set()
  for (const { file, tool } of COMPONENTS) {
    const mod = await importComponent(file, t)
    if (!mod) return
    assert.equal(typeof mod.apply, 'function', `${file} should export apply()`)
    assert.deepEqual(mod.inject, ['tools'], `${file} should inject tools`)
    assert.match(mod.name, /^minecraft-tool-/, `${file} should export a plugin name`)

    const definitions = []
    mod.apply({ tools: { register: (definition) => definitions.push(definition) } }, {})
    assert.deepEqual(definitions.map((definition) => definition.name), [tool], `${file} registered the wrong tools`)
    assert.equal(definitions[0].output.schema.additionalProperties, false, `${tool}: closed output schema`)
    registered.add(tool)
  }
  // Three components, three distinct tools: no name may repeat across rows.
  assert.equal(registered.size, COMPONENTS.length, 'single-tool components must not overlap')
})

test('a standalone component compiles the same output schema as the combined mount', async (t) => {
  const combined = await importComponent('tools.js', t)
  if (!combined) return
  const all = []
  combined.apply({ tools: { register: (definition) => all.push(definition) } }, {
    gradleTimeoutMs: 600_000,
    outputTailChars: 12_000,
  })
  for (const { file, tool } of COMPONENTS) {
    const mod = await importComponent(file, t)
    if (!mod) return
    const alone = []
    mod.apply({ tools: { register: (definition) => alone.push(definition) } }, {
      gradleTimeoutMs: 600_000,
      outputTailChars: 12_000,
    })
    const shared = all.find((definition) => definition.name === tool)
    assert.ok(shared, `combined mount should register ${tool}`)
    assert.deepEqual(alone[0].parameters, shared.parameters, `${tool}: parameter schema drifted between mounts`)
  }
})

test('the mc_smoke component is exported, opt-in, and registers a closed schema', async (t) => {
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
  assert.equal(pkg.exports['./tools-smoke'], './lib/tools/smoke-component.js')
  const patch = await readFile(path.join(root, 'cordis.patch.yml'), 'utf8')
  const fromRow = patch.slice(patch.indexOf('name: minecraft-dev/tools-smoke'))
  const nextRow = fromRow.indexOf('\n    - id:')
  const row = nextRow >= 0 ? fromRow.slice(0, nextRow) : fromRow
  assert.match(row, /\n\s+disabled: true/, 'mc_smoke must stay opt-in (disabled: true)')

  const mod = await importComponent('lib/tools/smoke-component.js', t)
  if (!mod) return
  const definitions = []
  mod.apply({ tools: { register: (definition) => definitions.push(definition) } }, {})
  assert.deepEqual(definitions.map((definition) => definition.name), ['mc_smoke'])
  assert.equal(definitions[0].output.schema.additionalProperties, false)
  assert.deepEqual(definitions[0].output.schema.properties.next.type, 'array')
})
