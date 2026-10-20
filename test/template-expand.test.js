// 回归护栏：processResources 的 Gradle `expand` 会替换 `${key}`，
// 只要模板里用到某个 key 而展开源里没有它，第一次 `gradlew build` 就会抛
// MissingPropertyException（v0.10.1 的 forge-1.20.1 模板就是这毛病）。
// 这里静态对比「资源文件里用到的 ${key}」与「展开源里定义的 key」。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const templatesDir = path.join(root, 'assets', 'templates')

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

function readText(file) {
  const buf = readFileSync(file)
  if (buf.includes(0)) return null
  return buf.toString('utf8')
}

function propertyKeys(text) {
  const keys = new Set()
  for (const line of text.split('\n')) {
    if (/^\s*[#!]/.test(line)) continue
    const m = /^\s*([A-Za-z_][\w.]*)\s*=/.exec(line)
    if (m) keys.add(m[1])
  }
  return keys
}

// 从 `def replaceProperties = [ ... ]` 或 `expand 'k': v, 'k2': v` 里取 key。
function expandKeys(source) {
  const propMatch = /def\s+replaceProperties\s*=\s*\[([\s\S]*?)\n\]/.exec(source)
  if (propMatch) {
    const keys = new Set()
    for (const m of propMatch[1].matchAll(/([A-Za-z_]\w*)\s*:/g)) keys.add(m[1])
    return keys
  }
  const keys = new Set()
  for (const m of source.matchAll(/'([^']+)'\s*:/g)) keys.add(m[1])
  for (const m of source.matchAll(/"([^"]+)"\s*:/g)) keys.add(m[1])
  return keys
}

function targetFiles(templateDir, patterns) {
  const files = walk(templateDir).filter(file => !file.endsWith('build.gradle'))
  const resources = files.filter(file => file.includes(`${path.sep}src${path.sep}main${path.sep}resources${path.sep}`))
  const pool = resources.length ? resources : files
  if (!patterns.length) return pool
  return pool.filter(file => {
    const rel = path.relative(templateDir, file).split(path.sep).join('/')
    return patterns.some(pattern => rel.endsWith(pattern) || path.basename(rel) === pattern)
  })
}

test('模板里 expand 的 ${key} 都有定义（防 MissingPropertyException）', () => {
  const problems = []
  let checked = 0

  for (const entry of readdirSync(templatesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const templateDir = path.join(templatesDir, entry.name)
    const buildFile = path.join(templateDir, 'build.gradle')
    if (!existsSync(buildFile)) continue
    const source = readText(buildFile)
    const matchIndex = source.search(/\bfilesMatching\(|\bexpand\s/)
    if (matchIndex === -1) continue

    // filesMatching 的 pattern 与紧跟其后的 expand 表达式
    const patterns = []
    let expandExpr = ''
    const fm = /filesMatching\(\s*\[?([^\])]*?)\]?\s*\)?([\s\S]{0,300})/.exec(source)
    if (fm) {
      for (const m of fm[1].matchAll(/'([^']+)'/g)) patterns.push(m[1])
      const e = /\bexpand\s+([^\n}]+)/.exec(fm[2])
      if (e) expandExpr = e[1].trim()
    } else {
      const e = /\bexpand\s+([^\n}]+)/.exec(source)
      if (e) expandExpr = e[1].trim()
    }
    if (!expandExpr) continue

    let keys
    if (/^project\.properties\b/.test(expandExpr)) {
      const propsFile = path.join(templateDir, 'gradle.properties')
      if (!existsSync(propsFile)) continue
      keys = propertyKeys(readText(propsFile))
    } else if (/^replaceProperties\b/.test(expandExpr)) {
      keys = expandKeys(source)
    } else {
      keys = expandKeys(expandExpr)
    }
    if (!keys.size) continue

    checked += 1
    for (const file of targetFiles(templateDir, patterns)) {
      const text = readText(file)
      if (!text) continue
      for (const used of text.matchAll(/\$\{([A-Za-z_][\w.]*)\}/g)) {
        if (!keys.has(used[1])) {
          problems.push(
            `${path.relative(root, file)}: \${${used[1]}} 未在 ${entry.name}/build.gradle 的 expand 源里定义`,
          )
        }
      }
    }
  }

  assert.ok(checked >= 5, `模板解析覆盖数过少（${checked}），护栏可能失效`)
  assert.deepEqual(problems, [], '\n' + [...new Set(problems)].join('\n'))
})
