/**
 * lib/descriptions.js — the four model-facing tool descriptions. They are
 * instruction sheets, so the tests enforce the same shape on all of them:
 * `Use when:` / `Do not use for:` / `Constraints:` / `After a failure:`, plus
 * concrete cross-references. A description that does not say when NOT to use
 * the tool, or what to read after a failure, is a contract regression even if
 * the tool still works.
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  CODEX_DESCRIPTION,
  GRADLE_DESCRIPTION,
  PORT_AUDIT_DESCRIPTION,
  SCAFFOLD_DESCRIPTION,
} from '../lib/descriptions.js'
import { SUPPORTED_PLATFORMS } from '../lib/versions.js'

const DESCRIPTIONS = {
  mc_scaffold: SCAFFOLD_DESCRIPTION,
  mc_gradle: GRADLE_DESCRIPTION,
  mc_port_audit: PORT_AUDIT_DESCRIPTION,
  mc_codex: CODEX_DESCRIPTION,
}
const KNOWN_TOOLS = new Set([
  ...Object.keys(DESCRIPTIONS),
  'subagent_mc_plan',
  'subagent_mc_skeleton',
  'subagent_mc_content',
  'subagent_mc_verify',
])
const KNOWN_SKILLS = new Set([
  'minecraft-java-build',
  'minecraft-paper-plugin',
  'minecraft-fabric-mod',
  'minecraft-forge-mod',
  'minecraft-neoforge-mod',
  'minecraft-spigot-legacy',
  'minecraft-major-mods',
  'minecraft-intake',
  'minecraft-porting',
  'minecraft-proxy-plugin',
  'minecraft-datapack',
  'minecraft-codex-architect',
])
const LABELS = ['Use when:', 'Do not use for:', 'Constraints:', 'After a failure:']

/** Tool names referenced in one description (subagent_mc_* kept whole). */
function toolsIn(text) {
  return [...new Set(text.match(/(?<![a-z0-9_])(?:subagent_mc_[a-z]+|mc_[a-z_]+)/g) ?? [])]
}

/** Skill names referenced in one description. */
function skillsIn(text) {
  return [...new Set(text.match(/minecraft-[a-z0-9-]+/g) ?? [])]
}

describe('tool descriptions share one instruction shape', () => {
  for (const [name, description] of Object.entries(DESCRIPTIONS)) {
    test(`${name} has the four contract labels in order`, () => {
      let cursor = -1
      for (const label of LABELS) {
        const index = description.indexOf(label)
        assert.ok(index > cursor, `${name}: "${label}" must appear after the previous section`)
        cursor = index
      }
    })

    test(`${name} is a substantial single paragraph, not a label`, () => {
      assert.ok(description.length >= 400, `${name}: description is too short (${description.length})`)
      assert.ok(description.length <= 4000, `${name}: description is too long (${description.length})`)
      assert.ok(!description.includes('${'), `${name}: no template placeholders left in the text`)
      assert.match(description, /\.$/, `${name}: ends with a sentence`)
    })

    test(`${name} references only real tools and skills`, () => {
      for (const tool of toolsIn(description)) {
        assert.ok(KNOWN_TOOLS.has(tool), `${name}: unknown tool ${tool}`)
      }
      for (const skill of skillsIn(description)) {
        assert.ok(KNOWN_SKILLS.has(skill), `${name}: unknown skill ${skill}`)
      }
      assert.ok(description.includes('mc_'), `${name}: must name at least one next tool`)
    })
  }
})

describe('per-tool contract details', () => {
  test('mc_scaffold names every supported platform', () => {
    for (const platform of SUPPORTED_PLATFORMS) {
      assert.ok(SCAFFOLD_DESCRIPTION.includes(platform), `mc_scaffold: platform ${platform} is not mentioned`)
    }
  })

  test('mc_gradle documents the preflight and the single-run constraint', () => {
    assert.ok(GRADLE_DESCRIPTION.includes('[preflight]'))
    assert.ok(/one run per projectDir/i.test(GRADLE_DESCRIPTION))
    assert.ok(/non-zero exit is a result/i.test(GRADLE_DESCRIPTION))
  })

  test('mc_port_audit says read-only and forbids the build substitution', () => {
    assert.ok(PORT_AUDIT_DESCRIPTION.includes('read-only'))
    assert.ok(/never builds/.test(PORT_AUDIT_DESCRIPTION))
  })

  test('mc_codex names both modes and the handoff markers', () => {
    assert.ok(CODEX_DESCRIPTION.includes('app-server'))
    assert.ok(CODEX_DESCRIPTION.includes('"exec"'))
    assert.ok(CODEX_DESCRIPTION.includes('[TODO: Agent B]'))
  })
})
