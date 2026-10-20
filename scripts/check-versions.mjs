#!/usr/bin/env node
/**
 * 版本矩阵上游漂移巡检（只出报告，不做自动升级）。
 *
 * 数据来源是 `lib/versions.js` 的 `PLATFORM_LINES`（唯一事实源），本脚本不复制
 * 任何版本坐标：对每条 (platform, line) 把 pinned 坐标与上游 Maven / metadata
 * 的对应字段比对，输出人读表或 `--json` 结构化结果。
 *
 * 用法：
 *   node scripts/check-versions.mjs
 *   node scripts/check-versions.mjs --json
 *   node scripts/check-versions.mjs --strict          # 有 drift 时退出码 1
 *   node scripts/check-versions.mjs --platform fabric
 *
 * 退出码：默认 0（drift 也不失败）；`--strict` 且有 drift → 1；参数错误 → 2。
 * 上游不可达（网络错误 / 超时 / HTTP 非 2xx）标记为 `unreachable`，不算 drift。
 *
 * 可测试性：`checkVersions({ fetchImpl, now })` 与 `main(argv, { fetchImpl })`
 * 均支持注入，单测用 fixture，不联网。fetch 超时 10s/请求，每个 URL 只请求一次；
 * 同一 host 网络级失败后本次运行不再请求该 host（不重试风暴）。
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  PLATFORM_LINES,
  SUPPORTED_PLATFORMS,
  lineCoords,
  normalizeMcLine,
  paperApiVersion,
} from '../lib/versions.js'

const DEFAULT_TIMEOUT_MS = 10_000

const FABRIC_LOADER_URL = 'https://meta.fabricmc.net/v2/versions/loader'
const FABRIC_API_URL = 'https://maven.fabricmc.net/net/fabricmc/fabric-api/fabric-api/maven-metadata.xml'
const FABRIC_LOOM_URL = 'https://maven.fabricmc.net/net/fabricmc/fabric-loom/maven-metadata.xml'
const PAPER_API_URL = 'https://repo.papermc.io/repository/maven-public/io/papermc/paper/paper-api/maven-metadata.xml'
const NEOFORGE_URL = 'https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml'
const FORGE_URL = 'https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml'
const SPIGOT_SNAPSHOTS_URL = 'https://hub.spigotmc.org/nexus/content/repositories/snapshots'

const USAGE = `版本矩阵上游漂移巡检

用法: node scripts/check-versions.mjs [选项]

选项:
  --json               输出 JSON（默认输出人读表）
  --strict             有 drift 时退出码 1（默认退出码始终 0）
  --platform <name>    只巡检一个平台（${SUPPORTED_PLATFORMS.join(' / ')}）
  -h, --help           显示本帮助

上游不可达标记为 unreachable，不计入 drift。`

// ---------------- 版本工具 ----------------

/** 取字符串里第一段数字版本，如 '1.12.2-14.23.5.2864' -> [1,12,2] */
function numericParts(value) {
  const match = String(value).match(/\d+(?:\.\d+)*/)
  return match ? match[0].split('.').map(Number) : []
}

/** 数值比较两段版本（逐段补 0）；返回 <0 / 0 / >0 */
function compareVersions(a, b) {
  const pa = numericParts(a)
  const pb = numericParts(b)
  const length = Math.max(pa.length, pb.length)
  for (let i = 0; i < length; i++) {
    const delta = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (delta !== 0) return delta
  }
  return 0
}

/** 版本轨道：前两段数字，如 0.19.3 -> '0.19'、1.17.19 -> '1.17'、26.2.0.59 -> '26.2' */
function trackOf(value) {
  return numericParts(value).slice(0, 2).join('.')
}

const PRERELEASE_RE = /(?:^|[-._+])(?:alpha|beta|rc|pre|preview|prerelease|snapshot|dev)/i

/** 是否预发布版本（alpha/beta/rc/pre/SNAPSHOT 等） */
function isPrerelease(value) {
  return PRERELEASE_RE.test(String(value))
}

/** 在列表里取数值最大的版本；可按轨道过滤，默认跳过预发布 */
function pickLatest(versions, { track = null, includePrerelease = false } = {}) {
  let best = null
  for (const version of versions) {
    if (track !== null && trackOf(version) !== track) continue
    if (!includePrerelease && isPrerelease(version)) continue
    if (best === null || compareVersions(version, best) > 0) best = version
  }
  return best
}

function xmlVersions(xml) {
  return [...String(xml).matchAll(/<version>\s*([^<\s]+)\s*<\/version>/g)].map((match) => match[1])
}

function xmlTag(xml, tag) {
  const match = String(xml).match(new RegExp(`<${tag}>\\s*([^<]+?)\\s*</${tag}>`))
  return match ? match[1] : null
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Forge 版本归一化：'1.7.10-10.13.4.1614-1.7.10' -> '10.13.4.1614' */
function normalizeForgeVersion(mcVersion, value) {
  let normalized = String(value)
  const prefix = `${mcVersion}-`
  if (normalized.startsWith(prefix)) normalized = normalized.slice(prefix.length)
  if (normalized.endsWith(`-${mcVersion}`)) normalized = normalized.slice(0, -(mcVersion.length + 1))
  return normalized
}

function errMsg(error) {
  if (!error) return 'unknown error'
  if (error.name === 'AbortError' || error.name === 'TimeoutError') return 'timeout'
  const cause = error.cause && error.cause.code ? ` (${error.cause.code})` : ''
  return `${error.name || 'Error'}: ${error.message || String(error)}${cause}`
}

// ---------------- 上游取数 ----------------

/**
 * 建一次运行内的请求器：URL 级缓存 + host 级熔断。
 * - 每个 URL 至多请求一次（多个 line 共用同一 metadata）；
 * - 某 host 网络错误 / 超时 / 5xx 后标记 unreachable，后续 URL 直接返回跳过原因。
 */
function createRequester({ fetchImpl, timeoutMs }) {
  const hosts = new Map()
  const cache = new Map()

  function hostRecord(url) {
    const host = new URL(url).host
    let record = hosts.get(host)
    if (!record) {
      record = { host, status: 'ok', requests: 0, reason: null, down: false }
      hosts.set(host, record)
    }
    return record
  }

  async function request(url) {
    const record = hostRecord(url)
    if (cache.has(url)) return cache.get(url)
    if (record.down) {
      const skipped = {
        ok: false,
        reason: `host ${record.host} 本次运行已标记不可达（${record.reason}），跳过后续请求`,
        skippedHost: true,
      }
      cache.set(url, skipped)
      return skipped
    }

    record.requests += 1
    const controller = new AbortController()
    let timer = null
    let result
    try {
      const pending = Promise.resolve().then(() => fetchImpl(url, {
        signal: controller.signal,
        headers: { accept: 'application/xml, application/json, text/plain, */*' },
      }))
      pending.catch(() => {}) // 超时先返回时，避免请求稍后 reject 变成 unhandled
      const timeout = new Promise((resolve) => {
        timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs)
      })
      const response = await Promise.race([pending, timeout])
      if (!response || response.timedOut) {
        controller.abort()
        result = { ok: false, reason: `timeout after ${timeoutMs}ms` }
      } else {
        const httpStatus = Number(response.status)
        let body = ''
        try {
          body = await response.text()
        } catch {
          body = ''
        }
        if (httpStatus >= 200 && httpStatus < 300) {
          result = { ok: true, body, httpStatus }
        } else {
          result = { ok: false, reason: `HTTP ${httpStatus}`, httpStatus }
          if (httpStatus >= 500) {
            record.down = true
            record.reason = `HTTP ${httpStatus}`
          }
        }
      }
    } catch (error) {
      result = { ok: false, reason: errMsg(error) }
    } finally {
      if (timer !== null) clearTimeout(timer)
    }

    if (!result.ok && result.httpStatus === undefined) {
      record.down = true
      record.reason = result.reason
    }
    cache.set(url, result)
    return result
  }

  function hostList() {
    return [...hosts.values()].map((record) => ({
      host: record.host,
      status: record.down ? 'unreachable' : 'ok',
      requests: record.requests,
      reason: record.down ? record.reason : null,
    }))
  }

  return { request, hostList }
}

// ---------------- 各字段的比对规则 ----------------

function pickFabricLoader(body, pinned) {
  let entries
  try {
    entries = JSON.parse(body)
  } catch {
    return { error: 'Fabric loader metadata 不是合法 JSON' }
  }
  if (!Array.isArray(entries)) return { error: 'Fabric loader metadata 形状异常' }
  const stable = entries
    .filter((entry) => entry && entry.stable === true && typeof entry.version === 'string')
    .map((entry) => entry.version)
  const track = trackOf(pinned)
  const latest = pickLatest(stable, { track })
  if (!latest) return { error: `上游没有 ${track}.x 轨道的稳定 loader` }
  return { upstream: latest, drift: compareVersions(pinned, latest) !== 0 }
}

function pickFabricApi(body, mcVersion, pinned) {
  const suffix = `+${mcVersion}`
  const bases = xmlVersions(body)
    .filter((version) => version.endsWith(suffix))
    .map((version) => version.slice(0, -suffix.length))
  const latest = pickLatest(bases)
  if (!latest) return { error: `上游没有 ${mcVersion} 的 fabric-api` }
  const pinnedText = String(pinned)
  const pinnedVersion = pinnedText.endsWith(suffix) ? pinnedText.slice(0, -suffix.length) : pinnedText.split('+')[0]
  return { upstream: `${latest}${suffix}`, drift: compareVersions(pinnedVersion, latest) !== 0 }
}

function pickFabricLoom(body, pinned) {
  const versions = xmlVersions(body)
  const track = trackOf(pinned)
  const latest = pickLatest(versions, { track })
  if (!latest) return { error: `上游没有 ${track}.x 轨道的 stable loom` }
  const overall = pickLatest(versions)
  const note = overall && trackOf(overall) !== track
    ? `上游 maven release 为 ${overall}；1.18+ 需 Gradle JVM 25，矩阵刻意留在 ${track}.x 轨道`
    : undefined
  return { upstream: latest, drift: compareVersions(pinned, latest) !== 0, note }
}

function pickPaper(body, mcVersion) {
  const versions = xmlVersions(body)
  const major = Number(mcVersion.split('.')[0])
  const line = normalizeMcLine(mcVersion)

  if (major >= 26) {
    const prefix = `${line}.build.`
    const pattern = new RegExp(`^${escapeRegExp(prefix)}(\\d+)-(stable|beta|alpha)$`)
    const builds = versions
      .map((raw) => {
        const match = raw.match(pattern)
        return match ? { raw, build: Number(match[1]), channel: match[2] } : null
      })
      .filter(Boolean)
    if (builds.length === 0) return { error: `上游没有 ${prefix}* 的 build` }
    const stable = [...builds].filter((entry) => entry.channel === 'stable').sort((a, b) => b.build - a.build)
    const latestStable = stable[0]
    if (!latestStable) {
      const latest = [...builds].sort((a, b) => b.build - a.build)[0]
      return {
        upstream: latest.raw,
        status: 'drift',
        reason: `矩阵钉的是浮动范围 ${prefix}+，但上游只有预发布 build`,
      }
    }
    return {
      upstream: latestStable.raw,
      status: 'ok',
      note: `矩阵钉浮动范围 ${prefix}+；上游稳定 build 已到 ${latestStable.raw}`,
    }
  }

  const scope = mcVersion.split('.').slice(0, 2).join('.')
  const pattern = new RegExp(`^${escapeRegExp(scope)}(?:\\.(\\d+))?-R0\\.1-SNAPSHOT$`)
  const releases = versions
    .map((raw) => {
      const match = raw.match(pattern)
      return match ? { raw, patch: match[1] === undefined ? 0 : Number(match[1]) } : null
    })
    .filter(Boolean)
  if (releases.length === 0) return { error: `上游没有 ${scope}.x 的 paper-api` }
  const latest = [...releases].sort((a, b) => b.patch - a.patch)[0]
  const pinned = paperApiVersion(mcVersion)
  return { upstream: latest.raw, drift: compareVersions(pinned, latest.raw) !== 0 }
}

function pickForge(body, mcVersion, pinned) {
  const versions = xmlVersions(body)
  const candidates = []
  for (const raw of versions) {
    const normalized = normalizeForgeVersion(mcVersion, raw)
    if (normalized === raw) continue // 既非 `${mc}-` 前缀也非 `-${mc}` 后缀：别的 MC 版本
    if (numericParts(normalized).length === 0) continue
    if (isPrerelease(normalized)) continue
    candidates.push({ raw, normalized })
  }
  if (candidates.length === 0) return { error: `上游 Forge 没有 ${mcVersion} 的构建` }
  const latest = candidates.reduce((best, candidate) => (
    best === null || compareVersions(candidate.normalized, best.normalized) > 0 ? candidate : best
  ), null)
  const pinnedNormalized = normalizeForgeVersion(mcVersion, pinned)
  return { upstream: latest.raw, drift: compareVersions(pinnedNormalized, latest.normalized) !== 0 }
}

function pickNeoForge(body, pinned) {
  const versions = xmlVersions(body)
  const track = trackOf(pinned)
  const includePrerelease = isPrerelease(pinned)
  const latest = pickLatest(versions, { track, includePrerelease })
  if (!latest) return { error: `上游 NeoForge 没有 ${track}.x 的版本` }
  const drift = compareVersions(pinned, latest) !== 0
    || (includePrerelease && !isPrerelease(latest))
  return { upstream: latest, drift }
}

function pickSpigot(body) {
  const buildNumber = xmlTag(body, 'buildNumber')
  const timestamp = xmlTag(body, 'timestamp') || xmlTag(body, 'lastUpdated')
  const detail = [buildNumber ? `build ${buildNumber}` : null, timestamp ? `@${timestamp}` : null].filter(Boolean).join(' ')
  return {
    upstream: detail ? `SNAPSHOT ${detail}` : 'SNAPSHOT（metadata 可解析）',
    status: 'ok',
  }
}

// ---------------- 巡检主流程 ----------------

/**
 * 对版本矩阵做一次上游巡检。
 * @param {object} [options]
 * @param {Function} [options.fetchImpl] fetch 实现（单测注入 fixture）
 * @param {Function} [options.now] 时间源，默认 () => new Date()
 * @param {string|null} [options.platform] 只巡检一个平台
 * @param {number} [options.timeoutMs] 单请求超时，默认 10s
 * @returns {Promise<object>} { generatedAt, platforms, hosts, checks, drifts, summary }
 */
export async function checkVersions(options = {}) {
  const {
    fetchImpl = globalThis.fetch,
    now = () => new Date(),
    platform = null,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options

  if (platform !== null && !SUPPORTED_PLATFORMS.includes(platform)) {
    throw new Error(`未知平台 ${JSON.stringify(platform)}；支持: ${SUPPORTED_PLATFORMS.join(', ')}`)
  }
  const platforms = platform === null ? [...SUPPORTED_PLATFORMS] : [platform]
  const requester = createRequester({ fetchImpl, timeoutMs })

  const baseRow = (p, entry, field, pinned, host) => ({
    platform: p,
    line: entry.line,
    mcVersion: entry.defaultMcVersion,
    field,
    pinned,
    host,
  })

  async function evalField({ platform: p, entry, field, pinned, url, host, pick, note, notFoundReason }) {
    const base = baseRow(p, entry, field, pinned, host)
    const response = await requester.request(url)
    if (!response.ok) {
      const reason = notFoundReason && response.httpStatus !== undefined
        ? `${response.reason} — ${notFoundReason}`
        : response.reason
      return { ...base, upstream: null, status: 'unreachable', reason }
    }
    let picked
    try {
      picked = pick(response.body)
    } catch (error) {
      picked = { error: errMsg(error) }
    }
    if (!picked || picked.error) {
      return { ...base, upstream: null, status: 'unreachable', reason: picked && picked.error ? picked.error : 'metadata 无法解析' }
    }
    const notes = [note, picked.note].filter(Boolean)
    return {
      ...base,
      upstream: picked.upstream ?? null,
      status: picked.status || (picked.drift ? 'drift' : 'ok'),
      ...(picked.reason ? { reason: picked.reason } : {}),
      ...(notes.length > 0 ? { note: notes.join('；') } : {}),
    }
  }

  async function paperRows(entry) {
    return [await evalField({
      platform: 'paper',
      entry,
      field: 'paperApi',
      pinned: paperApiVersion(entry.defaultMcVersion),
      url: PAPER_API_URL,
      host: 'repo.papermc.io',
      pick: (body) => pickPaper(body, entry.defaultMcVersion),
    })]
  }

  async function fabricRows(entry) {
    const coords = lineCoords('fabric', entry.defaultMcVersion)
    return [
      await evalField({
        platform: 'fabric',
        entry,
        field: 'loaderVersion',
        pinned: coords.loaderVersion,
        url: FABRIC_LOADER_URL,
        host: 'meta.fabricmc.net',
        pick: (body) => pickFabricLoader(body, coords.loaderVersion),
      }),
      await evalField({
        platform: 'fabric',
        entry,
        field: 'fabricApiVersion',
        pinned: coords.fabricApiVersion,
        url: FABRIC_API_URL,
        host: 'maven.fabricmc.net',
        pick: (body) => pickFabricApi(body, entry.defaultMcVersion, coords.fabricApiVersion),
      }),
      await evalField({
        platform: 'fabric',
        entry,
        field: 'loomVersion',
        pinned: coords.loomVersion,
        url: FABRIC_LOOM_URL,
        host: 'maven.fabricmc.net',
        pick: (body) => pickFabricLoom(body, coords.loomVersion),
      }),
    ]
  }

  async function forgeRows(p, entry) {
    const coords = lineCoords(p, entry.defaultMcVersion)
    return [await evalField({
      platform: p,
      entry,
      field: 'forgeVersion',
      pinned: coords.forgeVersion,
      url: FORGE_URL,
      host: 'maven.minecraftforge.net',
      pick: (body) => pickForge(body, entry.defaultMcVersion, coords.forgeVersion),
    })]
  }

  async function neoforgeRows(entry) {
    const coords = lineCoords('neoforge', entry.defaultMcVersion)
    if (typeof coords.neoVersion === 'string') {
      return [await evalField({
        platform: 'neoforge',
        entry,
        field: 'neoVersion',
        pinned: coords.neoVersion,
        url: NEOFORGE_URL,
        host: 'maven.neoforged.net',
        pick: (body) => pickNeoForge(body, coords.neoVersion),
      })]
    }
    // legacyforge（1.20.1）的 forgeVersion 走 Forge 坐标，不走 NeoForge maven。
    return [await evalField({
      platform: 'neoforge',
      entry,
      field: 'forgeVersion',
      pinned: coords.forgeVersion,
      url: FORGE_URL,
      host: 'maven.minecraftforge.net',
      note: 'legacyforge 走 Forge 坐标',
      pick: (body) => pickForge(body, entry.defaultMcVersion, coords.forgeVersion),
    })]
  }

  async function spigotRows(entry) {
    const coords = lineCoords('spigot', entry.defaultMcVersion)
    const coordinate = coords.spigotApi
    const artifactVersion = coordinate.slice(coordinate.lastIndexOf(':') + 1)
    const url = `${SPIGOT_SNAPSHOTS_URL}/org/spigotmc/spigot-api/${artifactVersion}/maven-metadata.xml`
    return [await evalField({
      platform: 'spigot',
      entry,
      field: 'spigotApi',
      pinned: coordinate,
      url,
      host: 'hub.spigotmc.org',
      pick: pickSpigot,
      notFoundReason: entry.defaultMcVersion === '1.7.10'
        ? '1.7.10 无公开 maven，模板使用 vendored jar（见 lib/versions.js 注释）'
        : undefined,
    })]
  }

  const builders = {
    paper: paperRows,
    fabric: fabricRows,
    forge: (entry) => forgeRows('forge', entry),
    neoforge: neoforgeRows,
    spigot: spigotRows,
  }

  const checks = []
  for (const p of platforms) {
    const buildRows = builders[p]
    if (!buildRows) throw new Error(`check-versions 未覆盖平台 ${JSON.stringify(p)}，请补充巡检规则`)
    for (const entry of PLATFORM_LINES[p]) {
      checks.push(...await buildRows(entry))
    }
  }

  const hosts = requester.hostList()
  const countBy = (status) => checks.filter((check) => check.status === status).length
  const drifts = checks.filter((check) => check.status === 'drift')
  const summary = {
    checks: checks.length,
    ok: countBy('ok'),
    drift: drifts.length,
    unreachable: countBy('unreachable'),
    skipped: countBy('skipped'),
    hosts: {
      total: hosts.length,
      ok: hosts.filter((host) => host.status === 'ok').length,
      unreachable: hosts.filter((host) => host.status === 'unreachable').length,
    },
  }

  return {
    generatedAt: new Date(now()).toISOString(),
    platforms,
    hosts,
    checks,
    drifts,
    summary,
  }
}

// ---------------- 输出 ----------------

function pad(value, width) {
  const text = String(value ?? '')
  return text.length >= width ? text : `${text}${' '.repeat(width - text.length)}`
}

/** 人读表：平台 / 线 / 字段 / pinned / upstream / 状态 */
export function formatReport(result) {
  const lines = []
  lines.push(`版本矩阵上游巡检  ${result.generatedAt}`)
  lines.push(`平台: ${result.platforms.join(', ')}`)

  const header = ['PLATFORM', 'LINE', 'FIELD', 'PINNED', 'UPSTREAM', 'STATUS']
  const rows = result.checks.map((check) => [
    check.platform,
    check.line,
    check.field,
    check.pinned,
    check.upstream ?? '-',
    check.status,
  ])
  const widths = header.map((title, index) => Math.max(
    title.length,
    ...rows.map((row) => String(row[index] ?? '').length),
  ))
  const render = (row) => row.map((cell, index) => pad(cell, widths[index])).join('  ')
  lines.push('')
  lines.push(render(header))
  lines.push(widths.map((width) => '-'.repeat(width)).join('  '))
  for (const row of rows) lines.push(render(row))

  lines.push('')
  lines.push('HOSTS')
  const hostWidth = Math.max('HOST'.length, ...result.hosts.map((host) => host.host.length))
  for (const host of result.hosts) {
    const suffix = host.reason ? ` — ${host.reason}` : ''
    lines.push(`  ${pad(host.host, hostWidth)}  ${pad(host.status, 11)} ${host.requests} request(s)${suffix}`)
  }

  const unreachable = result.checks.filter((check) => check.status === 'unreachable')
  if (unreachable.length > 0) {
    lines.push('')
    lines.push(`UNREACHABLE (${unreachable.length}):`)
    for (const check of unreachable) {
      lines.push(`  ${check.platform} ${check.line} ${check.field} @ ${check.host} — ${check.reason}`)
    }
  }

  const notes = result.checks.filter((check) => check.note)
  if (notes.length > 0) {
    lines.push('')
    lines.push('NOTES:')
    for (const check of notes) lines.push(`  ${check.platform} ${check.line} ${check.field}: ${check.note}`)
  }

  lines.push('')
  lines.push(`SUMMARY  checks ${result.summary.checks} · ok ${result.summary.ok} · drift ${result.summary.drift}`
    + ` · unreachable ${result.summary.unreachable} · skipped ${result.summary.skipped}`
    + ` · hosts ${result.summary.hosts.ok}/${result.summary.hosts.total} ok`)
  if (result.drifts.length > 0) {
    lines.push('')
    lines.push(`DRIFT (${result.drifts.length}):`)
    for (const check of result.drifts) {
      lines.push(`  ${check.platform} ${check.line} ${check.field}: ${check.pinned} -> ${check.upstream}`)
    }
  }
  return lines.join('\n')
}

// ---------------- CLI ----------------

function parseArgs(argv) {
  const options = { json: false, strict: false, platform: null, help: false }
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === '--json') options.json = true
    else if (arg === '--strict') options.strict = true
    else if (arg === '--help' || arg === '-h') options.help = true
    else if (arg === '--platform') {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) throw new Error('--platform 缺少参数值')
      options.platform = value
      index += 1
    } else if (arg.startsWith('--platform=')) {
      options.platform = arg.slice('--platform='.length)
      if (!options.platform) throw new Error('--platform 缺少参数值')
    } else {
      throw new Error(`未知参数: ${arg}`)
    }
  }
  return options
}

/**
 * CLI 入口，返回退出码（便于单测注入 stdout / fetchImpl）。
 * @param {string[]} [argv]
 * @param {object} [deps]
 */
export async function main(argv = process.argv.slice(2), deps = {}) {
  const {
    fetchImpl,
    now,
    stdout = (text) => process.stdout.write(`${text}\n`),
    stderr = (text) => process.stderr.write(`${text}\n`),
  } = deps

  let options
  try {
    options = parseArgs(argv)
  } catch (error) {
    stderr(`check-versions: ${error.message}\n\n${USAGE}`)
    return 2
  }
  if (options.help) {
    stdout(USAGE)
    return 0
  }
  if (options.platform !== null && !SUPPORTED_PLATFORMS.includes(options.platform)) {
    stderr(`check-versions: 未知平台 ${JSON.stringify(options.platform)}；支持: ${SUPPORTED_PLATFORMS.join(', ')}`)
    return 2
  }

  try {
    const result = await checkVersions({ fetchImpl, now, platform: options.platform })
    if (options.json) stdout(JSON.stringify(result, null, 2))
    else stdout(formatReport(result))
    if (options.strict && result.summary.drift > 0) return 1
    return 0
  } catch (error) {
    stderr(`check-versions 意外错误: ${error && error.stack ? error.stack : error}`)
    return 2
  }
}

// 直接运行时才执行（node --test / import 时不跑）
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => {
    process.exit(code)
  }).catch((error) => {
    console.error(`check-versions 意外错误: ${error && error.stack ? error.stack : error}`)
    process.exit(2)
  })
}
