#!/usr/bin/env node
// report-unverified.mjs — 统计技能文档里的 UNVERIFIED 标记（v0.11 task-5）
//
// 只读扫描 assets/skills/**/*.md，按行统计包含 UNVERIFIED 的行：
//   默认：打印每文件计数与总数，退出码 0（有标记也不失败——这是待办清单，不是错误）。
//   --json：输出 { total, files: [{ path, count, lines: [{ line, text }] }] }。
// 路径：仓库内文件用相对仓库根的正斜杠路径；仓库外（测试临时目录）用相对扫描根目录的路径。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const DEFAULT_DIR = path.join(REPO_ROOT, 'assets', 'skills')
export const MARKER = 'UNVERIFIED'

export const USAGE = `report-unverified — 统计 assets/skills/**/*.md 中的 UNVERIFIED 标记

用法: node scripts/report-unverified.mjs [选项]

选项:
  --dir <path>  扫描根目录（默认 assets/skills/）
  --json        输出机器可读 JSON（stdout 仅 JSON）
  --help        显示本帮助

输出:
  默认按文件打印 UNVERIFIED 行数并给出总数；--json 输出
  { total, files: [{ path, count, lines: [{ line, text }] }] }。
  path 相对仓库根（仓库外目录则相对扫描根），line 从 1 开始，text 为整行去首尾空白。

退出码: 0 = 扫描完成（无论有无标记）; 2 = 参数错误或目录不可用`

function toPosix(p) {
  return p.split(path.sep).join('/')
}

/** 仓库内路径转相对仓库根；仓库外路径转相对扫描根。 */
function displayPath(file, scanRoot) {
  const fromRepo = path.relative(REPO_ROOT, file)
  if (fromRepo && !fromRepo.startsWith('..') && !path.isAbsolute(fromRepo)) return toPosix(fromRepo)
  return toPosix(path.relative(scanRoot, file))
}

function walk(dir, files) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, files)
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(full)
  }
}

/** 扫描 rootDir 下的 markdown，只返回含标记的文件（按 path 排序）。 */
export function scan(rootDir) {
  const markdown = []
  walk(rootDir, markdown)
  const files = []
  for (const file of markdown) {
    const text = fs.readFileSync(file, 'utf8')
    const lines = []
    for (const [index, line] of text.split(/\r?\n/).entries()) {
      if (line.includes(MARKER)) lines.push({ line: index + 1, text: line.trim() })
    }
    if (lines.length > 0) files.push({ path: displayPath(file, rootDir), count: lines.length, lines })
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return { total: files.reduce((sum, file) => sum + file.count, 0), files }
}

export function main(argv = [], opts = {}) {
  const stdout = opts.stdout || process.stdout
  const stderr = opts.stderr || process.stderr
  let dir = DEFAULT_DIR
  let json = false
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--json') json = true
    else if (arg === '--help' || arg === '-h') {
      stdout.write(`${USAGE}\n`)
      return 0
    } else if (arg === '--dir') {
      const value = argv[i + 1]
      i += 1
      if (!value) {
        stderr.write(`--dir 缺少路径\n${USAGE}\n`)
        return 2
      }
      dir = path.resolve(value)
    } else {
      stderr.write(`未知参数: ${arg}\n${USAGE}\n`)
      return 2
    }
  }
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    stderr.write(`目录不存在或不是目录: ${dir}\n`)
    return 2
  }

  const report = scan(dir)
  if (json) {
    stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    return 0
  }

  stdout.write(`UNVERIFIED 标记：${report.total} 行，${report.files.length} 个文件\n`)
  for (const file of report.files) stdout.write(`  ${file.path}: ${file.count}\n`)
  if (report.total > 0) {
    stdout.write('\n提示：标记是待办清单；查证后补证据，确证不了就写具体原因（见 assets/skills/minecraft-porting/SKILL.md 第 0 节）。\n')
  }
  return 0
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invoked) process.exitCode = main(process.argv.slice(2))
