import test from 'node:test'
import assert from 'node:assert/strict'

import { checkVersions, main } from '../scripts/check-versions.mjs'

const FORGE_URL = 'https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml'
const FABRIC_LOADER_URL = 'https://meta.fabricmc.net/v2/versions/loader'
const FABRIC_API_URL = 'https://maven.fabricmc.net/net/fabricmc/fabric-api/fabric-api/maven-metadata.xml'
const FABRIC_LOOM_URL = 'https://maven.fabricmc.net/net/fabricmc/fabric-loom/maven-metadata.xml'
const PAPER_API_URL = 'https://repo.papermc.io/repository/maven-public/io/papermc/paper/paper-api/maven-metadata.xml'
const SPIGOT_1122_URL = 'https://hub.spigotmc.org/nexus/content/repositories/snapshots/org/spigotmc/spigot-api/1.12.2-R0.1-SNAPSHOT/maven-metadata.xml'

const NOW = () => new Date('2026-10-21T00:00:00.000Z')

function maven(versions) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<metadata>
  <versioning>
    <versions>
${versions.map((version) => `      <version>${version}</version>`).join('\n')}
    </versions>
  </versioning>
</metadata>`
}

function loaderMetadata(entries) {
  return JSON.stringify(entries.map(([version, stable]) => ({ version, stable })))
}

/** 简单 fetch fixture：字符串=200 响应体；Error=网络失败；{status,body}=指定状态。 */
function makeFetch(routes, calls = []) {
  return async (url) => {
    calls.push(url)
    const route = routes[url]
    if (route instanceof Error) throw route
    if (route === undefined) return { status: 404, async text() { return '' } }
    if (typeof route === 'string') return { status: 200, async text() { return route } }
    return { status: route.status ?? 200, async text() { return route.body ?? '' } }
  }
}

const FORGE_PINNED = [
  '1.7.10-10.13.4.1614-1.7.10',
  '1.12.2-14.23.5.2860',
  '1.16.5-36.2.39',
  '1.20.1-47.3.0',
]

const FORGE_NEWER = [
  '1.7.10-10.13.4.1614-1.7.10',
  '1.12.2-14.23.5.2860',
  '1.12.2-14.23.5.2864',
  '1.16.5-36.2.39',
  '1.16.5-36.2.42',
  '1.20.1-47.3.0',
  '1.20.1-47.4.28',
  '1.20.1-47.4.9',
]

const FABRIC_API_PINNED = [
  '0.92.11+1.20.1',
  '0.141.6+1.21.11',
  '0.157.0+26.2',
  '0.161.0+26.3',
]

const LOOM_VERSIONS = ['1.17.19', '1.17.21', '1.19.2']

function fabricRoutes({ apiVersions = FABRIC_API_PINNED, loader } = {}) {
  return {
    [FABRIC_LOADER_URL]: loader ?? loaderMetadata([['0.19.3', true], ['0.19.5', true], ['0.20.1', false]]),
    [FABRIC_API_URL]: maven(apiVersions),
    [FABRIC_LOOM_URL]: maven(LOOM_VERSIONS),
  }
}

test('forge 全部与上游一致时无 drift，每个 host 只请求一次', async () => {
  const calls = []
  const fetchImpl = makeFetch({ [FORGE_URL]: maven(FORGE_PINNED) }, calls)
  const result = await checkVersions({ fetchImpl, platform: 'forge', now: NOW })

  assert.equal(result.generatedAt, '2026-10-21T00:00:00.000Z')
  assert.deepEqual(result.platforms, ['forge'])
  assert.equal(result.summary.checks, 4)
  assert.equal(result.summary.ok, 4)
  assert.equal(result.summary.drift, 0)
  assert.equal(result.summary.unreachable, 0)
  assert.deepEqual(result.drifts, [])
  assert.deepEqual(result.hosts, [{ host: 'maven.minecraftforge.net', status: 'ok', requests: 1, reason: null }])
  assert.equal(calls.length, 1)
  for (const check of result.checks) {
    assert.equal(check.status, 'ok')
    assert.equal(check.host, 'maven.minecraftforge.net')
    assert.equal(typeof check.mcVersion, 'string')
  }
})

test('forge 有更新时报告 drift，且按数值而非字典序取最新', async () => {
  const fetchImpl = makeFetch({ [FORGE_URL]: maven(FORGE_NEWER) })
  const result = await checkVersions({ fetchImpl, platform: 'forge', now: NOW })

  assert.equal(result.summary.drift, 3)
  assert.deepEqual(
    result.drifts.map((check) => `${check.line}|${check.pinned}|${check.upstream}`),
    [
      '1.12|14.23.5.2860|1.12.2-14.23.5.2864',
      '1.16|36.2.39|1.16.5-36.2.42',
      '1.20|47.3.0|1.20.1-47.4.28',
    ],
  )
  const oldest = result.checks.find((check) => check.line === '1.7')
  assert.equal(oldest.status, 'ok')
  assert.equal(oldest.upstream, '1.7.10-10.13.4.1614-1.7.10')
})

test('fabric：loader/api/loom 的 drift 全部命中，共享 metadata 只请求一次', async () => {
  const calls = []
  const fetchImpl = makeFetch(fabricRoutes({
    apiVersions: [
      ...FABRIC_API_PINNED,
      '0.92.12+1.20.1',
      '0.164.0+26.3',
    ],
  }), calls)
  const result = await checkVersions({ fetchImpl, platform: 'fabric', now: NOW })

  assert.equal(result.summary.checks, 12)
  assert.equal(result.summary.drift, 8)
  assert.equal(result.summary.ok, 4)
  assert.deepEqual(
    result.drifts.map((check) => `${check.line}|${check.field}|${check.pinned}|${check.upstream}`),
    [
      '1.20|loaderVersion|0.19.3|0.19.5',
      '1.20|fabricApiVersion|0.92.11+1.20.1|0.92.12+1.20.1',
      '1.20|loomVersion|1.17.19|1.17.21',
      '1.21|loaderVersion|0.19.3|0.19.5',
      '1.21|loomVersion|1.17.19|1.17.21',
      '26|loaderVersion|0.19.3|0.19.5',
      '26|loomVersion|1.17.19|1.17.21',
      '26.3|fabricApiVersion|0.161.0+26.3|0.164.0+26.3',
    ],
  )
  assert.equal(calls.length, 3, '三个 metadata 各请求一次（四条 line 复用缓存）')
  assert.equal(new Set(calls).size, 3)
  assert.equal(result.hosts.find((host) => host.host === 'maven.fabricmc.net').requests, 2)
  const loomCheck = result.checks.find((check) => check.platform === 'fabric' && check.line === '1.20' && check.field === 'loomVersion')
  assert.match(loomCheck.note, /上游 maven release 为 1\.19\.2/)
})

test('部分 host 不可达：该 host 计数 unreachable、只尝试一次，其它 host 结果不受影响', async () => {
  const calls = []
  const fetchImpl = makeFetch({
    [FABRIC_LOADER_URL]: new Error('connect ECONNREFUSED 127.0.0.1:443'),
    [FABRIC_API_URL]: maven(FABRIC_API_PINNED),
    [FABRIC_LOOM_URL]: maven(LOOM_VERSIONS),
  }, calls)
  const result = await checkVersions({ fetchImpl, platform: 'fabric', now: NOW })

  const metaHost = result.hosts.find((host) => host.host === 'meta.fabricmc.net')
  assert.equal(metaHost.status, 'unreachable')
  assert.equal(metaHost.requests, 1)
  assert.match(metaHost.reason, /ECONNREFUSED/)
  assert.equal(result.hosts.find((host) => host.host === 'maven.fabricmc.net').status, 'ok')
  assert.equal(result.summary.unreachable, 4)
  assert.equal(result.summary.drift, 3)
  assert.equal(result.summary.ok, 5)
  for (const check of result.checks.filter((entry) => entry.field === 'loaderVersion')) {
    assert.equal(check.status, 'unreachable')
    assert.match(check.reason, /ECONNREFUSED/)
  }
  assert.equal(calls.filter((url) => url === FABRIC_LOADER_URL).length, 1, '不可达 host 不再重试')
  assert.equal(calls.length, 3)
})

test('paper 1.x 与 26.x 范围版本按各自规则判定', async () => {
  const fetchImpl = makeFetch({
    [PAPER_API_URL]: maven([
      '1.20.5-R0.1-SNAPSHOT',
      '1.20.6-R0.1-SNAPSHOT',
      '1.21.8-R0.1-SNAPSHOT',
      '1.21.11-rc1-R0.1-SNAPSHOT',
      '1.21.11-R0.1-SNAPSHOT',
      '26.2.build.134-stable',
      '26.2.build.135-alpha',
      '26.3.build.207-stable',
    ]),
  })
  const result = await checkVersions({ fetchImpl, platform: 'paper', now: NOW })

  assert.deepEqual(
    result.checks.map((check) => `${check.line}|${check.pinned}|${check.status}|${check.upstream}`),
    [
      '1.20|1.20.6-R0.1-SNAPSHOT|ok|1.20.6-R0.1-SNAPSHOT',
      '1.21|1.21.8-R0.1-SNAPSHOT|drift|1.21.11-R0.1-SNAPSHOT',
      '26|26.2.build.+|ok|26.2.build.134-stable',
      '26.3|26.3.build.+|ok|26.3.build.207-stable',
    ],
  )
  assert.equal(result.summary.drift, 1)
})

test('spigot：1.12.2 探测到 SNAPSHOT metadata 即 ok，1.7.10 无公开 maven 记 unreachable', async () => {
  const fetchImpl = makeFetch({
    [SPIGOT_1122_URL]: '<?xml version="1.0"?><metadata><versioning><snapshot><timestamp>20180712.012057</timestamp><buildNumber>156</buildNumber></snapshot></versioning></metadata>',
  })
  const result = await checkVersions({ fetchImpl, platform: 'spigot', now: NOW })

  const pinnedLine = result.checks.find((check) => check.line === '1.12')
  assert.equal(pinnedLine.status, 'ok')
  assert.match(pinnedLine.upstream, /build 156/)
  const vendored = result.checks.find((check) => check.line === '1.7')
  assert.equal(vendored.status, 'unreachable')
  assert.match(vendored.reason, /vendored jar/)
  assert.equal(result.summary.drift, 0)
})

test('--strict 有 drift 退出 1，默认退出 0；不可达不算 drift', async () => {
  const driftFetch = makeFetch({ [FORGE_URL]: maven(FORGE_NEWER) })
  const out = []
  assert.equal(await main(['--platform', 'forge', '--strict'], { fetchImpl: driftFetch, now: NOW, stdout: (text) => out.push(text) }), 1)
  assert.equal(await main(['--platform', 'forge'], { fetchImpl: driftFetch, now: NOW, stdout: () => {} }), 0)

  let unreachableCalls = 0
  const downFetch = async () => {
    unreachableCalls += 1
    throw new Error('getaddrinfo ENOTFOUND maven.minecraftforge.net')
  }
  assert.equal(await main(['--platform', 'forge', '--strict'], { fetchImpl: downFetch, now: NOW, stdout: () => {} }), 0)
  assert.equal(unreachableCalls, 1, '同一 host 失败后本次运行不再请求')
})

test('人读表含表格头与 SUMMARY / DRIFT；--json 形状稳定', async () => {
  const table = []
  const tableCode = await main(['--platform', 'forge'], {
    fetchImpl: makeFetch({ [FORGE_URL]: maven(FORGE_NEWER) }),
    now: NOW,
    stdout: (text) => table.push(text),
  })
  assert.equal(tableCode, 0)
  const tableText = table.join('\n')
  assert.match(tableText, /PLATFORM\s+LINE\s+FIELD\s+PINNED\s+UPSTREAM\s+STATUS/)
  assert.match(tableText, /HOSTS/)
  assert.match(tableText, /SUMMARY\s+checks 4 · ok 1 · drift 3/)
  assert.match(tableText, /DRIFT \(3\):/)
  assert.match(tableText, /forge 1\.12 forgeVersion: 14\.23\.5\.2860 -> 1\.12\.2-14\.23\.5\.2864/)

  const json = []
  const jsonCode = await main(['--platform', 'forge', '--json'], {
    fetchImpl: makeFetch({ [FORGE_URL]: maven(FORGE_NEWER) }),
    now: NOW,
    stdout: (text) => json.push(text),
  })
  assert.equal(jsonCode, 0)
  const parsed = JSON.parse(json.join('\n'))
  assert.deepEqual(Object.keys(parsed).sort(), ['checks', 'drifts', 'generatedAt', 'hosts', 'platforms', 'summary'])
  assert.equal(parsed.generatedAt, '2026-10-21T00:00:00.000Z')
  assert.deepEqual(parsed.platforms, ['forge'])
  assert.equal(parsed.checks.length, 4)
  assert.equal(parsed.drifts.length, 3)
  assert.deepEqual(Object.keys(parsed.summary).sort(), ['checks', 'drift', 'hosts', 'ok', 'skipped', 'unreachable'])
  for (const check of parsed.checks) {
    assert.deepEqual(Object.keys(check).sort(), ['field', 'host', 'line', 'mcVersion', 'pinned', 'platform', 'status', 'upstream'])
    assert.ok(['ok', 'drift', 'unreachable', 'skipped'].includes(check.status))
    assert.equal(typeof check.pinned, 'string')
  }
  assert.equal(parsed.drifts[0].status, 'drift')
})

test('参数错误退出 2，未知平台不发起请求', async () => {
  const errors = []
  const stderr = (text) => errors.push(text)
  assert.equal(await main(['--platform', 'nope'], { stderr }), 2)
  assert.match(errors.join('\n'), /未知平台 "nope"/)
  assert.equal(await main(['--platform'], { stderr }), 2)
  assert.match(errors.join('\n'), /--platform 缺少参数值/)
  assert.equal(await main(['--bogus'], { stderr }), 2)
})
