#!/usr/bin/env node
// 干净环境可用的语法闸门：对仓库内所有 .js 跑 `node --check`。
// 背景：原来的 `npm run typecheck` 依赖 jsconfig.json 的绝对 paths 与本地
// TypeScript，换一台机器就不可用；语法检查只需要 node 本身。
import { spawnSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = path.resolve(import.meta.dirname, '..')
const SKIP_DIRS = new Set(['node_modules', '.git', '.dsh'])

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (entry.name.endsWith('.js')) out.push(full)
  }
  return out
}

const files = []
for (const entry of readdirSync(root, { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith('.js')) files.push(path.join(root, entry.name))
}
for (const dir of ['lib', 'test', 'scripts', 'preset']) files.push(...walk(path.join(root, dir)))

const failures = []
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' })
  if (result.status !== 0) {
    const message = (result.stderr || result.stdout || 'unknown error').trim().split('\n').slice(0, 6).join('\n')
    failures.push(`${path.relative(root, file)}\n${message}`)
  }
}

const checked = files.length
if (failures.length > 0) {
  console.error(`✗ ${failures.length}/${checked} file(s) failed node --check:\n`)
  for (const failure of failures) console.error(`${failure}\n`)
  process.exit(1)
}

console.log(`✓ node --check passed for ${checked} file(s).`)
