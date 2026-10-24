/**
 * next-steps.js — the hint lists are model-facing text, so the tests assert the
 * contract that matters: the block is empty when it should be, each hint names
 * a concrete next action, and the failure classification fires on the loud
 * Gradle error strings (which is all that survives output truncation).
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  SKILL_BY_PLATFORM,
  appendNextSteps,
  auditNextSteps,
  codexNextSteps,
  formatNextSteps,
  gradleNextSteps,
  scaffoldNextSteps,
} from '../lib/next-steps.js'

describe('formatNextSteps / appendNextSteps', () => {
  test('empty and undefined render nothing', () => {
    assert.equal(formatNextSteps([]), '')
    assert.equal(formatNextSteps(undefined), '')
    assert.equal(appendNextSteps('body', []), 'body')
    assert.equal(appendNextSteps('body', undefined), 'body')
  })

  test('block is appended after exactly one blank line', () => {
    const text = appendNextSteps('body\n\n', ['one', 'two'])
    assert.equal(text, 'body\n\nNext steps:\n- one\n- two')
  })

  test('an empty body starts with the block', () => {
    assert.equal(appendNextSteps('', ['only']), 'Next steps:\n- only')
  })
})

describe('scaffoldNextSteps', () => {
  test('fabric: build, run, and load the owning skill', () => {
    const steps = scaffoldNextSteps({
      platform: 'fabric',
      minecraftVersion: '1.21.8',
      projectDir: 'D:\\proj',
      buildCommand: 'gradlew.bat build',
    })
    assert.ok(steps[0].includes('mc_gradle task="build"'))
    assert.ok(steps.some((step) => step.includes('minecraft-fabric-mod')))
    assert.ok(steps.some((step) => step.includes('runClient')))
    assert.ok(!steps.some((step) => step.includes('libs\\')), 'only 1.7.10 spigot gets the vendored-jar hint')
  })

  test('spigot 1.7.10: vendored jar hint uses the project separator', () => {
    const steps = scaffoldNextSteps({
      platform: 'spigot',
      minecraftVersion: '1.7.10',
      projectDir: 'D:/proj',
      buildCommand: './gradlew build',
    })
    assert.ok(steps.some((step) => step.includes('D:/proj/libs/') && step.includes('spigot-api')))
    assert.ok(steps.some((step) => step.includes('plugins/ directory')))
  })

  test('every platform maps to an existing skill', () => {
    assert.deepEqual(Object.keys(SKILL_BY_PLATFORM).sort(), ['fabric', 'forge', 'neoforge', 'paper', 'spigot'])
  })
})

describe('gradleNextSteps', () => {
  const ok = { exitCode: 0, signal: null, timedOut: false, aborted: false, timeoutMs: 1000, output: { text: '' } }
  const args = { task: 'build', projectDir: '/p' }

  test('build success points at run tasks and tests', () => {
    const steps = gradleNextSteps(args, ok)
    assert.ok(steps.some((step) => step.includes('runClient')))
    assert.ok(steps.some((step) => step.includes('task="test"')))
  })

  test('timeout suggests a bigger timeout and --no-daemon', () => {
    const steps = gradleNextSteps(args, { ...ok, exitCode: null, timedOut: true, timeoutMs: 600000 })
    assert.ok(steps[0].includes('600000ms'))
    assert.ok(steps[0].includes('--no-daemon'))
  })

  test('abort suggests --stop', () => {
    const steps = gradleNextSteps(args, { ...ok, exitCode: null, aborted: true })
    assert.ok(steps[0].includes('--stop'))
  })

  test('JDK mismatch output is classified', () => {
    const steps = gradleNextSteps(args, {
      ...ok,
      exitCode: 1,
      output: { text: 'error: invalid source release: 21\nhas been compiled by a more recent version' },
    })
    assert.ok(steps[0].includes('JDK/toolchain mismatch'))
    assert.ok(steps.some((step) => step.includes('re-run the same task')))
  })

  test('network failure output is classified', () => {
    const steps = gradleNextSteps(args, {
      ...ok,
      exitCode: 1,
      output: { text: 'Could not resolve org.spongepowered:mixin\n> Could not get resource https://repo.example/x.pom' },
    })
    assert.ok(steps.some((step) => step.includes('--refresh-dependencies')))
  })

  test('out-of-memory and daemon locks are classified', () => {
    const oom = gradleNextSteps(args, { ...ok, exitCode: 1, output: { text: 'java.lang.OutOfMemoryError: Java heap space' } })
    assert.ok(oom.some((step) => step.includes('org.gradle.jvmargs')))
    const lock = gradleNextSteps(args, { ...ok, exitCode: 1, output: { text: 'Timeout waiting to lock buildOutputCleanup cache (Daemon)' } })
    assert.ok(lock.some((step) => step.includes('task="--stop"')))
  })

  test('successful runServer points at logs', () => {
    const steps = gradleNextSteps({ task: 'runServer', projectDir: 'D:\\srv' }, ok)
    assert.ok(steps[0].includes('logs/latest.log') || steps[0].includes('latest.log'))
  })
})

describe('auditNextSteps', () => {
  test('blockers first, then re-audit and the porting skill', () => {
    const steps = auditNextSteps({
      ok: false,
      project: { platform: 'forge', minecraftVersion: '1.20.1', dir: 'D:\\old' },
    })
    assert.ok(steps[0].includes('blocker'))
    assert.ok(steps[1].includes('mc_port_audit projectDir="D:\\old"'))
    assert.ok(steps[2].includes('minecraft-porting'))
  })

  test('clean audit points at mc_scaffold and the build gate', () => {
    const steps = auditNextSteps({
      ok: true,
      project: { platform: 'fabric', minecraftVersion: '1.21.8', dir: '/p' },
    })
    assert.ok(steps[0].includes('mc_scaffold platform="fabric"'))
    assert.ok(steps[1].includes('mc_gradle task="build"'))
  })
})

describe('codexNextSteps', () => {
  const base = { exitCode: 0, signal: null, timedOut: false, aborted: false, projectDir: 'D:\\arch', lastMessageFile: 'D:\\arch\\.dsh\\codex-last-message.md' }

  test('success verifies the skeleton', () => {
    const steps = codexNextSteps(base)
    assert.ok(steps[0].includes('mc_gradle task="build"'))
    assert.ok(steps[1].includes('[TODO: Agent B]'))
  })

  test('timeout and failure do not invite blind retries', () => {
    const timedOut = codexNextSteps({ ...base, exitCode: null, timedOut: true })
    assert.ok(timedOut[0].includes('do not retry blindly'))
    const failed = codexNextSteps({ ...base, exitCode: 1 })
    assert.ok(failed[0].includes('Do not retry blindly'))
    assert.ok(failed[1].includes(base.lastMessageFile))
  })

  test('abort points at the desktop app or the subagent chain', () => {
    const steps = codexNextSteps({ ...base, exitCode: null, aborted: true })
    assert.ok(steps[0].includes('Codex desktop app'))
  })
})
