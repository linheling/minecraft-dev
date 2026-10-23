import { test } from 'node:test'
import assert from 'node:assert/strict'

/**
 * tools.js registers mc_scaffold / mc_gradle / mc_port_audit through
 * `defineTool`, and `defineTool` compiles each `output.schema` with the harness
 * value-schema compiler immediately. That compile runs while the entry
 * activates, so a schema the compiler rejects takes the whole minecraft-tools
 * entry down: the harness logs "1 entry did not activate" and none of the three
 * tools appear, even though the other bundle rows load fine.
 *
 * The rule this test protects is the one that broke v0.16.0: every
 * `type: 'object'` node must declare `additionalProperties` explicitly as a
 * boolean, otherwise the compiler throws
 * `schema.additionalProperties must be explicitly true or false`.
 *
 * The real peers (dsh-tools, schemastery) only exist inside a dsh profile, so
 * the default local run skips. CI's plugin-load job installs the published peer
 * packages and runs this file with REQUIRE_PLUGIN_DEPS=1, which turns the skip
 * into a failure — keep the two paths in sync with test/modules.test.js.
 */
const requirePluginDeps = process.env.REQUIRE_PLUGIN_DEPS === '1'

/** Import tools.js, skipping locally and failing in CI when a peer is missing. */
async function importTools(t) {
  try {
    return await import('../tools.js')
  } catch (error) {
    if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error
    if (requirePluginDeps) {
      throw new Error(
        `cannot import ../tools.js: a peer dependency is missing and REQUIRE_PLUGIN_DEPS=1 forbids skipping. ` +
          `Original error: ${error.message}`,
      )
    }
    t.skip('peer dependencies not installed')
    return null
  }
}

/** Run apply() against a stub tool consumer and return the registered definitions. */
async function registerAll(t) {
  const mod = await importTools(t)
  if (!mod) return null
  const definitions = []
  // apply() is where every defineTool call (and therefore every schema compile)
  // happens; it must not throw for any of the three definitions.
  mod.apply({ tools: { register: (definition) => definitions.push(definition) } }, {
    gradleTimeoutMs: 600_000,
    outputTailChars: 12_000,
  })
  return definitions
}

test('tools.js output schemas survive the harness value-schema compile', async (t) => {
  const definitions = await registerAll(t)
  if (!definitions) return
  assert.deepEqual(
    definitions.map((definition) => definition.name),
    ['mc_scaffold', 'mc_gradle', 'mc_port_audit'],
  )
  for (const definition of definitions) {
    assert.equal(
      definition.output.schema.additionalProperties,
      false,
      `${definition.name}: the output root must declare additionalProperties`,
    )
    assert.equal(definition.parameters.type, 'object', `${definition.name}: parameters compile to an object root`)
  }
})

test('mc_port_audit output schema opens the opaque nested audit shapes', async (t) => {
  const definitions = await registerAll(t)
  if (!definitions) return
  const audit = definitions.find((definition) => definition.name === 'mc_port_audit')
  assert.ok(audit, 'mc_port_audit must be registered')

  // project / target / summary come straight out of auditProject and stay open:
  // closing them would reject real audit output during result validation.
  const properties = audit.output.schema.properties
  assert.equal(properties.project.additionalProperties, true)
  assert.equal(properties.target.additionalProperties, true)
  assert.equal(properties.summary.additionalProperties, true)
  assert.equal(properties.findings.items.additionalProperties, true)
})
