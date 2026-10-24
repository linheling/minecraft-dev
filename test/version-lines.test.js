/**
 * versions.js — the single source of truth for the (platform, line) matrix.
 * This file locks the invariants other modules rely on:
 *
 * - every entry is resolvable through `resolveLine` in both directions (full
 *   default version and bare line), so audit/scaffold/architect consumers can
 *   never disagree about which template a version means;
 * - every entry's `metadataFile` (derived from its template dir) names a file
 *   that actually exists in assets/templates — the second table is checked
 *   against the source of truth instead of being trusted (this is what caught
 *   NeoForge 1.20.1 shipping legacyforge `mods.toml`, not `neoforge.mods.toml`);
 * - port-audit's mods.toml decision and "create this file" hint come from that
 *   same row, not from a version comparison or a hardcoded line list.
 */
import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, describe, test } from 'node:test'
import {
  PLATFORM_LINES,
  PLATFORM_LABELS,
  SUPPORTED_PLATFORMS,
  defaultJavaVersion,
  lineCoords,
  metadataFileFor,
  normalizeMcLine,
  paperApiVersion,
  resolveLine,
} from '../lib/versions.js'
import { auditProject } from '../lib/port-audit.js'

const TEMPLATES_ROOT = fileURLToPath(new URL('../assets/templates/', import.meta.url))
const JAVA_LEVELS = new Set([8, 17, 21, 25])
const RECOGNIZED_METADATA = new Set(['mods.toml', 'neoforge.mods.toml', 'mcmod.info', 'plugin.yml', 'fabric.mod.json'])

/** Every (platform, entry) pair in the matrix. */
function allEntries() {
  return SUPPORTED_PLATFORMS.flatMap((platform) => PLATFORM_LINES[platform].map((entry) => ({ platform, entry })))
}

/** Basenames of every file under a template directory. */
async function templateFiles(templateDir) {
  const entries = await readdir(path.join(TEMPLATES_ROOT, templateDir), { recursive: true, withFileTypes: true })
  return entries.filter((dirent) => dirent.isFile()).map((dirent) => dirent.name)
}

describe('PLATFORM_LINES invariants', () => {
  test('every platform has entries, a label and only supported Java levels', () => {
    assert.deepEqual(Object.keys(PLATFORM_LINES).sort(), [...SUPPORTED_PLATFORMS].sort())
    for (const platform of SUPPORTED_PLATFORMS) {
      assert.ok(PLATFORM_LINES[platform].length > 0, `${platform} has entries`)
      assert.equal(typeof PLATFORM_LABELS[platform], 'string', `${platform} has a label`)
      for (const entry of PLATFORM_LINES[platform]) {
        assert.match(entry.line, /^\d+(?:\.\d+){0,2}$/, `${platform}: line "${entry.line}" is dotted`)
        assert.ok(JAVA_LEVELS.has(entry.javaVersion), `${platform} ${entry.line}: Java ${entry.javaVersion} is a shipped level`)
        assert.match(entry.defaultMcVersion, /^\d+\.\d+(?:\.\d+)?$/)
        assert.equal(typeof entry.templateDir, 'string')
      }
    }
  })

  test('no duplicate lines or duplicate default versions within a platform', () => {
    for (const platform of SUPPORTED_PLATFORMS) {
      const lines = PLATFORM_LINES[platform].map((entry) => entry.line)
      assert.equal(new Set(lines).size, lines.length, `${platform} has unique lines`)
      const versions = PLATFORM_LINES[platform].map((entry) => entry.defaultMcVersion)
      assert.equal(new Set(versions).size, versions.length, `${platform} has unique pinned versions`)
    }
  })

  test('every templateDir exists under assets/templates', async () => {
    for (const { platform, entry } of allEntries()) {
      const files = await templateFiles(entry.templateDir)
      assert.ok(files.length > 0, `${platform} ${entry.line}: template ${entry.templateDir} is not empty`)
    }
  })
})

describe('resolveLine round-trips', () => {
  test('the pinned default version and the bare line both resolve to the same entry', () => {
    for (const { platform, entry } of allEntries()) {
      const byVersion = resolveLine(platform, entry.defaultMcVersion)
      const byLine = resolveLine(platform, entry.line)
      assert.equal(byVersion.line, entry.line, `${platform}: ${entry.defaultMcVersion} -> line ${entry.line}`)
      assert.equal(byLine.line, entry.line, `${platform}: line ${entry.line} resolves to itself`)
      assert.equal(byVersion.templateDir, entry.templateDir)
    }
  })

  test('a normalized line resolves to the same era (same Java level)', () => {
    for (const { platform, entry } of allEntries()) {
      const normalized = normalizeMcLine(entry.defaultMcVersion)
      const resolved = resolveLine(platform, normalized)
      // The patch part is dropped by normalizeMcLine, so 1.21.1 legitimately
      // resolves to the 1.21 entry — same era, same Java level. Identity is
      // covered by the round-trip test above; here the guarantee is that a
      // model passing a bare line still lands in the right era.
      assert.equal(
        resolved.javaVersion,
        entry.javaVersion,
        `${platform}: ${entry.defaultMcVersion} normalizes to ${normalized} and stays in Java ${entry.javaVersion}`,
      )
    }
  })

  test('defaultJavaVersion and lineCoords agree with the entry', () => {
    for (const { platform, entry } of allEntries()) {
      assert.equal(defaultJavaVersion(platform, entry.defaultMcVersion), entry.javaVersion)
      assert.deepEqual(lineCoords(platform, entry.defaultMcVersion), entry.coords ?? {})
    }
  })

  test('paper-api versions follow the two eras', () => {
    assert.equal(paperApiVersion('1.21.8'), '1.21.8-R0.1-SNAPSHOT')
    assert.equal(paperApiVersion('26.2'), '26.2.build.+')
    assert.equal(paperApiVersion('26.3.x'), '26.3.build.+')
  })
})

describe('metadataFileFor matches the shipped templates', () => {
  test('every row names a recognized metadata file that exists in its template', async () => {
    for (const { platform, entry } of allEntries()) {
      const expected = metadataFileFor(platform, entry.defaultMcVersion)
      assert.ok(RECOGNIZED_METADATA.has(expected), `${platform} ${entry.line}: unknown metadata ${expected}`)
      const files = await templateFiles(entry.templateDir)
      assert.ok(files.includes(expected), `${platform} ${entry.line}: template ships ${expected}`)
      const metadataFiles = files.filter((name) => RECOGNIZED_METADATA.has(name))
      assert.deepEqual(metadataFiles, [expected], `${platform} ${entry.line}: exactly one metadata file`)
    }
  })

  test('NeoForge 1.20.1 is the legacyforge exception (mods.toml)', () => {
    assert.equal(metadataFileFor('neoforge', '1.20.1'), 'mods.toml')
    assert.equal(metadataFileFor('neoforge', '1.21.11'), 'neoforge.mods.toml')
    assert.equal(metadataFileFor('forge', '1.12.2'), 'mcmod.info')
    assert.equal(metadataFileFor('forge', '1.20.1'), 'mods.toml')
    assert.equal(metadataFileFor('paper', '1.21.8'), 'plugin.yml')
  })
})

describe('port-audit derives the metadata rule from versions.js', () => {
  let projects = []

  after(async () => {
    await Promise.all(projects.map((dir) => rm(dir, { recursive: true, force: true })))
  })

  async function emptyProject() {
    const dir = await mkdtemp(path.join(tmpdir(), 'mcdev-lines-'))
    projects.push(dir)
    return dir
  }

  async function metadataFinding(platform, minecraftVersion) {
    const dir = await emptyProject()
    const report = await auditProject({ projectDir: dir, platform, minecraftVersion })
    return report.findings.find((finding) => finding.code === 'METADATA_MISSING')
  }

  test('legacyforge 1.20.1 asks for mods.toml', async () => {
    const finding = await metadataFinding('neoforge', '1.20.1')
    assert.ok(finding, 'a project without metadata must warn')
    assert.match(finding.hint, /Create mods\.toml/)
    assert.ok(!finding.hint.includes('Create neoforge.mods.toml'), '1.20.1 must not ask for the renamed file')
  })

  test('modern NeoForge asks for neoforge.mods.toml', async () => {
    const finding = await metadataFinding('neoforge', '1.21.11')
    assert.match(finding.hint, /Create neoforge\.mods\.toml/)
  })

  test('Forge 1.16+ is audited as mods.toml, 1.12.2 is not', async () => {
    const modern = await metadataFinding('forge', '1.20.1')
    assert.match(modern.hint, /Create mods\.toml/)
    const legacy = await metadataFinding('forge', '1.12.2')
    assert.equal(legacy, undefined, 'mcmod.info-era projects are not parsed as mods.toml')
  })
})
