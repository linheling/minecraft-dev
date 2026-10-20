#!/usr/bin/env node
// Line coverage for the plugin modules, computed from V8's raw coverage data.
//
// Why not `node --experimental-test-coverage`? On Node 24.21 the test runner's
// built-in reporter prints an empty table (zero files) in this environment,
// which makes the number meaningless. NODE_V8_COVERAGE still records real data,
// so we run the test suite with it and fold the per-process JSON ourselves.

import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const minLines = Number(process.env.COVERAGE_MIN_LINES ?? 80)

// Modules that ship and carry logic worth measuring. Tests, scripts and the
// preset/asset trees (YAML/JS rows rendered by the harness) are out of scope.
const inScope = [/^lib\//, /^(skills|codex|tools|preset)\.js$/]

const covDir = mkdtempSync(path.join(tmpdir(), 'mcdev-coverage-'))
const cleanup = () => rmSync(covDir, { recursive: true, force: true })

const child = spawnSync(process.execPath, ['--test', 'test/*.test.js'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, NODE_V8_COVERAGE: covDir },
})
if (child.status !== 0) {
  cleanup()
  process.exit(child.status ?? 1)
}

/** @type {Map<string, Array<{start:number,end:number,count:number}>>} */
const rangesByFile = new Map()
for (const name of readdirSync(covDir)) {
  if (!name.endsWith('.json')) continue
  const report = JSON.parse(readFileSync(path.join(covDir, name), 'utf8'))
  for (const script of report.result ?? []) {
    if (!script.url?.startsWith('file://')) continue
    const abs = fileURLToPath(script.url)
    const rel = path.relative(root, abs).split(path.sep).join('/')
    if (rel.startsWith('..') || path.isAbsolute(rel)) continue
    if (!inScope.some((re) => re.test(rel))) continue
    const acc = rangesByFile.get(rel) ?? []
    for (const fn of script.functions ?? []) {
      for (const range of fn.ranges ?? []) {
        acc.push({ start: range.startOffset, end: range.endOffset, count: range.count })
      }
    }
    rangesByFile.set(rel, acc)
  }
}
cleanup()

/**
 * Innermost range wins: V8 emits nested ranges, so an outer (executed) range
 * covering a whole function must not mark its unexecuted branches as covered.
 */
function coveredAt(ranges, offset) {
  let best = null
  for (const range of ranges) {
    if (offset < range.start || offset >= range.end) continue
    if (!best || range.end - range.start < best.end - best.start) best = range
  }
  return best ? best.count > 0 : false
}

const rows = []
let totalLines = 0
let totalCovered = 0
for (const rel of [...rangesByFile.keys()].sort()) {
  const text = readFileSync(path.join(root, rel), 'utf8')
  const lineStarts = [0]
  for (let i = 0; i < text.length; i += 1) if (text[i] === '\n') lineStarts.push(i + 1)
  const ranges = rangesByFile.get(rel)
  let fileLines = 0
  let fileCovered = 0
  const uncovered = []
  lineStarts.forEach((start, index) => {
    const end = index + 1 < lineStarts.length ? lineStarts[index + 1] - 1 : text.length
    const line = text.slice(start, end).trim()
    if (line === '') return
    fileLines += 1
    totalLines += 1
    const first = start + text.slice(start, end).length - text.slice(start, end).trimStart().length
    if (coveredAt(ranges, first)) {
      fileCovered += 1
      totalCovered += 1
    } else {
      uncovered.push(index + 1)
    }
  })
  rows.push({ rel, covered: fileCovered, lines: fileLines, uncovered })
}

if (rows.length === 0) {
  console.error('coverage: no V8 data for the plugin modules — did the suite load them?')
  process.exit(1)
}

const pct = (a, b) => (b === 0 ? 100 : (a / b) * 100)
const pad = (value, width) => String(value).padStart(width)
const compress = (lines) => {
  const out = []
  for (let i = 0; i < lines.length; i += 1) {
    let j = i
    while (j + 1 < lines.length && lines[j + 1] === lines[j] + 1) j += 1
    out.push(j > i ? `${lines[i]}-${lines[j]}` : String(lines[i]))
    i = j
  }
  return out.slice(0, 6).join(', ') + (out.length > 6 ? ', …' : '')
}

console.log('')
console.log('file'.padEnd(34) + pad('line %', 9) + '  uncovered lines')
console.log('-'.repeat(78))
for (const row of rows) {
  console.log(row.rel.padEnd(34) + pad(pct(row.covered, row.lines).toFixed(2), 9) + '  ' + compress(row.uncovered))
}
console.log('-'.repeat(78))
const total = pct(totalCovered, totalLines)
console.log('total'.padEnd(34) + pad(total.toFixed(2), 9) + `  (threshold ${minLines}%)`)
console.log('')
if (total < minLines) {
  console.error(`coverage: ${total.toFixed(2)}% of lines is below the ${minLines}% threshold`)
  process.exit(1)
}
