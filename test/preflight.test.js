/**
 * preflight.js — the pure parsers and the fs-touching checks. The wrapper
 * checks run against a real temp directory (they only stat/read two files);
 * the Java probe is always replaced through `javaVersionImpl` so these tests
 * never depend on the JDK installed on the machine running them.
 */
import assert from 'node:assert/strict'
import { chmod, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, describe, test } from 'node:test'
import {
  MIN_GRADLE_FOR_JAVA,
  detectJavaVersion,
  parseJavaMajor,
  parseProjectJavaVersion,
  preflightGradle,
} from '../lib/preflight.js'
import { runGradle } from '../lib/gradle.js'

/** Create a project root with (optionally) a wrapper and a pinned Gradle version. */
async function makeProject({ name = 'gradlew.bat', gradle = '9.2.1', buildScript = '', wrapper = true } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'mcdev-preflight-'))
  if (wrapper) {
    await writeFile(path.join(dir, name), '#!/bin/sh\n')
    if (name === 'gradlew') await chmod(path.join(dir, name), 0o755)
    await mkdir(path.join(dir, 'gradle', 'wrapper'), { recursive: true })
    await writeFile(
      path.join(dir, 'gradle', 'wrapper', 'gradle-wrapper.properties'),
      `distributionUrl=https\\://services.gradle.org/distributions/gradle-${gradle}-bin.zip\n`,
    )
  }
  if (buildScript !== '') await writeFile(path.join(dir, 'build.gradle.kts'), buildScript)
  return dir
}

describe('parseJavaMajor', () => {
  test('modern JDK version line', () => {
    assert.equal(parseJavaMajor('openjdk version "25.0.1" 2025-10-21\nOpenJDK Runtime Environment'), 25)
    assert.equal(parseJavaMajor('openjdk version "17.0.2" 2022-01-18'), 17)
  })

  test('legacy 1.x version line', () => {
    assert.equal(parseJavaMajor('java version "1.8.0_402"\nJava(TM) SE Runtime Environment'), 8)
  })

  test('unrecognized or empty output yields null', () => {
    assert.equal(parseJavaMajor(''), null)
    assert.equal(parseJavaMajor('nothing to see here'), null)
    assert.equal(parseJavaMajor(undefined), null)
  })
})

describe('parseProjectJavaVersion', () => {
  test('kotlin toolchain wins', () => {
    const script = 'kotlin { jvmToolchain(21) }\njava { toolchain { languageVersion = JavaLanguageVersion.of(17) } }'
    assert.equal(parseProjectJavaVersion(script), 17, 'languageVersion.of() is the most explicit form')
  })

  test('groovy sourceCompatibility incl. legacy 1.8', () => {
    assert.equal(parseProjectJavaVersion("sourceCompatibility = JavaVersion.VERSION_1_8"), 8)
    assert.equal(parseProjectJavaVersion('sourceCompatibility = 17\n'), 17)
  })

  test('silent build script yields null', () => {
    assert.equal(parseProjectJavaVersion('plugins { id "java" }\n'), null)
    assert.equal(parseProjectJavaVersion(''), null)
  })
})

describe('detectJavaVersion', () => {
  test('parses the fake probe output', () => {
    const fake = { spawnSync: () => ({ status: 0, stdout: '', stderr: 'openjdk version "21.0.5" 2024-10-15' }) }
    assert.equal(detectJavaVersion({ spawnSyncImpl: fake.spawnSync }), 21)
  })

  test('missing java is null, not a throw', () => {
    const fake = { spawnSync: () => ({ status: 1, error: Object.assign(new Error('ENOENT'), { code: 'ENOENT' }) }) }
    assert.equal(detectJavaVersion({ spawnSyncImpl: fake.spawnSync }), null)
  })
})

describe('preflightGradle', () => {
  let projects = []

  after(async () => {
    await Promise.all(projects.map((dir) => rm(dir, { recursive: true, force: true })))
  })

  async function project(options) {
    const dir = await makeProject(options)
    projects.push(dir)
    return dir
  }

  test('missing wrapper is a hard stop that names the fix', async () => {
    const dir = await project({ wrapper: false })
    await assert.rejects(
      preflightGradle({ projectDir: dir, platform: 'win32', internals: { javaVersionImpl: () => 25 } }),
      /no Gradle wrapper at .*gradlew\.bat: mc_gradle runs gradlew from the project root/,
    )
  })

  test('non-executable posix wrapper is a hard stop', async () => {
    const dir = await makeProject({ name: 'gradlew' })
    await chmod(path.join(dir, 'gradlew'), 0o644)
    projects.push(dir)
    await assert.rejects(
      preflightGradle({ projectDir: dir, platform: 'linux', internals: { javaVersionImpl: () => 21 } }),
      /is not executable: run "chmod \+x gradlew"/,
    )
  })

  test('clean project has no warnings', async () => {
    const dir = await project({ gradle: '9.2.1', buildScript: 'kotlin { jvmToolchain(25) }' })
    const result = await preflightGradle({ projectDir: dir, platform: 'win32', internals: { javaVersionImpl: () => 25 } })
    assert.equal(result.wrapper, 'gradlew.bat')
    assert.equal(result.gradleVersion, '9.2.1')
    assert.equal(result.javaVersion, 25)
    assert.equal(result.projectJavaVersion, 25)
    assert.deepEqual(result.warnings, [])
  })

  test('Gradle older than the running JDK requires is a warning', async () => {
    const dir = await project({ gradle: '8.14.3', buildScript: '' })
    const result = await preflightGradle({ projectDir: dir, platform: 'win32', internals: { javaVersionImpl: () => 25 } })
    assert.equal(MIN_GRADLE_FOR_JAVA[25], '9.1')
    assert.equal(result.warnings.length, 1)
    assert.match(result.warnings[0], /Gradle 8\.14\.3 is older than 9\.1, which Java 25 requires/)
    assert.match(result.warnings[0], /upgrade the wrapper/)
  })

  test('Gradle 9 rejects a pre-17 runtime', async () => {
    const dir = await project({ gradle: '9.2.1', buildScript: '' })
    const result = await preflightGradle({ projectDir: dir, platform: 'win32', internals: { javaVersionImpl: () => 11 } })
    assert.equal(result.warnings.length, 1)
    assert.match(result.warnings[0], /requires Java 17\+ to run, but `java -version` reports 11/)
  })

  test('project toolchain newer than the running JDK is a warning', async () => {
    const dir = await project({ gradle: '9.2.1', buildScript: 'java { toolchain { languageVersion = JavaLanguageVersion.of(25) } }' })
    const result = await preflightGradle({ projectDir: dir, platform: 'win32', internals: { javaVersionImpl: () => 21 } })
    assert.equal(result.warnings.length, 1)
    assert.match(result.warnings[0], /project targets Java 25 but `java -version` reports 21/)
  })

  test('no java at all is one warning, not a crash', async () => {
    const dir = await project({ gradle: '8.14.3' })
    const result = await preflightGradle({ projectDir: dir, platform: 'win32', internals: { javaVersionImpl: () => null } })
    assert.equal(result.warnings.length, 1)
    assert.match(result.warnings[0], /no working `java` on PATH/)
  })
})

describe('runGradle preflight + lock integration', () => {
  test('preflight runs before the spawn and blocks a wrapper-less project', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mcdev-preflight-'))
    let spawned = false
    try {
      await assert.rejects(
        runGradle({
          projectDir: dir,
          task: 'build',
          timeoutMs: 1000,
          tailChars: 100,
          internals: { platform: 'win32', spawnImpl: () => { spawned = true; throw new Error('must not spawn') } },
        }),
        /no Gradle wrapper/,
      )
      assert.equal(spawned, false, 'the spawn was never attempted')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('a second run in the same project is rejected instead of racing', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mcdev-lock-'))
    await writeFile(path.join(dir, 'gradlew.bat'), '')
    const handlers = {}
    const fakeChild = {
      pid: 4242,
      stdout: { on: () => {} },
      stderr: { on: () => {} },
      on: (event, handler) => { handlers[event] = handler },
      kill: () => {},
    }
    const first = runGradle({
      projectDir: dir,
      task: 'build',
      timeoutMs: 50,
      tailChars: 100,
      internals: {
        platform: 'win32',
        skipPreflight: true,
        spawnImpl: () => fakeChild,
        killTreeImpl: () => handlers.close?.(null, 'SIGTERM'),
      },
    })
    await assert.rejects(
      runGradle({
        projectDir: dir,
        task: 'test',
        timeoutMs: 200,
        tailChars: 100,
        internals: {
          platform: 'win32',
          skipPreflight: true,
          spawnImpl: () => { throw new Error('must not spawn') },
        },
      }),
      /another mc_gradle run is already active/,
    )
    const result = await first
    assert.equal(result.timedOut, true)
    await rm(dir, { recursive: true, force: true })
  })
})
