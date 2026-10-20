import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_PACKAGE,
  UsageError,
  defaultProjectName,
  defaultTargetDir,
  listRows,
  normalizeVersion,
  parseArgs,
  renderList,
  renderSummary,
  summarize,
  targetFolder,
} from '../scripts/smoke-build.mjs'
import { validateProjectName } from '../lib/validate.js'

/**
 * Pure-function coverage for the generated-artifact build gate. These tests
 * never scaffold, never touch the network and never invoke Gradle: they pin the
 * argv contract, the derived directory/project names, and the --list matrix that
 * the CI workflow depends on.
 */

test('parseArgs derives the documented defaults from --platform/--mc', () => {
  const options = parseArgs(['--platform', 'paper', '--mc', '1.21.8'])
  assert.equal(options.mode, 'scaffold')
  assert.equal(options.platform, 'paper')
  assert.equal(options.mc, '1.21.8')
  assert.equal(options.dir, '.smoke/paper-1.21.8')
  assert.equal(options.name, 'smoke-paper-1-21-8')
  assert.equal(options.packageName, DEFAULT_PACKAGE)
  assert.equal(options.json, false)
  // The derived name must satisfy the scaffold's own naming rule.
  assert.doesNotThrow(() => validateProjectName(options.name))
})

test('parseArgs accepts explicit --dir/--name/--package and --json', () => {
  const options = parseArgs([
    '--platform', 'fabric',
    '--mc', '26.3',
    '--dir', 'D:/tmp/smoke/fabric',
    '--name', 'my-smoke-mod',
    '--package', 'com.example.smoke.mod',
    '--json',
  ])
  assert.equal(options.dir, 'D:/tmp/smoke/fabric')
  assert.equal(options.name, 'my-smoke-mod')
  assert.equal(options.packageName, 'com.example.smoke.mod')
  assert.equal(options.json, true)
})

test('parseArgs supports --flag=value form', () => {
  const options = parseArgs(['--platform=neoforge', '--mc=26.3', '--dir=.smoke/neo-26.3'])
  assert.equal(options.mode, 'scaffold')
  assert.equal(options.platform, 'neoforge')
  assert.equal(options.mc, '26.3')
  assert.equal(options.dir, '.smoke/neo-26.3')
  assert.equal(options.name, 'smoke-neoforge-26-3')
})

test('parseArgs rejects a value on a boolean flag', () => {
  assert.throws(() => parseArgs(['--platform', 'paper', '--mc', '1.21.8', '--json=true']), UsageError)
  assert.throws(() => parseArgs(['--list=1']), UsageError)
})

test('parseArgs rejects missing or empty values', () => {
  assert.throws(() => parseArgs(['--platform', 'paper', '--mc']), UsageError)
  assert.throws(() => parseArgs(['--platform', 'paper', '--mc', '1.21.8', '--dir']), UsageError)
  assert.throws(() => parseArgs(['--platform', 'paper', '--mc', '1.21.8', '--dir', '']), UsageError)
})

test('parseArgs rejects unknown arguments', () => {
  assert.throws(() => parseArgs(['--platform', 'paper', '--mc', '1.21.8', '--verbose']), /unknown argument/)
})

test('parseArgs requires --platform and --mc for scaffold mode', () => {
  assert.throws(() => parseArgs([]), /missing --platform/)
  assert.throws(() => parseArgs(['--platform', 'paper']), /missing --mc/)
})

test('parseArgs rejects unsupported platforms and matrix combinations', () => {
  assert.throws(() => parseArgs(['--platform', 'bukkit', '--mc', '1.21.8']), /unsupported platform/)
  // A version the shipped matrix does not cover must fail before any write.
  assert.throws(() => parseArgs(['--platform', 'paper', '--mc', '1.99']), UsageError)
  // Mod-platform lines are pinned to one full version each; no silent substitution.
  assert.throws(() => parseArgs(['--platform', 'fabric', '--mc', '1.21.8']), /pinned to fabric 1\.21\.8/)
})

test('parseArgs rejects malformed names, packages and versions', () => {
  assert.throws(() => parseArgs(['--platform', 'paper', '--mc', '1.21.8', '--name', 'My_Plugin']), /invalid project name/)
  assert.throws(() => parseArgs(['--platform', 'paper', '--mc', '1.21.8', '--package', 'com.Example']), /invalid Java package/)
  assert.throws(() => parseArgs(['--platform', 'paper', '--mc', 'twenty']), /invalid Minecraft version/)
})

test('--list mode does not require a platform or version', () => {
  const options = parseArgs(['--list'])
  assert.equal(options.mode, 'list')
  assert.equal(options.json, false)
  const json = parseArgs(['--list', '--json'])
  assert.equal(json.mode, 'list')
  assert.equal(json.json, true)
  assert.throws(() => parseArgs(['--list', '--platform', 'paper']), /--list does not combine/)
})

test('--help wins over the required platform/version', () => {
  const options = parseArgs(['--help'])
  assert.equal(options.mode, 'help')
})

test('normalizeVersion strips a trailing .x and keeps full versions', () => {
  assert.equal(normalizeVersion('1.21.x'), '1.21')
  assert.equal(normalizeVersion('26.x'), '26')
  assert.equal(normalizeVersion('1.21.8'), '1.21.8')
  assert.equal(normalizeVersion('26.3'), '26.3')
})

test('directory naming is stable and filesystem-safe', () => {
  assert.equal(targetFolder('paper', '1.21.8'), 'paper-1.21.8')
  assert.equal(targetFolder('paper', '1.21.x'), 'paper-1.21')
  assert.equal(defaultTargetDir('forge', '1.12.2'), '.smoke/forge-1.12.2')
  assert.equal(defaultTargetDir('neoforge', '26.3'), '.smoke/neoforge-26.3')
})

test('derived project names are valid kebab-case for every matrix row', () => {
  for (const row of listRows()) {
    const name = defaultProjectName(row.platform, row.mc)
    assert.match(name, /^[a-z][a-z0-9-]*$/, `${row.platform} ${row.mc} -> ${name}`)
    assert.doesNotThrow(() => validateProjectName(name))
    // No dots: a scaffold project name with dots would be rejected by validate.
    assert.ok(!name.includes('.'), `${name} must not contain dots`)
  }
  assert.equal(defaultProjectName('paper', '1.21.8'), 'smoke-paper-1-21-8')
  assert.equal(defaultProjectName('fabric', '26.3'), 'smoke-fabric-26-3')
})

test('listRows exposes all 19 shipped platform x line combinations', () => {
  const rows = listRows()
  assert.equal(rows.length, 19)
  assert.deepEqual([...new Set(rows.map(row => row.platform))], ['paper', 'fabric', 'forge', 'neoforge', 'spigot'])
  for (const row of rows) {
    assert.ok([8, 17, 21, 25].includes(row.java), `unsupported java ${row.java} for ${row.platform} ${row.line}`)
    assert.notEqual(row.gradle, '-', `missing gradleVersion for ${row.platform} ${row.line}`)
    assert.match(row.template, /^[a-z0-9.-]+$/)
  }
  // The four CI rows must be present with the wrapper version the job expects.
  const byPlatformAndMc = new Map(rows.map(row => [`${row.platform} ${row.mc}`, row]))
  assert.deepEqual(byPlatformAndMc.get('paper 1.21.8'), {
    platform: 'paper', line: '1.21', mc: '1.21.8', java: 21, gradle: '8.14.3', template: 'paper',
  })
  assert.equal(byPlatformAndMc.get('fabric 26.3').gradle, '9.5.1')
  assert.equal(byPlatformAndMc.get('fabric 26.3').java, 25)
  assert.equal(byPlatformAndMc.get('neoforge 26.3').gradle, '9.2.1')
  assert.equal(byPlatformAndMc.get('neoforge 26.3').java, 25)
  assert.equal(byPlatformAndMc.get('forge 1.12.2').gradle, '4.9')
  assert.equal(byPlatformAndMc.get('forge 1.12.2').java, 8)
})

test('renderList prints every platform and the row count', () => {
  const rows = listRows()
  const table = renderList(rows)
  assert.match(table, /Supported scaffold targets \(19\)/)
  assert.match(table, /^platform\s+line\s+mc\s+java\s+gradle\s+template$/m)
  for (const platform of ['paper', 'fabric', 'forge', 'neoforge', 'spigot']) {
    assert.match(table, new RegExp(`^${platform}\\s`, 'm'), `missing ${platform} row`)
  }
  for (const version of ['1.21.8', '26.3', '1.12.2', '4.9']) {
    assert.ok(table.includes(version), `missing ${version}`)
  }
  // Header + separator + one line per row: keep the table machine-scannable.
  assert.equal(table.split('\n').filter(line => /^(paper|fabric|forge|neoforge|spigot)\s/.test(line)).length, 19)
})

test('summarize/renderSummary report directory, build command and file count', () => {
  const row = listRows().find(entry => entry.platform === 'paper' && entry.mc === '1.21.8')
  const summary = summarize(
    {
      platform: 'paper',
      minecraftVersion: '1.21.8',
      projectDir: 'D:/tmp/.smoke/paper-1.21.8',
      filesCreated: ['gradlew', 'gradlew.bat', 'build.gradle.kts'],
      buildCommand: './gradlew build',
      wrapperReady: true,
    },
    { name: 'smoke-paper-1-21-8', packageName: DEFAULT_PACKAGE, dir: '.smoke/paper-1.21.8' },
    { javaVersion: row.java, coords: { gradleVersion: row.gradle } },
  )
  assert.equal(summary.ok, true)
  assert.equal(summary.files, 3)
  assert.equal(summary.directory, '.smoke/paper-1.21.8')
  assert.equal(summary.buildCommand, './gradlew build')
  assert.equal(summary.javaVersion, 21)
  assert.equal(summary.gradleVersion, '8.14.3')

  const text = renderSummary(summary)
  assert.ok(text.includes('D:/tmp/.smoke/paper-1.21.8'))
  assert.ok(text.includes('./gradlew build'))
  assert.ok(text.includes('files:    3'))
})
