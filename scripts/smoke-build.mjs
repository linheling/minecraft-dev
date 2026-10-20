#!/usr/bin/env node
/**
 * Scaffold one supported project and report how to build it.
 *
 * This is the "generator" half of the generated-artifact build gate: CI runs
 * this script, then runs the printed wrapper command in the generated
 * directory. The script itself never invokes Gradle, so it is cheap and safe to
 * run locally. `lib/scaffold.js` is the single source of truth for templates
 * and coordinates; this script only picks the target directory, derives the
 * project name/package, and renders a summary.
 *
 * Usage:
 *   node scripts/smoke-build.mjs --platform paper --mc 1.21.8 --dir .smoke/paper-1.21.8
 *   node scripts/smoke-build.mjs --list
 *   node scripts/smoke-build.mjs --platform fabric --mc 26.3 --json
 *
 * Exit codes: 0 success, 1 scaffold failure, 2 usage error.
 * @module minecraft-dev/scripts/smoke-build
 */

import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { scaffoldProject } from '../lib/scaffold.js'
import { PLATFORM_LINES, SUPPORTED_PLATFORMS, resolveLine } from '../lib/versions.js'
import { validateJavaPackage, validateMcVersion, validateProjectName } from '../lib/validate.js'

/** Default Java package for generated smoke projects. */
export const DEFAULT_PACKAGE = 'com.example.smoke'

/** Prefix for derived project names, e.g. `smoke-paper-1-21-8`. */
export const DEFAULT_PROJECT_PREFIX = 'smoke'

/** Exit code for bad argv (unknown flag, missing value, unsupported combo). */
export const EXIT_USAGE = 2

/** Exit code for a scaffold write failure. */
export const EXIT_SCAFFOLD = 1

/** Error type for argv problems; maps to EXIT_USAGE. */
export class UsageError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message)
    this.name = 'UsageError'
    this.exitCode = EXIT_USAGE
  }
}

export const USAGE = `Usage:
  node scripts/smoke-build.mjs --platform <p> --mc <ver> [--dir <path>] [--json]
                               [--name <name>] [--package <pkg>]
  node scripts/smoke-build.mjs --list [--json]

Generate one supported (platform, Minecraft) project with lib/scaffold.js and
print its directory, wrapper build command and file count. Does not build; run
the printed command (./gradlew build) inside the generated directory.

Options:
  --platform <p>   ${SUPPORTED_PLATFORMS.join(' | ')}
  --mc <ver>       Minecraft version or line, e.g. 1.21.8, 26.3, 1.12.2
  --dir <path>     target directory (default: .smoke/<platform>-<ver>)
  --name <name>    project name (default: smoke-<platform>-<ver with dashes>)
  --package <pkg>  Java package (default: ${DEFAULT_PACKAGE})
  --list           list the shipped platform x Minecraft-line matrix and exit
  --json           print machine-readable JSON
  --help           show this help

Exit codes: 0 ok, ${EXIT_SCAFFOLD} scaffold failed, ${EXIT_USAGE} usage error.`

/** @typedef {{ platform: string, mc: string, dir: string, name: string, packageName: string, json: boolean, mode: 'scaffold' | 'list' | 'help' }} SmokeOptions */

/**
 * Normalize a Minecraft version to the form used in directories and project
 * names: strip a trailing `.x` ("1.21.x" -> "1.21") and leave the rest intact.
 * @param {string} version - user-supplied version.
 * @returns {string} normalized version.
 */
export function normalizeVersion(version) {
  return version.replace(/\.x$/i, '')
}

/**
 * Folder name for a target, e.g. `paper-1.21.8`.
 * @param {string} platform - platform key.
 * @param {string} mc - Minecraft version.
 * @returns {string} folder name.
 */
export function targetFolder(platform, mc) {
  return `${platform}-${normalizeVersion(mc)}`
}

/**
 * Default output directory, relative to the working directory.
 * @param {string} platform - platform key.
 * @param {string} mc - Minecraft version.
 * @returns {string} e.g. `.smoke/paper-1.21.8`.
 */
export function defaultTargetDir(platform, mc) {
  return `.smoke/${targetFolder(platform, mc)}`
}

/**
 * Derived kebab-case project name, e.g. `smoke-paper-1-21-8` (dots are not
 * legal in a scaffold project name, so they become dashes).
 * @param {string} platform - platform key.
 * @param {string} mc - Minecraft version.
 * @returns {string} project name.
 */
export function defaultProjectName(platform, mc) {
  return [DEFAULT_PROJECT_PREFIX, platform, ...normalizeVersion(mc).split('.')].join('-')
}

/** Flags that consume the following argv entry (or `--flag=value`). */
const VALUE_FLAGS = new Map([
  ['--platform', 'platform'],
  ['--mc', 'mc'],
  ['--dir', 'dir'],
  ['--name', 'name'],
  ['--package', 'packageName'],
])

/** Boolean flags. */
const BOOLEAN_FLAGS = new Map([
  ['--list', 'list'],
  ['--json', 'json'],
  ['--help', 'help'],
])

/**
 * Parse argv into scaffold options. Pure: validates names/versions and the
 * platform matrix, derives `dir` / `name` / `packageName` defaults, and throws
 * UsageError on anything it cannot act on.
 * @param {string[]} argv - arguments after the script name.
 * @returns {SmokeOptions} parsed options.
 * @throws {UsageError} for unknown flags, missing values, or unsupported combos.
 */
export function parseArgs(argv) {
  /** @type {Record<string, unknown>} */
  const raw = { json: false, list: false, help: false }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const equals = arg.indexOf('=')
    const flag = equals > 0 ? arg.slice(0, equals) : arg

    if (BOOLEAN_FLAGS.has(flag)) {
      if (equals > 0) throw new UsageError(`${flag} does not take a value`)
      raw[BOOLEAN_FLAGS.get(flag)] = true
      continue
    }

    if (VALUE_FLAGS.has(flag)) {
      let value
      if (equals > 0) {
        value = arg.slice(equals + 1)
      } else {
        value = argv[i + 1]
        if (value === undefined || value.startsWith('--')) {
          throw new UsageError(`${flag} needs a value`)
        }
        i += 1
      }
      if (value === '') throw new UsageError(`${flag} needs a non-empty value`)
      raw[VALUE_FLAGS.get(flag)] = value
      continue
    }

    throw new UsageError(`unknown argument ${JSON.stringify(arg)} (try --help)`)
  }

  if (raw.help) return { ...emptyOptions(), mode: 'help' }

  if (raw.list) {
    const conflicting = [...VALUE_FLAGS.keys()].filter(flag => argv.some(arg => arg === flag || arg.startsWith(`${flag}=`)))
    if (conflicting.length > 0) {
      throw new UsageError(`--list does not combine with ${conflicting.join(', ')}`)
    }
    return { ...emptyOptions(), json: Boolean(raw.json), mode: 'list' }
  }

  if (!raw.platform) throw new UsageError(`missing --platform (supported: ${SUPPORTED_PLATFORMS.join(', ')})`)
  if (!raw.mc) throw new UsageError('missing --mc (e.g. 1.21.8, 26.3, 1.12.2)')

  const platform = /** @type {string} */ (raw.platform)
  if (!SUPPORTED_PLATFORMS.includes(platform)) {
    throw new UsageError(`unsupported platform ${JSON.stringify(platform)}; supported: ${SUPPORTED_PLATFORMS.join(', ')}`)
  }

  let mc
  try {
    mc = validateMcVersion(/** @type {string} */ (raw.mc))
  } catch (error) {
    throw new UsageError(error.message)
  }

  try {
    resolveLine(platform, mc)
  } catch (error) {
    throw new UsageError(error.message)
  }

  const name = raw.name === undefined ? defaultProjectName(platform, mc) : /** @type {string} */ (raw.name)
  const packageName = raw.packageName === undefined ? DEFAULT_PACKAGE : /** @type {string} */ (raw.packageName)
  try {
    validateProjectName(name)
    validateJavaPackage(packageName)
  } catch (error) {
    throw new UsageError(error.message)
  }

  const dir = raw.dir === undefined ? defaultTargetDir(platform, mc) : /** @type {string} */ (raw.dir)
  if (dir.trim() === '') throw new UsageError('--dir needs a non-empty value')

  return {
    platform,
    mc,
    dir,
    name,
    packageName,
    json: Boolean(raw.json),
    mode: 'scaffold',
  }
}

/** Empty option shell used by --list/--help. */
function emptyOptions() {
  return { platform: '', mc: '', dir: '', name: '', packageName: '', json: false, mode: 'scaffold' }
}

/**
 * Every shipped (platform, Minecraft line) pair, in matrix order.
 * @returns {Array<{ platform: string, line: string, mc: string, java: number, gradle: string, template: string }>}
 */
export function listRows() {
  const rows = []
  for (const platform of SUPPORTED_PLATFORMS) {
    for (const entry of PLATFORM_LINES[platform]) {
      rows.push({
        platform,
        line: entry.line,
        mc: entry.defaultMcVersion,
        java: entry.javaVersion,
        gradle: entry.coords?.gradleVersion ?? '-',
        template: entry.templateDir,
      })
    }
  }
  return rows
}

/**
 * Render the matrix as an aligned text table. Pure.
 * @param {ReturnType<typeof listRows>} rows - matrix rows.
 * @returns {string} printable table.
 */
export function renderList(rows) {
  const header = ['platform', 'line', 'mc', 'java', 'gradle', 'template']
  const body = rows.map(row => [row.platform, row.line, row.mc, String(row.java), row.gradle, row.template])
  const widths = header.map((title, column) => Math.max(title.length, ...body.map(row => row[column].length)))
  const format = row => row.map((cell, column) => cell.padEnd(widths[column])).join('  ').trimEnd()
  return [
    `Supported scaffold targets (${rows.length}):`,
    '',
    format(header),
    format(widths.map(width => '-'.repeat(width))),
    ...body.map(format),
    '',
    'Tip: pass --platform/--mc to scaffold one, --json for machine-readable output.',
  ].join('\n')
}

/**
 * Build the machine-readable summary for a scaffold result. Pure.
 * @param {Awaited<ReturnType<typeof scaffoldProject>>} result - scaffoldProject result.
 * @param {{ name: string, packageName: string, dir: string }} options - parsed options.
 * @param {{ javaVersion: number, coords?: { gradleVersion?: string } }} line - resolved line entry.
 * @returns {object} summary object printed by --json.
 */
export function summarize(result, options, line) {
  return {
    ok: true,
    platform: result.platform,
    minecraftVersion: result.minecraftVersion,
    projectName: options.name,
    packageName: options.packageName,
    // `directory` is exactly what the caller passed; `projectDir` is the
    // resolved absolute path the build must run in.
    directory: options.dir,
    projectDir: result.projectDir,
    files: result.filesCreated.length,
    filesCreated: result.filesCreated,
    buildCommand: result.buildCommand,
    wrapperReady: result.wrapperReady,
    javaVersion: line.javaVersion,
    gradleVersion: line.coords?.gradleVersion ?? null,
  }
}

/**
 * Render the human summary for a scaffold result. Pure.
 * @param {ReturnType<typeof summarize>} summary - summary object.
 * @returns {string} printable summary.
 */
export function renderSummary(summary) {
  const lines = [
    `Scaffolded ${summary.platform} ${summary.minecraftVersion}`,
    `  project:  ${summary.projectName}  (Java ${summary.javaVersion}, Gradle ${summary.gradleVersion ?? 'default'})`,
    `  directory: ${summary.projectDir}`,
    `  files:    ${summary.files}`,
    `  build:    ${summary.buildCommand}`,
    '',
    `Next: cd "${summary.projectDir}" && ${summary.buildCommand} --no-daemon --stacktrace`,
  ]
  return lines.join('\n')
}

/**
 * Print a failure in the requested format and return the matching exit code.
 * @param {Error} error - failure.
 * @param {boolean} json - whether --json was requested.
 * @returns {number} process exit code.
 */
function reportFailure(error, json) {
  if (json) console.log(JSON.stringify({ ok: false, error: error.message }, null, 2))
  console.error(`✗ smoke-build: ${error.message}`)
  return error instanceof UsageError ? EXIT_USAGE : EXIT_SCAFFOLD
}

/**
 * CLI entry point. Never calls Gradle; only scaffolds and prints.
 * @param {string[]} argv - arguments after the script name.
 * @returns {Promise<number>} process exit code.
 */
export async function main(argv) {
  const wantsJson = argv.includes('--json')
  let options
  try {
    options = parseArgs(argv)
  } catch (error) {
    return reportFailure(error, wantsJson)
  }

  if (options.mode === 'help') {
    console.log(USAGE)
    return 0
  }

  if (options.mode === 'list') {
    const rows = listRows()
    console.log(options.json ? JSON.stringify(rows, null, 2) : renderList(rows))
    return 0
  }

  try {
    const line = resolveLine(options.platform, options.mc)
    const targetDir = path.resolve(options.dir)
    const result = await scaffoldProject({
      platform: options.platform,
      minecraftVersion: options.mc,
      targetDir,
      name: options.name,
      packageName: options.packageName,
    })
    const summary = summarize(result, options, line)
    if (options.json) {
      console.log(JSON.stringify(summary, null, 2))
    } else {
      console.log(renderSummary(summary))
    }
    return 0
  } catch (error) {
    return reportFailure(error, options.json)
  }
}

// Only run when invoked as a script, so tests can import the pure functions.
const invokedDirectly = process.argv[1] !== undefined
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (invokedDirectly) {
  process.exitCode = await main(process.argv.slice(2))
}
