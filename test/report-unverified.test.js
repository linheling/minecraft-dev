import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { DEFAULT_DIR, scan, main } from '../scripts/report-unverified.mjs'

// report-unverified：只读统计 assets/skills/**/*.md 的 UNVERIFIED 行。
// 全部用例走临时目录 fixture，不改仓库文件、不联网。

function makeFixture(files) {
  const dir = mkdtempSync(join(tmpdir(), 'report-unverified-'))
  for (const [name, content] of Object.entries(files)) {
    const file = join(dir, name)
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, content)
  }
  return dir
}

function capture() {
  let output = ''
  return {
    stdout: { write: (chunk) => { output += chunk } },
    stderr: { write: (chunk) => { output += chunk } },
    get output() { return output },
  }
}

test('scan 按行统计标记、跳过非 md、记录行号与整行文本', (t) => {
  const dir = makeFixture({
    'SKILL.md': '# 标题\r\nUNVERIFIED 第一条\r\n中文 UNVERIFIED 两处 UNVERIFIED\r\n',
    'references/a.md': '\nUNVERIFIED 一条\n普通行\n',
    'references/deep/b.md': '没有任何标记\n',
    'notes.txt': 'UNVERIFIED 不该被统计\n',
  })
  t.after(() => rmSync(dir, { recursive: true, force: true }))

  const report = scan(dir)
  assert.equal(report.total, 3)
  assert.deepEqual(report.files.map((file) => file.path), ['SKILL.md', 'references/a.md'])

  const skill = report.files[0]
  assert.equal(skill.count, 2)
  assert.deepEqual(skill.lines, [
    { line: 2, text: 'UNVERIFIED 第一条' },
    { line: 3, text: '中文 UNVERIFIED 两处 UNVERIFIED' },
  ])

  assert.equal(report.files[1].count, 1)
  assert.deepEqual(report.files[1].lines, [{ line: 2, text: 'UNVERIFIED 一条' }])
})

test('--json 输出 { total, files: [{ path, count, lines }] } 形状', (t) => {
  const dir = makeFixture({
    'b.md': 'UNVERIFIED b\n',
    'a/nested.md': 'x\nUNVERIFIED a\n',
  })
  t.after(() => rmSync(dir, { recursive: true, force: true }))

  const out = capture()
  const code = main(['--json', '--dir', dir], out)
  assert.equal(code, 0)

  const parsed = JSON.parse(out.output)
  assert.deepEqual(Object.keys(parsed).sort(), ['files', 'total'])
  assert.equal(parsed.total, 2)
  assert.equal(parsed.files.length, 2)
  assert.deepEqual(parsed.files.map((file) => file.path), ['a/nested.md', 'b.md'])
  for (const file of parsed.files) {
    assert.deepEqual(Object.keys(file).sort(), ['count', 'lines', 'path'])
    assert.equal(typeof file.path, 'string')
    assert.equal(file.count, file.lines.length)
    for (const entry of file.lines) {
      assert.deepEqual(Object.keys(entry).sort(), ['line', 'text'])
      assert.equal(Number.isInteger(entry.line), true)
      assert.equal(typeof entry.text, 'string')
    }
  }
})

test('空目录：total 0、files 空、退出码 0', (t) => {
  const dir = makeFixture({})
  t.after(() => rmSync(dir, { recursive: true, force: true }))

  assert.deepEqual(scan(dir), { total: 0, files: [] })

  const out = capture()
  assert.equal(main(['--dir', dir], out), 0)
  assert.equal(out.output, 'UNVERIFIED 标记：0 行，0 个文件\n')
})

test('默认（有标记时）仍退出 0，并打印每文件计数与总数', (t) => {
  const dir = makeFixture({ 'a.md': 'UNVERIFIED\nUNVERIFIED\n', 'b/c.md': 'UNVERIFIED\n' })
  t.after(() => rmSync(dir, { recursive: true, force: true }))

  const out = capture()
  assert.equal(main(['--dir', dir], out), 0)
  assert.match(out.output, /UNVERIFIED 标记：3 行，2 个文件/)
  assert.match(out.output, /a\.md: 2/)
  assert.match(out.output, /b\/c\.md: 1/)
})

test('--max 超阈值退出 1，等于阈值退出 0，非法值退出 2', (t) => {
  const dir = makeFixture({ 'a.md': 'UNVERIFIED\nUNVERIFIED\n' })
  t.after(() => rmSync(dir, { recursive: true, force: true }))

  const over = capture()
  assert.equal(main(['--dir', dir, '--max', '1'], over), 1)
  assert.match(over.output, /超过上限 1/)

  const equal = capture()
  assert.equal(main(['--dir', dir, '--max', '2'], equal), 0)

  const bad = capture()
  assert.equal(main(['--dir', dir, '--max', 'two'], bad), 2)
})

test('--help 退出 0；未知参数或缺 --dir 值退出 2', () => {
  const help = capture()
  assert.equal(main(['--help'], help), 0)
  assert.match(help.output, /report-unverified/)

  const unknown = capture()
  assert.equal(main(['--nope'], unknown), 2)

  const missing = capture()
  assert.equal(main(['--dir'], missing), 2)

  const absent = capture()
  assert.equal(main(['--dir', join(tmpdir(), 'report-unverified-不存在的目录')], absent), 2)
})

test('默认扫描根含 minecraft-porting 的标记', () => {
  const report = scan(DEFAULT_DIR)
  assert.ok(report.total > 0)
  assert.ok(report.files.some((file) => file.path.includes('minecraft-porting/')))
  for (const file of report.files) assert.ok(file.path.startsWith('assets/skills/'))
})
