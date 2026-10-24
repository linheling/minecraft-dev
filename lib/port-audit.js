/**
 * Read-only migration audit for Minecraft mods and plugins.
 *
 * `auditProject` compares an existing project directory with the target line
 * resolved by `versions.js`. The implementation only reads files
 * (`readdir`/`readFile`/`stat`); it never writes, deletes or spawns processes,
 * so it is safe to run against a working tree.
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'

import { SUPPORTED_PLATFORMS, lineCoords, metadataFileFor, normalizeMcLine, resolveLine } from './versions.js'
import { toApiVersion } from './validate.js'

/**
 * @typedef {object} AuditFinding
 * @property {'blocker'|'warning'|'info'} severity
 * @property {string} code
 * @property {string} message
 * @property {string} [file]
 * @property {number} [line]
 * @property {string} [hint]
 */

/**
 * @typedef {object} MetadataRangeRecord
 * @property {string} file
 * @property {number} line
 * @property {string} field
 * @property {string|null} modId
 * @property {string} value
 * @property {string|null} targetValue
 * @property {boolean|null} satisfied
 * @property {string} [reason]
 */

/**
 * @typedef {object} MetadataAudit
 * @property {string[]} files
 * @property {MetadataRangeRecord[]} ranges
 * @property {MetadataRangeRecord|null} loaderVersion
 */

/**
 * @typedef {object} AuditContext
 * @property {string} projectDir
 * @property {string} platform
 * @property {string} minecraftVersion
 * @property {string} targetLine
 * @property {string} targetVersion
 * @property {number} javaVersion
 * @property {any} coords
 * @property {AuditFinding[]} findings
 * @property {Array<{ rel: string, text: string }>} buildScripts
 * @property {any} detected
 */

/** Minimum Gradle version for the Java level the target line requires. */
const MIN_GRADLE_BY_JAVA = new Map([
  [25, '9.1'],
  [24, '8.14'],
  [21, '8.5'],
  [17, '7.3'],
])

const WRAPPER_RELATIVE = 'gradle/wrapper/gradle-wrapper.properties'
const MODS_TOML_RELATIVE = 'src/main/resources/META-INF/mods.toml'
const NEOFORGE_MODS_TOML_RELATIVE = 'src/main/resources/META-INF/neoforge.mods.toml'
const PLUGIN_YML_RELATIVE = 'src/main/resources/plugin.yml'
const BUILD_SCRIPT_FILES = ['build.gradle', 'build.gradle.kts']
const SETTINGS_FILES = ['settings.gradle', 'settings.gradle.kts']

// One row per well-known break point an old tree is likely to contain. Every
// entry is a community-documented era break (Forge/NeoForge/Mojang changelogs
// and the porting guides); the exact signatures must be re-checked against the
// target version's javadoc before editing source. `since` is the first Minecraft
// line where the old identifier no longer resolves, so a row is only reported
// when the target line is at or above it.
/**
 * @type {Array<{ id: string, label: string, since: string,
 *   severity: 'blocker'|'warning'|'info', patterns: RegExp[], suggestion: string }>}
 */
const REMOVED_APIS = [
  {
    id: 'forge-game-registry',
    label: 'net.minecraftforge.fml.common.GameRegistry',
    since: '1.13',
    severity: 'blocker',
    patterns: [
      /\bnet\.minecraftforge\.fml\.common\.GameRegistry\b/,
      /\bGameRegistry\.(?:register|add|generate)\w*\b/,
    ],
    suggestion: 'register content through DeferredRegister on the mod event bus',
  },
  {
    id: 'forge-game-registry-registry',
    label: 'net.minecraftforge.fml.common.registry.GameRegistry',
    since: '1.13',
    severity: 'blocker',
    patterns: [/\bnet\.minecraftforge\.fml\.common\.registry\.GameRegistry\b/],
    suggestion: 'register content through DeferredRegister on the mod event bus',
  },
  {
    id: 'forge-fml-preinit',
    label: 'FMLPreInitializationEvent',
    since: '1.13',
    severity: 'blocker',
    patterns: [
      /\bnet\.minecraftforge\.fml\.common\.event\.FMLPreInitializationEvent\b/,
      /\bnew\s+FMLPreInitializationEvent\s*\(/,
    ],
    suggestion: 'move setup into the mod constructor or FMLCommonSetupEvent',
  },
  {
    id: 'forge-fml-init',
    label: 'FMLInitializationEvent',
    since: '1.13',
    severity: 'blocker',
    patterns: [
      /\bnet\.minecraftforge\.fml\.common\.event\.FMLInitializationEvent\b/,
      /\bnew\s+FMLInitializationEvent\s*\(/,
    ],
    suggestion: 'move setup into FMLCommonSetupEvent or a listener registration',
  },
  {
    id: 'legacy-cpw-fml',
    label: 'cpw.mods.fml.common.* (1.7.10-era loader package)',
    since: '1.8',
    severity: 'blocker',
    patterns: [/\bcpw\.mods\.fml\.common\./],
    suggestion: 'port to the net.minecraftforge.fml.* packages of the target line',
  },
  {
    id: 'forge-simple-network-wrapper',
    label: 'net.minecraftforge.fml.common.network.SimpleNetworkWrapper',
    since: '1.13',
    severity: 'blocker',
    patterns: [
      /\bnet\.minecraftforge\.fml\.common\.network\.SimpleNetworkWrapper\b/,
      /\bnew\s+SimpleNetworkWrapper\s*\(/,
    ],
    suggestion: 'use SimpleChannel with a registered protocol version',
  },
  {
    id: 'mojang-block-class',
    label: 'net.minecraft.block.Block',
    // Official mappings only moved Block to net.minecraft.world.level in 1.17.
    // Fabric/Yarn keeps net.minecraft.block.Block on every line, so the rule is
    // restricted to platforms that use Mojang mappings.
    since: '1.17',
    platforms: ['forge', 'neoforge', 'paper', 'spigot'],
    severity: 'blocker',
    patterns: [/\bnet\.minecraft\.block\.Block\b/],
    suggestion: 're-import Block from the target line (official mappings moved it to world.level)',
  },
  {
    id: 'mojang-item-class',
    label: 'net.minecraft.item.Item',
    since: '1.17',
    platforms: ['forge', 'neoforge', 'paper', 'spigot'],
    severity: 'blocker',
    patterns: [/\bnet\.minecraft\.item\.Item\b/],
    suggestion: 're-import Item from the target line (official mappings moved it to world.item)',
  },
  {
    id: 'old-nbt-compound',
    label: 'net.minecraft.nbt.NBTTagCompound',
    since: '1.20.5',
    severity: 'warning',
    patterns: [
      /\bnet\.minecraft\.nbt\.NBTTagCompound\b/,
      /\bnew\s+NBTTagCompound\s*\(/,
    ],
    suggestion: 'prefer DataComponents for ItemStack data; CompoundTag is the modern NBT type',
  },
  {
    id: 'yarn-class-names',
    label: 'net.minecraft.class_* (Yarn mappings)',
    since: '1.14',
    severity: 'warning',
    patterns: [/\bnet\.minecraft\.class_[A-Za-z0-9_]+\b/],
    suggestion: 'switch the project to official Mojang mappings and re-import the affected classes',
  },
]

const GRADLE_DISTRIBUTION_RE = /gradle-(\d+(?:\.\d+){1,2})/i
// `major` is 1 or 26 and `minor` is captured separately; `version` is the whole
// token. The old regex exposed the line as group 1 and the minor as group 2, so
// extractMcVersion read group 2 as major and group 3 (undefined) as minor.
const MC_VERSION_TOKEN_RE = /(?:^|[^0-9.])(?<version>(?<major>1|26)\.(?<minor>\d+)(?:\.(?<patch>\d+))?)(?![0-9.])/g
const DEPENDENCY_KEYWORD_RE = new RegExp(
  '\\b(?:compileOnly|compileOnlyApi|modCompileOnly|implementation|modImplementation' +
    '|modApi|runtimeOnly|api|minecraft|annotationProcessor)\\b',
)
const DEPENDENCY_COORDINATE_RE = /['"]([A-Za-z0-9_.-]+):([A-Za-z0-9_.-]+):([^'"\s)]+)['"]/g
// Only these coordinates carry a Minecraft version in their Maven version.
// `org.slf4j:slf4j-api:1.7.36` is the canonical counter-example: 1.7.36 is a
// valid-looking MC token but the library is not tied to a Minecraft line.
const MC_DEPENDENCY_RE = /minecraft|forge|fabric|paper|spigot|neoforge/i
const JAVA_TOOLCHAIN_PATTERN = /JavaLanguageVersion\.of\s*\(\s*(\d+)\s*\)/
const JAVA_SOURCE_PATTERN =
  /\bsourceCompatibility\s*=\s*(?:targetCompatibility\s*=\s*)?(?:JavaVersion\.VERSION_)?['"]?(?:1\.)?(\d+)['"]?/
const JAVA_TARGET_PATTERN =
  /\btargetCompatibility\s*=\s*(?:JavaVersion\.VERSION_)?['"]?(?:1\.)?(\d+)['"]?/
const JAVA_RELEASE_PATTERN =
  /\boptions\.release(?:\.set)?\s*\(?\s*(?:JavaVersion\.VERSION_)?['"]?(?:1\.)?(\d+)['"]?/
const JAVA_RELEASE_ARG_PATTERN = /--release['"]?\s*,?\s*['"]?(\d{1,2})\b/
const JAVA_LEVEL_PATTERNS = [
  { kind: 'toolchain', pattern: JAVA_TOOLCHAIN_PATTERN },
  { kind: 'sourceCompatibility', pattern: JAVA_SOURCE_PATTERN },
  { kind: 'targetCompatibility', pattern: JAVA_TARGET_PATTERN },
  { kind: 'release', pattern: JAVA_RELEASE_PATTERN },
  { kind: 'release', pattern: JAVA_RELEASE_ARG_PATTERN },
]

// JavaVersion.VERSION_1_8 means Java 8, not Java 1. The patterns above accept
// `JavaVersion.VERSION_(\d+)`, so rewrite the legacy constant before matching;
// otherwise the capture stops at "1" and 1.7.10/1.12.2 projects get a false
// JAVA_LEVEL_MISMATCH blocker.
const LEGACY_JAVA_VERSION_RE = /\bJavaVersion\.VERSION_1_(\d+)\b/g

/**
 * @param {string} line
 * @returns {string}
 */
function normalizeLegacyJavaVersion(line) {
  return line.replace(LEGACY_JAVA_VERSION_RE, 'JavaVersion.VERSION_$1')
}
const JAVA_PLUGIN_RE =
  /\bid\s*\(?\s*['"]java(?:-library)?['"]|\bapply\s+plugin\s*:\s*['"]java(?:-library)?['"]|\bjava\s*\{/
const SHADOW_PLUGIN_RE = /\bshadow\b/i
const NET_MINECRAFTFORGE_RE = /net\.minecraftforge\.gradle/
const ANATAWA12_FORGE_RE = /com\.anatawa12\.forge/
const APPLY_FORGE_RE = /\bapply\s+plugin\s*:\s*['"]forge['"]/
const NEOFORGE_MODDEV_RE = /net\.neoforged\.moddev/
const BUILD_PLUGIN_PATTERNS = [
  { id: 'net.minecraftforge.gradle', pattern: NET_MINECRAFTFORGE_RE },
  { id: 'com.anatawa12.forge', pattern: ANATAWA12_FORGE_RE },
  { id: 'net.neoforged.moddev', pattern: NEOFORGE_MODDEV_RE },
  { id: 'fabric-loom', pattern: /net\.fabricmc\.fabric-loom/ },
  { id: 'java', pattern: JAVA_PLUGIN_RE },
  { id: 'shadow', pattern: SHADOW_PLUGIN_RE },
  { id: 'forge', pattern: APPLY_FORGE_RE },
]
const SEVERITY_RANK = { blocker: 0, warning: 1, info: 2 }
const SEVERITIES = new Set(Object.keys(SEVERITY_RANK))

/**
 * Audit a project directory against one target platform line.
 *
 * @param {{ projectDir: string, platform: string, minecraftVersion: string }} options
 * @returns {Promise<object>} `{ ok, project, target, findings, summary }`
 * @throws {Error} when the directory is missing or not a directory, or when
 *   `platform` / `minecraftVersion` has no template in `versions.js`
 */
export async function auditProject(options) {
  if (options === null || typeof options !== 'object') {
    throw new Error('auditProject requires an options object: { projectDir, platform, minecraftVersion }')
  }

  const { projectDir, platform, minecraftVersion } = options
  if (typeof projectDir !== 'string' || projectDir.trim() === '') {
    throw new Error('auditProject requires options.projectDir to be a non-empty string')
  }
  if (typeof platform !== 'string' || platform.trim() === '') {
    throw new Error(`auditProject requires options.platform; supported: ${SUPPORTED_PLATFORMS.join(', ')}`)
  }
  if (typeof minecraftVersion !== 'string' || minecraftVersion.trim() === '') {
    throw new Error('auditProject requires options.minecraftVersion to be a non-empty string')
  }

  // Unknown platforms and versions throw the canonical errors from versions.js.
  const entry = resolveLine(platform, minecraftVersion)
  await assertProjectDirectory(projectDir)

  const context = {
    projectDir,
    platform,
    minecraftVersion,
    targetLine: entry.line,
    targetVersion: entry.defaultMcVersion,
    javaVersion: entry.javaVersion,
    coords: lineCoords(platform, minecraftVersion),
    findings: [],
    buildScripts: [],
    detected: {
      buildScripts: [],
      buildPlugins: [],
      gradleWrapper: null,
      gradleVersion: null,
      javaDeclarations: [],
      javaFileCount: 0,
      settingsFiles: [],
      foojay: false,
      metadata: null,
      pluginYml: null,
      pluginApiVersion: null,
      dependencies: [],
      removedApis: [],
    },
  }

  context.buildScripts = await readBuildScripts(projectDir)
  context.detected.buildScripts = context.buildScripts.map((script) => script.rel)

  await auditWrapper(context)
  auditJavaLevel(context)
  await auditFoojay(context)
  await auditModsMetadata(context)
  await auditPluginYml(context)
  auditBuildPlugin(context)
  await auditRemovedApis(context)
  auditDependencies(context)

  sortFindings(context.findings)
  const summary = { blockers: 0, warnings: 0, infos: 0 }
  for (const finding of context.findings) {
    if (finding.severity === 'blocker') summary.blockers += 1
    else if (finding.severity === 'warning') summary.warnings += 1
    else summary.infos += 1
  }

  return {
    ok: summary.blockers === 0,
    project: {
      dir: projectDir,
      platform,
      minecraftVersion,
      detected: context.detected,
    },
    target: {
      line: entry.line,
      javaVersion: entry.javaVersion,
      coords: context.coords,
    },
    findings: context.findings,
    summary,
  }
}

/**
 * Resolve the directory once so every later read can assume it exists.
 * @param {string} projectDir
 */
async function assertProjectDirectory(projectDir) {
  let info
  try {
    info = await stat(projectDir)
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(`project directory ${JSON.stringify(projectDir)} does not exist`)
    }
    throw new Error(`cannot read project directory ${JSON.stringify(projectDir)}: ${error.message}`)
  }
  if (!info.isDirectory()) {
    throw new Error(`project path ${JSON.stringify(projectDir)} is not a directory`)
  }
}

/**
 * Read the two Gradle build script spellings, ignoring absent files.
 * @param {string} projectDir
 * @returns {Promise<Array<{ rel: string, text: string }>>}
 */
async function readBuildScripts(projectDir) {
  const scripts = []
  for (const relative of BUILD_SCRIPT_FILES) {
    const text = await readTextFile(path.join(projectDir, relative))
    if (text !== null) scripts.push({ rel: relative, text })
  }
  return scripts
}

/**
 * Read a UTF-8 text file, mapping "not there" to null and other failures to a
 * clear Error. Only `readFile` is used, so this can never modify the project.
 * @param {string} absolutePath
 * @returns {Promise<string|null>}
 */
async function readTextFile(absolutePath) {
  try {
    return await readFile(absolutePath, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR' || error?.code === 'EISDIR') return null
    throw new Error(`cannot read ${absolutePath}: ${error.message}`)
  }
}

/**
 * Recursively list files under `relativeDir`, sorted by path for stable output.
 * Symlinks are ignored: the audit never follows them outside the project.
 * @param {string} rootDir
 * @param {string} relativeDir forward-slash path
 * @param {(name: string) => boolean} accept
 * @returns {Promise<Array<{ absolute: string, rel: string }>>}
 */
async function walkFiles(rootDir, relativeDir, accept) {
  const found = []

  /** @param {string} absoluteDir */
  async function visit(absoluteDir) {
    let entries
    try {
      entries = await readdir(absoluteDir, { withFileTypes: true })
    } catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return
      throw new Error(`cannot read directory ${absoluteDir}: ${error.message}`)
    }

    const sorted = [...entries].sort((left, right) => left.name.localeCompare(right.name))
    for (const dirent of sorted) {
      const absolute = path.join(absoluteDir, dirent.name)
      if (dirent.isDirectory()) {
        await visit(absolute)
      } else if (dirent.isFile() && accept(dirent.name)) {
        found.push({ absolute, rel: toPosixPath(path.relative(rootDir, absolute)) })
      }
    }
  }

  await visit(path.join(rootDir, ...relativeDir.split('/')))
  return found
}

/** @param {string} value */
function toPosixPath(value) {
  return value.split(path.sep).join('/')
}

/** @param {string} text */
function splitLines(text) {
  return String(text).replace(/^\uFEFF/, '').split(/\r?\n/)
}

/** @param {string} version */
function versionParts(version) {
  const match = String(version ?? '').match(/\d+(?:\.\d+)*/)
  if (!match) return null
  const parts = match[0].split('.').map(Number)
  return parts.every(Number.isFinite) ? parts : null
}

/**
 * Compare two dotted version strings numerically; missing parts count as zero.
 * @param {string} left
 * @param {string} right
 */
function compareVersions(left, right) {
  const leftParts = versionParts(left) ?? []
  const rightParts = versionParts(right) ?? []
  const length = Math.max(leftParts.length, rightParts.length)
  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index] ?? 0
    const rightPart = rightParts[index] ?? 0
    if (leftPart !== rightPart) return leftPart < rightPart ? -1 : 1
  }
  return 0
}

/**
 * Extract the first plausible Minecraft version embedded in a Maven coordinate
 * version (for example `1.21.8-R0.1-SNAPSHOT` or `0.92.11+1.20.1`). Returns
 * null for loader/framework versions such as `47.3.0` or `21.11.45`.
 * @param {string} value
 * @returns {string|null}
 */
function extractMcVersion(value) {
  if (!value) return null
  for (const match of String(value).matchAll(MC_VERSION_TOKEN_RE)) {
    const major = Number(match.groups.major)
    const minor = Number(match.groups.minor)
    if (major === 1 && (minor < 7 || minor > 21)) continue
    if (major === 26 && (minor < 1 || minor > 12)) continue
    return match.groups.version
  }
  return null
}

/**
 * @param {string} candidate
 * @param {string} targetLine
 */
function sameMcFamily(candidate, targetLine) {
  const line = normalizeMcLine(candidate)
  if (!line || !targetLine) return false
  if (line === targetLine) return true
  return line.startsWith(`${targetLine}.`) || targetLine.startsWith(`${line}.`)
}

/**
 * @param {number} javaVersion
 * @returns {string|null} lowest Gradle version, or null when unrestricted
 */
function minGradleForJava(javaVersion) {
  if (!Number.isFinite(javaVersion) || javaVersion <= 8) return null
  return MIN_GRADLE_BY_JAVA.get(javaVersion) ?? '9.1'
}

/**
 * @param {string} distributionUrl
 * @returns {string|null}
 */
function parseGradleVersion(distributionUrl) {
  const match = GRADLE_DISTRIBUTION_RE.exec(distributionUrl)
  return match ? match[1] : null
}

/**
 * Detect the Gradle wrapper pin and compare it with the Java level required by
 * the target line. A too-old wrapper cannot compile the project at all.
 * @param {AuditContext} context
 */
async function auditWrapper(context) {
  const absolute = path.join(context.projectDir, 'gradle', 'wrapper', 'gradle-wrapper.properties')
  const text = await readTextFile(absolute)
  if (text === null) {
    addFinding(context, {
      severity: 'warning',
      code: 'GRADLE_WRAPPER_MISSING',
      message:
        'gradle-wrapper.properties is missing, so the Gradle/JDK pairing for ' +
        `${context.platform} ${context.targetVersion} was not verified.`,
      file: WRAPPER_RELATIVE,
      hint:
        'Commit a wrapper that matches the target line (see the bundled template) ' +
        'instead of relying on a locally installed Gradle.',
    })
    return
  }

  context.detected.gradleWrapper = WRAPPER_RELATIVE
  const lines = splitLines(text)
  const urlIndex = lines.findIndex((line) => /^\s*distributionUrl\s*=/.test(line))
  const distributionUrl = urlIndex === -1 ? '' : lines[urlIndex].slice(lines[urlIndex].indexOf('=') + 1).trim()
  const gradleVersion = parseGradleVersion(distributionUrl)
  context.detected.gradleVersion = gradleVersion

  if (!gradleVersion) {
    addFinding(context, {
      severity: 'warning',
      code: 'GRADLE_VERSION_UNKNOWN',
      message:
        'could not parse a Gradle version from distributionUrl; ' +
        `the required minimum for Java ${context.javaVersion} was not checked.`,
      file: WRAPPER_RELATIVE,
      line: urlIndex === -1 ? undefined : urlIndex + 1,
      hint: 'Use a standard distributionUrl such as https://services.gradle.org/distributions/gradle-9.1-bin.zip.',
    })
    return
  }

  const minimum = minGradleForJava(context.javaVersion)
  if (minimum && compareVersions(gradleVersion, minimum) < 0) {
    addFinding(context, {
      severity: 'blocker',
      code: 'GRADLE_TOO_OLD',
      message:
        `Gradle ${gradleVersion} is below the minimum for Java ${context.javaVersion}; ` +
        `the ${context.platform} ${context.targetVersion} build needs Gradle ${minimum} or newer.`,
      file: WRAPPER_RELATIVE,
      line: urlIndex === -1 ? undefined : urlIndex + 1,
      hint: `Upgrade the wrapper (gradle wrapper --gradle-version ${minimum}) before touching Java code.`,
    })
  }
}

/**
 * Collect `JavaLanguageVersion.of(...)`, `sourceCompatibility`,
 * `targetCompatibility` and `options.release` declarations and compare them
 * with the target line's Java level.
 * @param {AuditContext} context
 */
function auditJavaLevel(context) {
  const declarations = []
  for (const script of context.buildScripts) {
    const lines = splitLines(script.text)
    for (let index = 0; index < lines.length; index += 1) {
      const normalizedLine = normalizeLegacyJavaVersion(lines[index])
      for (const { kind, pattern } of JAVA_LEVEL_PATTERNS) {
        const match = pattern.exec(normalizedLine)
        if (!match) continue
        declarations.push({ file: script.rel, line: index + 1, kind, level: Number(match[1]) })
      }
    }
  }
  context.detected.javaDeclarations = declarations

  const reported = new Set()
  for (const declaration of declarations) {
    if (!Number.isFinite(declaration.level) || declaration.level === context.javaVersion) continue
    const key = `${declaration.file}:${declaration.line}`
    if (reported.has(key)) continue
    reported.add(key)

    const lower = declaration.level < context.javaVersion
    addFinding(context, {
      severity: lower ? 'blocker' : 'warning',
      code: 'JAVA_LEVEL_MISMATCH',
      message: lower
        ? `Java ${declaration.level} is declared (${declaration.kind}) but ` +
          `the ${context.platform} ${context.targetVersion} target requires Java ${context.javaVersion}.`
        : `Java ${declaration.level} is declared (${declaration.kind}) but ` +
          `the ${context.platform} ${context.targetVersion} target only requires Java ${context.javaVersion}; ` +
          'newer bytecode can fail to load.',
      file: declaration.file,
      line: declaration.line,
      hint: `Set ${declaration.kind} to Java ${context.javaVersion} (a toolchain block is the usual fix).`,
    })
  }
}

/**
 * Modern lines rely on the foojay resolver to provision the JDK selected by the
 * Gradle toolchain.
 * @param {AuditContext} context
 */
async function auditFoojay(context) {
  if (!(context.javaVersion >= 17)) return

  let configuredIn = null
  for (const relative of SETTINGS_FILES) {
    const text = await readTextFile(path.join(context.projectDir, relative))
    if (text === null) continue
    context.detected.settingsFiles.push(relative)
    if (configuredIn === null && text.includes('foojay-resolver-convention')) configuredIn = relative
  }
  context.detected.foojay = configuredIn !== null

  if (configuredIn !== null) return
  addFinding(context, {
    severity: 'warning',
    code: 'FOOJAY_MISSING',
    message:
      'no foojay-resolver-convention plugin is configured, so Gradle cannot provision ' +
      `Java ${context.javaVersion} for ${context.platform} ${context.targetVersion}.`,
    // No settings file exists yet, so there is no real location to point at.
    ...(context.detected.settingsFiles[0] !== undefined
      ? { file: context.detected.settingsFiles[0] }
      : {}),
    hint: 'Add id("org.gradle.toolchains.foojay-resolver-convention") version "1.0.0" to settings.gradle(.kts).',
  })
}

/**
 * Parse the Forge/NeoForge metadata dependency ranges. `loaderVersion` values
 * are read as well; for Forge it must include the pinned Forge version, while
 * NeoForge's loaderVersion is an FML loader version and cannot be compared to
 * the NeoForge artifact version.
 * @param {AuditContext} context
 */
async function auditModsMetadata(context) {
  if (!usesModsToml(context.platform, context.targetLine)) return

  /** @type {MetadataAudit} */
  const metadata = { files: [], ranges: [], loaderVersion: null }
  context.detected.metadata = metadata

  /** @type {Array<{ rel: string, text: string }>} */
  const files = []
  for (const relative of [MODS_TOML_RELATIVE, NEOFORGE_MODS_TOML_RELATIVE]) {
    const text = await readTextFile(path.join(context.projectDir, ...relative.split('/')))
    if (text !== null) files.push({ rel: relative, text })
  }
  metadata.files = files.map((file) => file.rel)

  if (files.length === 0) {
    // Which toml the target line ships (mods.toml for Forge and legacyforge
    // NeoForge 1.20.1, neoforge.mods.toml from 1.20.5 on) comes from the same
    // template data scaffold uses — no separate version comparison here.
    const expected = metadataFileFor(context.platform, context.targetVersion) ?? 'mods.toml'
    addFinding(context, {
      severity: 'warning',
      code: 'METADATA_MISSING',
      message:
        'no mods.toml or neoforge.mods.toml is present under src/main/resources/META-INF; ' +
        `${context.platform} ${context.targetVersion} cannot validate the loader and dependency ranges.`,
      hint: `Create ${expected} for the target line (copy the bundled ${context.platform} template).`,
    })
    return
  }

  for (const file of files) {
    const parsed = parseModsToml(file.text)
    if (parsed.loaderVersion) {
      const loaderTarget = context.platform === 'forge' ? context.coords.forgeVersion ?? null : null
      metadata.loaderVersion = checkMetadataRange(context, {
        file: file.rel,
        line: parsed.loaderVersion.line,
        field: 'loaderVersion',
        modId: null,
        value: parsed.loaderVersion.value,
        targetValue: loaderTarget,
      })
    }
    for (const dependency of parsed.dependencies) {
      for (const range of dependency.ranges) {
        metadata.ranges.push(
          checkMetadataRange(context, {
            file: file.rel,
            line: range.line,
            field: 'versionRange',
            modId: dependency.modId,
            value: range.value,
            targetValue: metadataTargetValue(dependency.modId, context),
          }),
        )
      }
    }
  }
}

/**
 * Whether this platform/line is audited through a mods.toml-style metadata
 * file. Derived from the template data (versions.js), not a second hardcoded
 * line list: Forge 1.16+/NeoForge ship mods.toml/neoforge.mods.toml, while
 * Forge 1.7.10/1.12.2 ship mcmod.info and are not parsed here.
 * @param {string} platform
 * @param {string} line
 */
function usesModsToml(platform, line) {
  const metadata = metadataFileFor(platform, line)
  return typeof metadata === 'string' && metadata.endsWith('mods.toml')
}

/**
 * @param {AuditContext} context
 * @param {{ file: string, line: number, field: string, modId: string|null,
 *   value: string, targetValue: string|null }} details
 */
function checkMetadataRange(context, details) {
  /** @type {MetadataRangeRecord} */
  const record = {
    file: details.file,
    line: details.line,
    field: details.field,
    modId: details.modId,
    value: details.value,
    targetValue: details.targetValue,
    satisfied: null,
  }
  if (!details.targetValue) {
    record.reason = context.platform === 'neoforge' && details.field === 'loaderVersion'
      ? 'NeoForge loaderVersion is an FML loader version, not a comparable NeoForge version'
      : 'the target line does not pin a comparable version'
    return record
  }

  const range = parseVersionRange(details.value)
  if (!range) {
    record.reason = 'range could not be parsed'
    return record
  }

  const satisfied = satisfiesRange(details.targetValue, range)
  record.satisfied = satisfied
  if (!satisfied) {
    const label = details.field === 'loaderVersion' ? 'FML loader version' : metadataTargetLabel(details.modId)
    const targetLabel = details.field === 'loaderVersion' ? 'Forge' : metadataTargetLabel(details.modId)
    addFinding(context, {
      severity: 'blocker',
      code: 'METADATA_VERSION_RANGE',
      message:
        `${label} range "${details.value}" does not include ${targetLabel} ${details.targetValue}, ` +
        `required by the ${context.platform} ${context.targetLine} target.`,
      file: details.file,
      line: details.line,
      hint: 'Widen this range for the target line, or keep a per-version metadata file instead of one shared range.',
    })
  }
  return record
}

/**
 * @param {string|null} modId
 */
function metadataTargetLabel(modId) {
  const normalized = String(modId ?? '').trim().toLowerCase()
  if (normalized === 'minecraft') return 'Minecraft'
  if (normalized === 'forge') return 'Forge'
  if (normalized === 'neoforge') return 'NeoForge'
  return String(modId ?? 'dependency')
}

/**
 * @param {string|null} modId
 * @param {AuditContext} context
 * @returns {string|null}
 */
function metadataTargetValue(modId, context) {
  const normalized = String(modId ?? '').trim().toLowerCase()
  if (normalized === 'minecraft') return context.targetVersion
  if (normalized === 'forge' && context.platform === 'forge') return context.coords.forgeVersion ?? null
  if (normalized === 'neoforge' && context.platform === 'neoforge') return context.coords.neoVersion ?? null
  return null
}

/**
 * Minimal TOML reader for the loader/version range fields. Tracks each
 * `[[dependencies.*]]` block so `modId` may appear before or after
 * `versionRange`; CRLF is normalized by `splitLines`.
 * @param {string} text
 * @returns {{ loaderVersion: { value: string, line: number }|null,
 *   dependencies: Array<{ modId: string|null,
 *     ranges: Array<{ value: string, line: number }> }> }}
 */
function parseModsToml(text) {
  const lines = splitLines(text)
  /**
   * @type {{ loaderVersion: { value: string, line: number }|null,
   *   dependencies: Array<{ modId: string|null,
   *     ranges: Array<{ value: string, line: number }> }> }}
   */
  const result = { loaderVersion: null, dependencies: [] }
  /** @type {{ modId: string|null, ranges: Array<{ value: string, line: number }> }|null} */
  let current = null
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim()
    if (!line || line.startsWith('#')) continue
    if (line.startsWith('[[')) {
      current = line.startsWith('[[dependencies') ? { modId: null, ranges: [] } : null
      if (current) result.dependencies.push(current)
      continue
    }
    if (line.startsWith('[')) {
      current = null
      continue
    }
    if (!result.loaderVersion) {
      const loader = /\bloaderVersion\s*=\s*"([^"]*)"/.exec(line)
      if (loader) result.loaderVersion = { value: loader[1], line: index + 1 }
    }
    if (!current) continue
    const modId = /\bmodId\s*=\s*"([^"]*)"/.exec(line)
    if (modId) current.modId = modId[1]
    const range = /\bversionRange\s*=\s*"([^"]*)"/.exec(line)
    if (range) current.ranges.push({ value: range[1], line: index + 1 })
  }
  return result
}

/**
 * @param {unknown} value
 * @returns {{ kind: 'any'|'invalid' } | { kind: 'wildcard'|'numeric', parts: number[] }}
 */
function parseRangeBound(value) {
  const text = String(value ?? '').trim()
  if (text === '' || /^x(?:\.x)*$/i.test(text)) return { kind: 'any' }
  const wildcard = /^(\d+(?:\.\d+)*)\.(?:x|\*)$/i.exec(text)
  if (wildcard) return { kind: 'wildcard', parts: wildcard[1].split('.').map(Number) }
  if (!/^\d+(?:\.\d+)*$/.test(text)) return { kind: 'invalid' }
  return { kind: 'numeric', parts: text.split('.').map(Number) }
}

/**
 * Parse Maven/Forge version ranges such as `[1.20.1,1.21)`, `[47,)`,
 * `[1.20.1]`, `1.21.x`, `*` and the union form `[1.20,1.21),[1.21.4,)`.
 * @param {string} value
 * @returns {object|null}
 */
function parseVersionRange(value) {
  const text = String(value ?? '').trim()
  if (!text) return null

  const unionParts = [...text.matchAll(/[\[(][^\[\]()]*[\])]/g)].map((match) => match[0])
  if (unionParts.length > 1) {
    const alternatives = unionParts.map((part) => parseVersionRange(part))
    if (alternatives.some((alternative) => alternative === null)) return null
    return { alternatives }
  }

  const bracket = /^([[(])([^)\]]*)([)\]])$/.exec(text)
  if (bracket) {
    const bounds = bracket[2].split(',').map((part) => part.trim())
    if (bounds.length === 2) {
      const lower = parseRangeBound(bounds[0])
      const upper = parseRangeBound(bounds[1])
      if (lower.kind === 'invalid' || upper.kind === 'invalid') return null
      return {
        includeLower: bracket[1] === '[',
        lower,
        includeUpper: bracket[3] === ']',
        upper,
      }
    }
    if (bounds.length === 1) {
      const exact = parseRangeBound(bounds[0])
      if (exact.kind === 'invalid' || exact.kind === 'any') return null
      return { exact: exact.parts.join('.') }
    }
    return null
  }

  if (text === 'x' || text === '*') return { exact: 'any' }
  if (text.includes(',')) return null
  const bound = parseRangeBound(text)
  if (bound.kind === 'invalid') return null
  if (bound.kind === 'any') return { exact: 'any' }
  if (bound.kind === 'wildcard') {
    return {
      includeLower: true,
      includeUpper: false,
      lower: { kind: 'numeric', parts: bound.parts },
      upper: bound,
    }
  }
  return { exact: text }
}

/**
 * @param {string} version
 * @param {any} range
 * @returns {boolean|null}
 */
function satisfiesRange(version, range) {
  if (!version || !range) return null
  if (range.alternatives) {
    return range.alternatives.some((alternative) => satisfiesRange(version, alternative) === true)
  }
  if (range.exact === 'any') return true
  if (range.exact !== undefined) return compareVersions(version, range.exact) === 0

  if (range.lower && range.lower.kind !== 'any') {
    const lowerValue = range.lower.parts.join('.')
    const comparison = compareVersions(version, lowerValue)
    if (comparison < 0) return false
    if (comparison === 0 && !range.includeLower) return false
  }

  if (range.upper && range.upper.kind !== 'any') {
    if (range.upper.kind === 'wildcard') {
      const parts = [...range.upper.parts]
      parts[parts.length - 1] += 1
      if (compareVersions(version, parts.join('.')) >= 0) return false
    } else {
      const upperValue = range.upper.parts.join('.')
      const comparison = compareVersions(version, upperValue)
      if (comparison > 0) return false
      if (comparison === 0 && !range.includeUpper) return false
    }
  }
  return true
}

/**
 * `plugin.yml` only gained `api-version` in 1.13, so a missing field is expected
 * on 1.12.2 and older and a warning on modern Paper/Spigot lines.
 * @param {AuditContext} context
 */
async function auditPluginYml(context) {
  if (context.platform !== 'paper' && context.platform !== 'spigot') return

  const text = await readTextFile(path.join(context.projectDir, ...PLUGIN_YML_RELATIVE.split('/')))
  if (text === null) {
    addFinding(context, {
      severity: 'warning',
      code: 'PLUGIN_API_VERSION',
      message:
        'plugin.yml is missing; ' +
        `${context.platform} ${context.targetVersion} will not load the plugin without a name and main class.`,
      file: PLUGIN_YML_RELATIVE,
      hint: 'Create src/main/resources/plugin.yml (copy the bundled template).',
    })
    return
  }

  context.detected.pluginYml = PLUGIN_YML_RELATIVE
  const parsed = findYamlScalar(splitLines(text), 'api-version')
  const expected = toApiVersion(context.targetVersion)
  context.detected.pluginApiVersion = parsed ? unquoteYaml(parsed.value) : null

  if (parsed) {
    const actual = context.detected.pluginApiVersion
    if (actual && sameMcFamily(actual, context.targetLine)) return
    addFinding(context, {
      severity: 'warning',
      code: 'PLUGIN_API_VERSION',
      message:
        `plugin.yml declares api-version "${actual ?? ''}" but ` +
        `${context.platform} ${context.targetVersion} expects "${expected}" (or another ${context.targetLine}.x value).`,
      file: PLUGIN_YML_RELATIVE,
      line: parsed.line,
      hint: `Set api-version to "${expected}" and re-test on the target server.`,
    })
    return
  }

  if (compareVersions(context.targetVersion, '1.12.2') <= 0) {
    addFinding(context, {
      severity: 'info',
      code: 'PLUGIN_API_VERSION',
      message:
        `plugin.yml has no api-version; that is expected on Minecraft ${context.targetVersion} ` +
        'because the field only exists from 1.13 on.',
      file: PLUGIN_YML_RELATIVE,
      hint: 'Leave the field out on legacy servers; do not copy a modern value back to this line.',
    })
    return
  }

  addFinding(context, {
    severity: 'warning',
    code: 'PLUGIN_API_VERSION',
    message:
      `plugin.yml has no api-version; ${context.platform} ${context.targetVersion} needs ` +
      `api-version "${expected}" to select the server API.`,
    file: PLUGIN_YML_RELATIVE,
    hint: `Add api-version: "${expected}" below the main class.`,
  })
}

/**
 * @param {string[]} lines
 * @param {string} key
 * @returns {{ value: string, line: number }|null}
 */
function findYamlScalar(lines, key) {
  const pattern = new RegExp(`^\\s*${key}\\s*:\\s*(.*)$`)
  for (let index = 0; index < lines.length; index += 1) {
    const match = pattern.exec(lines[index])
    if (match) return { value: match[1].trim(), line: index + 1 }
  }
  return null
}

/** @param {string} value */
function unquoteYaml(value) {
  const trimmed = String(value ?? '').trim()
  const quoted =
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  return quoted ? trimmed.slice(1, -1) : trimmed
}

/**
 * The Gradle plugin that supplies the target platform's Minecraft dependency
 * must match the platform. Paper/Spigot only need a Java plugin (Shadow is an
 * acceptable alternative for bundling).
 * @param {AuditContext} context
 */
function auditBuildPlugin(context) {
  const scripts = context.buildScripts
  const combined = scripts.map((script) => script.text).join('\n')

  const present = new Set()
  for (const plugin of BUILD_PLUGIN_PATTERNS) {
    if (plugin.pattern.test(combined)) present.add(plugin.id)
  }
  context.detected.buildPlugins = [...present]

  const requirement = buildPluginRequirement(context.platform, context.targetLine)
  if (!requirement) return
  if (requirement.patterns.some((pattern) => pattern.test(combined))) return

  addFinding(context, {
    severity: 'blocker',
    code: 'BUILD_PLUGIN_MISMATCH',
    message:
      `the build does not apply ${requirement.label} required by ${context.platform} ${context.targetLine}; ` +
      'the target Minecraft dependency will not resolve.',
    file: scripts.length > 0 ? scripts[0].rel : undefined,
    hint: requirement.hint,
  })
}

/**
 * @param {string} platform
 * @param {string} line
 * @returns {{ label: string, patterns: RegExp[], hint: string }|null}
 */
function buildPluginRequirement(platform, line) {
  if (platform === 'forge') {
    if (line === '1.7') {
      return {
        label: "the 1.7.10 ForgeGradle fork ('com.anatawa12.forge') or the legacy 'forge' plugin",
        patterns: [ANATAWA12_FORGE_RE, APPLY_FORGE_RE, NET_MINECRAFTFORGE_RE],
        hint: "Apply the com.anatawa12.forge classpath plugin or `apply plugin: 'forge'` for this line.",
      }
    }
    if (line === '1.12') {
      return {
        label: "ForgeGradle ('net.minecraftforge.gradle' or the legacy 'forge' plugin)",
        patterns: [NET_MINECRAFTFORGE_RE, APPLY_FORGE_RE],
        hint: "Apply `net.minecraftforge.gradle` with the version pinned for the 1.12.2 template.",
      }
    }
    return {
      label: "the ForgeGradle plugin ('net.minecraftforge.gradle')",
      patterns: [NET_MINECRAFTFORGE_RE],
      hint: `Apply \`id 'net.minecraftforge.gradle'\` with the version pinned for the ${line} line.`,
    }
  }
  if (platform === 'neoforge') {
    return {
      label: "the NeoForge ModDevGradle plugin ('net.neoforged.moddev')",
      patterns: [NEOFORGE_MODDEV_RE],
      hint: `Apply \`id 'net.neoforged.moddev'\` (legacyforge on 1.20.1) with the version pinned for the ${line} line.`,
    }
  }
  if (platform === 'paper' || platform === 'spigot') {
    return {
      label: "a Java plugin ('java'/'java-library' or 'shadow')",
      patterns: [JAVA_PLUGIN_RE, SHADOW_PLUGIN_RE],
      hint: 'Apply `java` (or `java-library`) and `shadowJar` if dependencies need bundling.',
    }
  }
  return null
}

/**
 * Walk `src/main/java` for imports/usages of identifiers that broke between old
 * lines and the target line. Only the first hit per file and table row is
 * reported to keep the report readable.
 * @param {AuditContext} context
 */
async function auditRemovedApis(context) {
  const files = await walkFiles(context.projectDir, 'src/main/java', (name) => name.endsWith('.java'))
  context.detected.javaFileCount = files.length

  const reported = new Set()
  for (const file of files) {
    const text = await readTextFile(file.absolute)
    if (text === null) continue
    const lines = splitLines(text)
    for (const api of REMOVED_APIS) {
      if (api.platforms && !api.platforms.includes(context.platform)) continue
      if (compareVersions(context.targetVersion, api.since) < 0) continue
      const key = `${file.rel}|${api.id}`
      if (reported.has(key)) continue

      for (let index = 0; index < lines.length; index += 1) {
        if (!api.patterns.some((pattern) => pattern.test(lines[index]))) continue
        reported.add(key)
        context.detected.removedApis.push({
          file: file.rel,
          line: index + 1,
          identifier: api.label,
          since: api.since,
          severity: api.severity,
        })
        addFinding(context, {
          severity: api.severity,
          code: 'REMOVED_API',
          message: `${api.label} is not available from Minecraft ${api.since} onward; ${api.suggestion}.`,
          file: file.rel,
          line: index + 1,
          hint:
            'This row is a known break point; verify the exact replacement signature in the ' +
            `${context.platform} ${context.targetLine} javadoc.`,
        })
        break
      }
    }
  }
}

/**
 * Maven coordinates pinned to an old Minecraft line (for example a
 * `spigot-api:1.12.2` dependency in a 1.20 project) usually need a version bump
 * even though the build itself is valid.
 * @param {AuditContext} context
 */
function auditDependencies(context) {
  for (const script of context.buildScripts) {
    const lines = splitLines(script.text)
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]
      const trimmed = line.trim()
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue
      if (!DEPENDENCY_KEYWORD_RE.test(line)) continue

      for (const match of line.matchAll(DEPENDENCY_COORDINATE_RE)) {
        const coordinate = `${match[1]}:${match[2]}:${match[3]}`
        if (context.detected.dependencies.some((dependency) => dependency.coordinate === coordinate)) continue
        // Only Minecraft-adjacent coordinates encode the target line in their
        // version. A generic library such as slf4j-api:1.7.36 must not be read
        // as a 1.7.36 MC dependency.
        if (!MC_DEPENDENCY_RE.test(`${match[1]}:${match[2]}`)) continue
        const dependencyMcVersion = extractMcVersion(match[3])
        if (!dependencyMcVersion) continue
        if (sameMcFamily(dependencyMcVersion, context.targetLine)) continue

        context.detected.dependencies.push({
          file: script.rel,
          line: index + 1,
          coordinate,
          minecraftVersion: dependencyMcVersion,
        })
        addFinding(context, {
          severity: 'warning',
          code: 'DEPENDENCY_VERSION',
          message:
            `dependency ${coordinate} is pinned to Minecraft ${dependencyMcVersion}, ` +
            `but the ${context.platform} ${context.targetLine} target uses ${context.targetVersion}.`,
          file: script.rel,
          line: index + 1,
          hint:
            `Move the coordinate to the ${context.targetVersion} build of that dependency, ` +
            'or confirm it is version-agnostic.',
        })
      }
    }
  }
}

/**
 * @param {AuditContext} context
 * @param {AuditFinding} finding
 */
function addFinding(context, finding) {
  if (!SEVERITIES.has(finding.severity)) {
    throw new Error(`invalid finding severity ${JSON.stringify(finding.severity)} for code ${finding.code}`)
  }
  /** @type {AuditFinding} */
  const normalized = { severity: finding.severity, code: finding.code, message: finding.message }
  if (finding.file !== undefined) normalized.file = finding.file
  if (finding.line !== undefined) normalized.line = finding.line
  if (finding.hint !== undefined) normalized.hint = finding.hint
  context.findings.push(normalized)
}

/**
 * Stable report order: blockers first, then warnings, then infos; inside a
 * severity, sort by file and line so related hits are adjacent.
 * @param {AuditFinding[]} findings
 */
function sortFindings(findings) {
  findings.sort((left, right) => {
    const bySeverity = SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity]
    if (bySeverity !== 0) return bySeverity

    const leftFile = left.file ?? ''
    const rightFile = right.file ?? ''
    if (leftFile !== rightFile) return leftFile < rightFile ? -1 : 1

    const byLine = (left.line ?? 0) - (right.line ?? 0)
    if (byLine !== 0) return byLine

    const byCode = left.code.localeCompare(right.code)
    if (byCode !== 0) return byCode
    return left.message.localeCompare(right.message)
  })
}
