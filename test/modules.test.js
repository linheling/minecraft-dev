import { test } from 'node:test'
import assert from 'node:assert/strict'

/**
 * Structural and functional smoke tests for the plugin entry points.
 *
 * The real imports require @deepseek-ai/cordis, dsh-tools and dsh-skill, which
 * only exist when the package is installed into a dsh profile (or node_modules
 * is linked to a harness checkout). The default local run skips them instead of
 * failing — the dsh profile installation covers the real load path.
 *
 * Set REQUIRE_PLUGIN_DEPS=1 to turn that skip into a hard failure. CI's
 * `plugin-load` job installs the published peer packages and runs this file in
 * that mode, so a renamed entry-point export or a missing `inject` key cannot
 * hide behind the local skip forever.
 */
const requirePluginDeps = process.env.REQUIRE_PLUGIN_DEPS === '1'

/**
 * Import a plugin entry point, translating a missing peer dependency into a
 * skip (default) or a hard failure (REQUIRE_PLUGIN_DEPS=1).
 * @param {string} spec - module specifier relative to this test file.
 * @returns {Promise<object|null>} the module namespace, or null when skipped.
 */
async function importEntry(spec) {
  try {
    return await import(spec)
  } catch (error) {
    if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error
    if (requirePluginDeps) {
      throw new Error(
        `cannot import ${spec}: a peer dependency is missing and REQUIRE_PLUGIN_DEPS=1 forbids skipping. ` +
          `Install @deepseek-ai/cordis, @deepseek-ai/dsh-tools, @deepseek-ai/dsh-skill and ` +
          `@deepseek-ai/schemastery before re-running. Original error: ${error.message}`,
      )
    }
    return null // peer deps absent outside a dsh profile: skip in the default run
  }
}

for (const spec of ['../skills.js', '../tools.js']) {
  test(`module ${spec} exports name/inject/apply`, async (t) => {
    const mod = await importEntry(spec)
    if (!mod) return t.skip('peer dependencies not installed')
    assert.equal(typeof mod.name, 'string')
    assert.ok(Array.isArray(mod.inject))
    assert.equal(typeof mod.apply, 'function')
    assert.equal(mod.inject.length, 1)
  })
}

test('module ../preset.js exports name/inject/apply with the preset service injected', async (t) => {
  const mod = await importEntry('../preset.js')
  if (!mod) return t.skip('peer dependencies not installed')
  assert.equal(typeof mod.name, 'string')
  assert.ok(Array.isArray(mod.inject))
  // The preset registry is injected so `apply` sees it on dsh 0.1.7, whose
  // registry row initializes after third-party rows (both dsh lines publish it).
  assert.deepEqual(mod.inject, ['agentPresets'])
  assert.equal(typeof mod.apply, 'function')
})

test('skills provider reads every bundled SKILL.md body', async (t) => {
  const mod = await importEntry('../skills.js')
  if (!mod) return t.skip('peer dependencies not installed')
  // Capture the provider through a minimal fake ctx, exactly as the Loader would.
  let provider
  mod.apply({ skills: { registerProvider: create => { provider = create() } } })
  const candidates = await provider.list()
  assert.ok(candidates.length >= 9, `expected 9+ skills, got ${candidates.length}`)
  for (const candidate of candidates) {
    const definition = await provider.get(candidate)
    assert.equal(definition.name, candidate.name)
    assert.ok(definition.content.length > 200, `${candidate.name} body unreadable or too short`)
    assert.match(definition.content, /^# /, `${candidate.name} body should start with a heading`)
  }
})
