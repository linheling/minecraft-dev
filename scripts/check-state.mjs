#!/usr/bin/env node
// docs/STATE.md 与 lib/versions.js 的一致性闸门。
//
// 背景：19 条 (平台 × 版本线) 的「到底哪条真跑过」长期只散落在代码注释与
// UNVERIFIED 标记里。docs/STATE.md 把验证状态收成一张表，本脚本保证这张表
// 不会在版本线增删后悄悄漏行/写错 Java 级别。只读，不发网络请求。
//
// 校验项：
//   1. 表必须不多不少覆盖 PLATFORM_LINES 的每一条 (平台 × 线)；
//   2. 默认 MC 版本 / Java 级别 / 模板目录与源码一致；
//   3. 「最近验证」是合法日期或 `未验证`，日期不在未来；
//   4. 证据列非空（写『未验证』也要给理由）。
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { PLATFORM_LINES } from '../lib/versions.js'

/** Repo root (this file lives in scripts/). */
export const ROOT = fileURLToPath(new URL('..', import.meta.url))
/** The document this gate protects. */
export const DOC_PATH = 'docs/STATE.md'
/** The literal a row uses when no real build/run evidence exists. */
export const UNVERIFIED = '未验证'
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])(-\d{2})?$/
const HEADER_FIRST_CELL = '平台'

/** Every (platform, line) the scaffold knows about, keyed `platform/line`. */
export function expectedLines() {
  const expected = new Map()
  for (const [platform, lines] of Object.entries(PLATFORM_LINES)) {
    for (const entry of lines) {
      expected.set(`${platform}/${entry.line}`, { platform, ...entry })
    }
  }
  return expected
}

/** Split one markdown table row into trimmed cells. */
function cells(row) {
  return row.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((cell) => cell.trim())
}

/**
 * Parse the state table out of the document. Rows are taken from the first
 * table whose header starts with `| 平台 |`; parsing stops at the first
 * non-table line so the maintenance notes below stay prose.
 * @param {string} markdown - docs/STATE.md contents.
 * @returns {Array<object>} rows with `lineNumber`, or [] when no table exists.
 */
export function parseStateDoc(markdown) {
  const lines = markdown.split(/\r?\n/)
  const rows = []
  const headerIndex = lines.findIndex((line) => line.startsWith('|') && line.includes(HEADER_FIRST_CELL) && line.includes('最近验证'))
  if (headerIndex < 0) return rows
  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (!line.trim().startsWith('|')) break
    if (/^\|[\s:-]+\|/.test(line.trim())) continue
    const values = cells(line)
    if (values.length < 7) continue
    const [platform, stateLine, defaultMcVersion, javaVersion, templateDir, lastVerified, ...noteParts] = values
    rows.push({
      lineNumber: index + 1,
      platform,
      line: stateLine,
      defaultMcVersion,
      javaVersion,
      templateDir,
      lastVerified,
      note: noteParts.join(' | '),
    })
  }
  return rows
}

/**
 * Validate a state document against PLATFORM_LINES.
 * @param {{ root?: string, markdown?: string, now?: Date }} [options]
 *   - root: repo root (defaults to this checkout).
 *   - markdown: use this text instead of reading DOC_PATH (test seam).
 *   - now: clock override for the future-date check.
 * @returns {Promise<{ problems: string[], rows: object[], expectedCount: number }>}
 */
export async function validateStateDoc(options = {}) {
  const root = options.root ?? ROOT
  const now = options.now ?? new Date()
  const markdown = options.markdown ?? await readFile(path.join(root, DOC_PATH), 'utf8')
  const expected = expectedLines()
  const problems = []
  const rows = parseStateDoc(markdown)
  if (rows.length === 0) {
    problems.push(`${DOC_PATH}: no state table found (expected a header starting with "| 平台 |")`)
    return { problems, rows, expectedCount: expected.size }
  }

  const seen = new Map()
  for (const row of rows) {
    const key = `${row.platform}/${row.line}`
    if (seen.has(key)) {
      problems.push(`line ${row.lineNumber}: duplicate row for ${key} (first at line ${seen.get(key)})`)
      continue
    }
    seen.set(key, row.lineNumber)
    const want = expected.get(key)
    if (!want) {
      problems.push(`line ${row.lineNumber}: ${key} is not a PLATFORM_LINES entry (unknown platform or line)`)
      continue
    }
    if (row.defaultMcVersion !== want.defaultMcVersion) {
      problems.push(`line ${row.lineNumber}: ${key} defaultMcVersion is "${row.defaultMcVersion}", versions.js says "${want.defaultMcVersion}"`)
    }
    if (Number(row.javaVersion) !== want.javaVersion) {
      problems.push(`line ${row.lineNumber}: ${key} javaVersion is "${row.javaVersion}", versions.js says ${want.javaVersion}`)
    }
    if (row.templateDir !== want.templateDir) {
      problems.push(`line ${row.lineNumber}: ${key} templateDir is "${row.templateDir}", versions.js says "${want.templateDir}"`)
    }
    if (row.lastVerified !== UNVERIFIED) {
      if (!DATE_RE.test(row.lastVerified)) {
        problems.push(`line ${row.lineNumber}: ${key} lastVerified "${row.lastVerified}" is neither YYYY-MM, YYYY-MM-DD nor ${UNVERIFIED}`)
      } else {
        const iso = row.lastVerified.length === 7 ? `${row.lastVerified}-01` : row.lastVerified
        const date = new Date(`${iso}T00:00:00Z`)
        if (Number.isNaN(date.getTime())) {
          problems.push(`line ${row.lineNumber}: ${key} lastVerified "${row.lastVerified}" is not a real date`)
        } else if (date.getTime() > now.getTime()) {
          problems.push(`line ${row.lineNumber}: ${key} lastVerified ${row.lastVerified} is in the future`)
        }
      }
    }
    if (row.note === '') {
      problems.push(`line ${row.lineNumber}: ${key} evidence cell is empty (state why it is ${UNVERIFIED} or where the record lives)`)
    }
  }

  for (const key of expected.keys()) {
    if (!seen.has(key)) problems.push(`missing row for ${key}`)
  }
  return { problems, rows, expectedCount: expected.size }
}

/** CLI entry: print the report and exit non-zero on drift. */
async function main() {
  try {
    const { problems, rows, expectedCount } = await validateStateDoc()
    if (problems.length > 0) {
      process.stderr.write(`✗ ${DOC_PATH}: ${problems.length} problem(s)\n`)
      for (const problem of problems) process.stderr.write(`  - ${problem}\n`)
      process.exit(1)
    }
    const verified = rows.filter((row) => row.lastVerified !== UNVERIFIED).length
    process.stdout.write(`✓ ${DOC_PATH}: ${rows.length}/${expectedCount} 条版本线，${verified} 条有日期记录，${rows.length - verified} 条未验证。\n`)
  } catch (error) {
    process.stderr.write(`✗ ${DOC_PATH}: ${error.message}\n`)
    process.exit(1)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
