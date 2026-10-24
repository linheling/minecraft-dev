import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateStateDoc } from '../scripts/check-state.mjs'

/**
 * docs/STATE.md is the record of which version lines were actually built or run.
 * The gate that keeps it honest must itself be tested: cover the pass case, then
 * every drift mode (missing row, duplicate, wrong metadata, bad date, future
 * date, empty evidence) with a mutated copy of the real document.
 */
const root = fileURLToPath(new URL('..', import.meta.url))

/** Index of the row for (platform, line) inside a mutable line array. */
function rowLine(lines, platform, line) {
  return lines.findIndex((row) => row.startsWith(`| ${platform} | ${line} |`))
}

/** Read the committed state document as a line array. */
async function stateLines() {
  return (await readFile(path.join(root, 'docs', 'STATE.md'), 'utf8')).split(/\r?\n/)
}

test('the committed docs/STATE.md covers every PLATFORM_LINES entry', async () => {
  const markdown = (await stateLines()).join('\n')
  const { problems, rows, expectedCount } = await validateStateDoc({ root })
  assert.deepEqual(problems, [])
  assert.equal(rows.length, expectedCount)
  assert.equal(expectedCount, 19)
  assert.ok(rows.filter((row) => row.lastVerified !== '未验证').length >= 2, 'at least the real-build rows are dated')
  assert.ok(markdown.includes('npm run check:state'), 'the document should document its own gate')
})

test('a missing version line is reported by name', async () => {
  const lines = await stateLines()
  const index = rowLine(lines, 'fabric', '1.21')
  assert.ok(index > 0)
  lines.splice(index, 1)
  const { problems } = await validateStateDoc({ root, markdown: lines.join('\n') })
  assert.ok(problems.some((problem) => problem.includes('missing row for fabric/1.21')), problems.join('\n'))
})

test('metadata drift against versions.js is reported field by field', async () => {
  const lines = await stateLines()
  const index = rowLine(lines, 'paper', '1.21')
  assert.ok(index > 0)
  lines[index] = lines[index].replace('| 21 |', '| 17 |')
  const { problems } = await validateStateDoc({ root, markdown: lines.join('\n') })
  assert.ok(problems.some((problem) => problem.includes('paper/1.21 javaVersion')), problems.join('\n'))
})

test('duplicate rows, unknown lines, bad dates and empty evidence are all rejected', async () => {
  const lines = await stateLines()

  // Duplicate the first data row while keeping the metadata identical.
  const first = rowLine(lines, 'paper', '1.20')
  assert.ok(first > 0)
  lines.splice(first + 1, 0, lines[first])

  // An unknown (platform, line) pair.
  const unknown = rowLine(lines, 'forge', '1.16')
  assert.ok(unknown > 0)
  lines[unknown] = lines[unknown].replace('| forge | 1.16 |', '| forge | 1.15 |')

  // A malformed date and an empty evidence cell.
  const badDate = rowLine(lines, 'spigot', '1.12')
  assert.ok(badDate > 0)
  lines[badDate] = lines[badDate].replace('| 未验证 |', '| 2026-13-40 |')
  const noEvidence = rowLine(lines, 'fabric', '26')
  assert.ok(noEvidence > 0)
  lines[noEvidence] = lines[noEvidence].replace('| 模板生成与坐标；无构建记录 |', '|  |')

  const { problems } = await validateStateDoc({ root, markdown: lines.join('\n') })
  const joined = problems.join('\n')
  assert.match(joined, /duplicate row for paper\/1\.20/)
  assert.match(joined, /forge\/1\.15 is not a PLATFORM_LINES entry/)
  assert.match(joined, /spigot\/1\.12 lastVerified "2026-13-40"/)
  assert.match(joined, /fabric\/26 evidence cell is empty/)
})

test('a future date is rejected', async () => {
  const lines = await stateLines()
  const index = rowLine(lines, 'fabric', '26.3')
  assert.ok(index > 0)
  lines[index] = lines[index].replace('| 2026-09 |', '| 2099-01-01 |')
  const { problems } = await validateStateDoc({
    root,
    markdown: lines.join('\n'),
    now: new Date('2026-10-25T00:00:00Z'),
  })
  assert.ok(problems.some((problem) => problem.includes('is in the future')), problems.join('\n'))
})
