import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { auditProject } from '../lib/port-audit.js'

/** Join lines and end with a newline so fixtures have stable line numbers. */
function text(...lines) {
  return `${lines.join('\n')}\n`
}

/**
 * Write a fixture tree under a fresh temp directory and run the audit.
 * @param {Record<string, string>} files relative path → contents
 * @param {(projectDir: string) => Promise<any>} run
 */
async function withFixture(files, run) {
  const projectDir = await mkdtemp(path.join(tmpdir(), 'minecraft-dev-port-audit-'))
  try {
    for (const [relative, contents] of Object.entries(files)) {
      const target = path.join(projectDir, ...relative.split('/'))
      await mkdir(path.dirname(target), { recursive: true })
      await writeFile(target, contents, 'utf8')
    }
    return await run(projectDir)
  } finally {
    await rm(projectDir, { recursive: true, force: true })
  }
}

function wrapperProperties(gradleVersion) {
  return text(
    'distributionBase=GRADLE_USER_HOME',
    'distributionPath=wrapper/dists',
    `distributionUrl=https\\://services.gradle.org/distributions/gradle-${gradleVersion}-bin.zip`,
    'zipStoreBase=GRADLE_USER_HOME',
    'zipStorePath=wrapper/dists',
  )
}

/** A 1.7.10-era Forge project: legacy loader package, Java 8, Gradle 4.9. */
function legacyForgeFiles() {
  return {
    'gradle/wrapper/gradle-wrapper.properties': wrapperProperties('4.9'),
    'build.gradle': text(
      'buildscript {',
      "    repositories { maven { url = 'https://maven.minecraftforge.net/' } }",
      "    dependencies { classpath 'com.anatawa12.forge:ForgeGradle:1.2-1.1.+' }",
      '}',
      "apply plugin: 'forge'",
      "minecraft { version = '1.7.10-10.13.4.1614' }",
      "sourceCompatibility = '1.8'",
      "targetCompatibility = '1.8'",
      "dependencies { minecraft 'net.minecraftforge:forge:1.7.10-10.13.4.1614' }",
      '}',
    ),
    'src/main/java/com/example/legacy/LegacyMod.java': text(
      'package com.example.legacy;',
      '',
      'import cpw.mods.fml.common.Mod;',
      'import net.minecraftforge.fml.common.GameRegistry;',
      'import net.minecraftforge.fml.common.event.FMLPreInitializationEvent;',
      '',
      '@Mod(modid = "legacy")',
      'public final class LegacyMod {',
      '    public void preInit(FMLPreInitializationEvent event) {',
      '        GameRegistry.registerBlock(null, "legacy_block");',
      '    }',
      '}',
    ),
  }
}

/** A Forge 1.20.1 project whose mods.toml forge range is too narrow. */
function forgeMetadataFiles() {
  return {
    'gradle/wrapper/gradle-wrapper.properties': wrapperProperties('8.8'),
    'build.gradle': text(
      'plugins {',
      "    id 'net.minecraftforge.gradle' version '6.0.54'",
      '}',
      '',
      "group = 'com.example'",
      "version = '1.0.0'",
      '',
      'java.toolchain.languageVersion = JavaLanguageVersion.of(17)',
      '',
      'minecraft {',
      "    mappings channel: 'official', version: '1.20.1'",
      '}',
      '',
      'repositories {',
      "    maven { url = 'https://maven.minecraftforge.net/' }",
      '}',
      '',
      'dependencies {',
      "    minecraft 'net.minecraftforge:forge:1.20.1-47.3.0'",
      '}',
    ),
    'settings.gradle': text(
      'plugins {',
      "    id 'org.gradle.toolchains.foojay-resolver-convention' version '1.0.0'",
      '}',
      '',
      "rootProject.name = 'example-mod'",
    ),
    'src/main/resources/META-INF/mods.toml': text(
      'modLoader="javafml"',
      'loaderVersion="[47,)"',
      'license="MIT"',
      '',
      '[[mods]]',
      'modId="example"',
      'version="1.0"',
      'displayName="Example"',
      '',
      '[[dependencies.example]]',
      'modId="forge"',
      'mandatory=true',
      'versionRange="[47.0,47.1)"',
      'ordering="NONE"',
      'side="BOTH"',
      '',
      '[[dependencies.example]]',
      'modId="minecraft"',
      'mandatory=true',
      'versionRange="[1.20.1,1.21)"',
      'ordering="NONE"',
      'side="BOTH"',
    ),
  }
}

/** A clean Paper project. Every field is parameterized for the migration cases. */
function paperFiles({
  minecraftVersion = '1.21.8',
  javaVersion = 21,
  apiVersion = '1.21',
  gradleVersion = '8.14.3',
  paperApi = `${minecraftVersion}-R0.1-SNAPSHOT`,
} = {}) {
  return {
    'gradle/wrapper/gradle-wrapper.properties': wrapperProperties(gradleVersion),
    'build.gradle.kts': text(
      'plugins {',
      '    id("java-library")',
      '    id("com.gradleup.shadow") version "8.3.6"',
      '}',
      '',
      'group = "com.example"',
      'version = "1.0.0"',
      '',
      'repositories {',
      '    mavenCentral()',
      '    maven("https://repo.papermc.io/repository/maven-public/")',
      '}',
      '',
      'dependencies {',
      `    compileOnly("io.papermc.paper:paper-api:${paperApi}")`,
      '}',
      '',
      'java {',
      '    toolchain {',
      `        languageVersion = JavaLanguageVersion.of(${javaVersion})`,
      '    }',
      '}',
      '',
      'tasks {',
      '    shadowJar {',
      '        archiveClassifier.set("")',
      '    }',
      '}',
    ),
    'settings.gradle.kts': text(
      'pluginManagement {',
      '    repositories {',
      '        gradlePluginPortal()',
      '    }',
      '}',
      '',
      'plugins {',
      '    id("org.gradle.toolchains.foojay-resolver-convention") version "1.0.0"',
      '}',
      '',
      'rootProject.name = "clean-paper"',
    ),
    'src/main/resources/plugin.yml': text(
      'name: CleanPaper',
      'version: "1.0.0"',
      'main: com.example.cleanpaper.CleanPaperPlugin',
      `api-version: "${apiVersion}"`,
    ),
    'src/main/java/com/example/cleanpaper/CleanPaperPlugin.java': text(
      'package com.example.cleanpaper;',
      '',
      'import org.bukkit.plugin.java.JavaPlugin;',
      '',
      'public final class CleanPaperPlugin extends JavaPlugin {',
      '    @Override',
      '    public void onEnable() {',
      '        getLogger().info("enabled");',
      '    }',
      '}',
    ),
  }
}

/** A Spigot 1.12.2 project: Java 8 and no plugin.yml api-version. */
function spigotLegacyFiles() {
  return {
    'gradle/wrapper/gradle-wrapper.properties': wrapperProperties('8.14.3'),
    'build.gradle': text(
      'plugins {',
      "    id 'java'",
      '}',
      '',
      "group = 'com.example'",
      "version = '1.0.0'",
      '',
      "sourceCompatibility = targetCompatibility = '1.8'",
      '',
      'repositories {',
      "    maven { url = 'https://hub.spigotmc.org/nexus/content/repositories/snapshots/' }",
      '}',
      '',
      'dependencies {',
      "    compileOnly 'org.spigotmc:spigot-api:1.12.2-R0.1-SNAPSHOT'",
      '}',
    ),
    'src/main/resources/plugin.yml': text(
      'name: LegacyPlugin',
      'version: "1.0.0"',
      'main: com.example.legacy.LegacyPlugin',
    ),
    'src/main/java/com/example/legacy/LegacyPlugin.java': text(
      'package com.example.legacy;',
      '',
      'import org.bukkit.plugin.java.JavaPlugin;',
      '',
      'public final class LegacyPlugin extends JavaPlugin {',
      '}',
    ),
  }
}

/** Convert every fixture file to CRLF line endings. */
function toCrlf(files) {
  return Object.fromEntries(
    Object.entries(files).map(([relative, contents]) => [relative, contents.replace(/\n/g, '\r\n')]),
  )
}

/** Snapshot every file's path, bytes and mtime to prove the audit is read-only. */
async function snapshotTree(root) {
  const entries = []
  async function visit(directory, prefix) {
    const children = await readdir(directory, { withFileTypes: true })
    children.sort((left, right) => left.name.localeCompare(right.name))
    for (const child of children) {
      const relative = prefix ? `${prefix}/${child.name}` : child.name
      const absolute = path.join(directory, child.name)
      if (child.isDirectory()) {
        await visit(absolute, relative)
      } else if (child.isFile()) {
        const info = await stat(absolute)
        entries.push({
          relative,
          content: await readFile(absolute, 'utf8'),
          mtimeMs: info.mtimeMs,
          size: info.size,
        })
      }
    }
  }
  await visit(root, '')
  return entries
}

test('1.7.10 Forge migration to forge 1.20.1 reports blockers with file and line', async () => {
  await withFixture(legacyForgeFiles(), async (projectDir) => {
    const result = await auditProject({ projectDir, platform: 'forge', minecraftVersion: '1.20.1' })

    assert.equal(result.ok, false)
    assert.equal(result.target.line, '1.20')
    assert.equal(result.target.javaVersion, 17)

    const gradle = result.findings.find((finding) => finding.code === 'GRADLE_TOO_OLD')
    assert.ok(gradle)
    assert.equal(gradle.severity, 'blocker')
    assert.equal(gradle.file, 'gradle/wrapper/gradle-wrapper.properties')
    assert.equal(gradle.line, 3)

    const java = result.findings.find((finding) => finding.code === 'JAVA_LEVEL_MISMATCH' && finding.line === 7)
    assert.ok(java)
    assert.equal(java.severity, 'blocker')
    assert.equal(java.file, 'build.gradle')

    const buildPlugin = result.findings.find((finding) => finding.code === 'BUILD_PLUGIN_MISMATCH')
    assert.ok(buildPlugin)
    assert.equal(buildPlugin.severity, 'blocker')

    const gameRegistry = result.findings.find(
      (finding) => finding.code === 'REMOVED_API' && finding.message.includes('GameRegistry'),
    )
    assert.ok(gameRegistry)
    assert.equal(gameRegistry.severity, 'blocker')
    assert.equal(gameRegistry.file, 'src/main/java/com/example/legacy/LegacyMod.java')
    assert.equal(gameRegistry.line, 4)

    const preInit = result.findings.find(
      (finding) => finding.code === 'REMOVED_API' && finding.message.includes('FMLPreInitializationEvent'),
    )
    assert.ok(preInit)
    assert.equal(preInit.line, 5)

    assert.ok(result.findings.some((finding) => finding.code === 'METADATA_MISSING'))
    assert.ok(result.findings.some((finding) => finding.code === 'FOOJAY_MISSING'))
    assert.ok(result.findings.some((finding) => finding.code === 'DEPENDENCY_VERSION'))
    assert.ok(result.summary.blockers >= 6)
    assert.ok(result.summary.warnings >= 3)
  })
})

test('clean paper 1.21.8 project has no findings and ok is true', async () => {
  await withFixture(paperFiles(), async (projectDir) => {
    const result = await auditProject({ projectDir, platform: 'paper', minecraftVersion: '1.21.8' })

    assert.equal(result.ok, true)
    assert.deepEqual(result.findings, [])
    assert.deepEqual(result.summary, { blockers: 0, warnings: 0, infos: 0 })
    assert.equal(result.target.line, '1.21')
    assert.equal(result.target.javaVersion, 21)
    assert.equal(result.project.detected.gradleVersion, '8.14.3')
    assert.equal(result.project.detected.foojay, true)
  })
})

test('mods.toml version range that misses the target is a blocker with line number', async () => {
  await withFixture(forgeMetadataFiles(), async (projectDir) => {
    const result = await auditProject({ projectDir, platform: 'forge', minecraftVersion: '1.20.1' })

    assert.equal(result.ok, false)
    const finding = result.findings.find((item) => item.code === 'METADATA_VERSION_RANGE')
    assert.ok(finding)
    assert.equal(finding.severity, 'blocker')
    assert.equal(finding.file, 'src/main/resources/META-INF/mods.toml')
    assert.equal(finding.line, 13)
    assert.match(finding.message, /\[47\.0,47\.1\)/)
    assert.match(finding.message, /47\.3\.0/)
    assert.deepEqual(result.summary, { blockers: 1, warnings: 0, infos: 0 })
  })
})

test('Java 21 project migrated to paper 26.3 (Java 25) gets JAVA_LEVEL_MISMATCH', async () => {
  const files = paperFiles({ gradleVersion: '9.2.1', apiVersion: '26.3', paperApi: '26.3.build.+' })
  await withFixture(files, async (projectDir) => {
    const result = await auditProject({ projectDir, platform: 'paper', minecraftVersion: '26.3' })

    assert.equal(result.ok, false)
    assert.equal(result.target.javaVersion, 25)
    assert.deepEqual(result.summary, { blockers: 1, warnings: 0, infos: 0 })
    const finding = result.findings[0]
    assert.equal(finding.code, 'JAVA_LEVEL_MISMATCH')
    assert.equal(finding.severity, 'blocker')
    assert.equal(finding.file, 'build.gradle.kts')
    assert.match(finding.message, /25/)
  })
})

test('invalid target versions and unusable project paths throw clear errors', async () => {
  const projectDir = await mkdtemp(path.join(tmpdir(), 'minecraft-dev-port-audit-'))
  try {
    await assert.rejects(
      () => auditProject({ projectDir, platform: 'paper', minecraftVersion: '1.99' }),
      /no template for paper 1\.99/,
    )
    await assert.rejects(
      () => auditProject({ projectDir, platform: 'mystery', minecraftVersion: '1.21.8' }),
      /unsupported platform "mystery"/,
    )
    await assert.rejects(
      () => auditProject({ projectDir: path.join(projectDir, 'missing'), platform: 'paper', minecraftVersion: '1.21.8' }),
      /does not exist/,
    )

    const filePath = path.join(projectDir, 'not-a-directory')
    await writeFile(filePath, 'x', 'utf8')
    await assert.rejects(
      () => auditProject({ projectDir: filePath, platform: 'paper', minecraftVersion: '1.21.8' }),
      /is not a directory/,
    )
  } finally {
    await rm(projectDir, { recursive: true, force: true })
  }
})

test('audit is read-only: file list, contents and mtimes are unchanged', async () => {
  await withFixture(legacyForgeFiles(), async (projectDir) => {
    const before = await snapshotTree(projectDir)
    await auditProject({ projectDir, platform: 'forge', minecraftVersion: '1.20.1' })
    const after = await snapshotTree(projectDir)
    assert.deepEqual(after, before)
  })
})

test('result structure is complete and findings are well formed', async () => {
  await withFixture(forgeMetadataFiles(), async (projectDir) => {
    const result = await auditProject({ projectDir, platform: 'forge', minecraftVersion: '1.20.1' })

    assert.deepEqual(Object.keys(result).sort(), ['findings', 'ok', 'project', 'summary', 'target'])
    assert.equal(typeof result.ok, 'boolean')
    assert.equal(result.project.dir, projectDir)
    assert.equal(result.project.platform, 'forge')
    assert.equal(result.project.minecraftVersion, '1.20.1')
    assert.equal(typeof result.project.detected, 'object')
    assert.equal(result.target.line, '1.20')
    assert.equal(result.target.javaVersion, 17)
    assert.equal(result.target.coords.forgeVersion, '47.3.0')

    const expected = { blockers: 0, warnings: 0, infos: 0 }
    for (const finding of result.findings) {
      assert.ok(['blocker', 'warning', 'info'].includes(finding.severity))
      assert.equal(typeof finding.code, 'string')
      assert.ok(finding.code.length > 0)
      assert.equal(typeof finding.message, 'string')
      assert.ok(finding.message.length > 0)
      if ('file' in finding) assert.equal(typeof finding.file, 'string')
      if ('line' in finding) {
        assert.equal(typeof finding.line, 'number')
        assert.ok(Number.isInteger(finding.line) && finding.line > 0)
      }
      if ('hint' in finding) assert.equal(typeof finding.hint, 'string')
      if (finding.severity === 'blocker') expected.blockers += 1
      else if (finding.severity === 'warning') expected.warnings += 1
      else expected.infos += 1
    }
    assert.deepEqual(result.summary, expected)
    assert.equal(result.ok, expected.blockers === 0)
  })
})

test('empty project directory does not throw and reports missing pieces as warnings', async () => {
  await withFixture({}, async (projectDir) => {
    const result = await auditProject({ projectDir, platform: 'forge', minecraftVersion: '1.20.1' })

    assert.equal(result.ok, false)
    assert.deepEqual(result.project.detected.buildScripts, [])
    const codes = result.findings.map((finding) => finding.code)
    assert.ok(codes.includes('GRADLE_WRAPPER_MISSING'))
    assert.ok(codes.includes('METADATA_MISSING'))
    assert.ok(codes.includes('FOOJAY_MISSING'))
    assert.ok(codes.includes('BUILD_PLUGIN_MISMATCH'))
    assert.ok(result.summary.warnings >= 3)
    assert.ok(result.findings.every((finding) => finding.severity !== 'info' || codes.length > 0))
  })
})

test('findings are sorted blockers first, then by file and line', async () => {
  await withFixture(legacyForgeFiles(), async (projectDir) => {
    const result = await auditProject({ projectDir, platform: 'forge', minecraftVersion: '1.20.1' })
    const rank = { blocker: 0, warning: 1, info: 2 }

    for (let index = 1; index < result.findings.length; index += 1) {
      const previous = result.findings[index - 1]
      const current = result.findings[index]
      assert.ok(rank[previous.severity] <= rank[current.severity])
      if (previous.severity === current.severity && previous.file === current.file) {
        assert.ok((previous.line ?? 0) <= (current.line ?? 0))
      }
    }

    const removedLines = result.findings
      .filter((finding) => finding.code === 'REMOVED_API')
      .map((finding) => finding.line)
    assert.deepEqual(removedLines, [...removedLines].sort((left, right) => left - right))
  })
})

test('CRLF fixtures are parsed like LF fixtures', async () => {
  await withFixture(toCrlf(paperFiles()), async (projectDir) => {
    const result = await auditProject({ projectDir, platform: 'paper', minecraftVersion: '1.21.8' })
    assert.equal(result.ok, true)
    assert.deepEqual(result.findings, [])
  })
})

test('auditing the original 1.7.10 line keeps the legacy APIs and reports no findings', async () => {
  await withFixture(legacyForgeFiles(), async (projectDir) => {
    const result = await auditProject({ projectDir, platform: 'forge', minecraftVersion: '1.7.10' })

    assert.equal(result.ok, true)
    assert.deepEqual(result.findings, [])
    assert.equal(result.target.javaVersion, 8)
  })
})

test('spigot 1.12.2 without api-version reports an info, not a warning', async () => {
  await withFixture(spigotLegacyFiles(), async (projectDir) => {
    const result = await auditProject({ projectDir, platform: 'spigot', minecraftVersion: '1.12.2' })

    assert.equal(result.ok, true)
    assert.deepEqual(result.summary, { blockers: 0, warnings: 0, infos: 1 })
    assert.equal(result.findings.length, 1)
    const finding = result.findings[0]
    assert.equal(finding.code, 'PLUGIN_API_VERSION')
    assert.equal(finding.severity, 'info')
    assert.equal(finding.file, 'src/main/resources/plugin.yml')
  })
})

test('a Java level above the target line is a warning, not a blocker', async () => {
  const files = paperFiles({
    minecraftVersion: '1.20.6',
    javaVersion: 21,
    apiVersion: '1.20',
    gradleVersion: '9.1',
  })
  await withFixture(files, async (projectDir) => {
    const result = await auditProject({ projectDir, platform: 'paper', minecraftVersion: '1.20.6' })

    assert.equal(result.ok, true)
    assert.deepEqual(result.summary, { blockers: 0, warnings: 1, infos: 0 })
    const finding = result.findings[0]
    assert.equal(finding.code, 'JAVA_LEVEL_MISMATCH')
    assert.equal(finding.severity, 'warning')
  })
})
