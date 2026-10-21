/**
 * Filesystem driver for mc_scaffold: walks the template tree under
 * assets/templates, renders placeholders, writes the project, and rolls back
 * on failure or cancellation. Real node:fs only; unit tests exercise it
 * against real temp directories.
 * @module minecraft-dev/lib/scaffold
 */

import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { renderTemplateTree } from './templates.js'
import {
  toApiVersion,
  toMainClass,
  toPackagePath,
  validateJavaPackage,
  validateJavaVersion,
  validateMcVersion,
  validateProjectName,
} from './validate.js'
import { defaultJavaVersion, lineCoords, paperApiVersion, resolveLine } from './versions.js'

const TEMPLATES_ROOT = fileURLToPath(new URL('../assets/templates/', import.meta.url))
const WRAPPER_DIR = path.join(TEMPLATES_ROOT, 'common', 'wrapper')
// Historical default for the wrapper only. Every shipped platform line defines
// coords.gradleVersion, so this is a safety net for future lines, not the norm.
const FALLBACK_GRADLE_VERSION = '8.14.3'

/** Recursively list a directory as { rel, content } with paths relative to the root. */
async function readTree(root) {
  /** @param {string} dir */
  async function walk(dir) {
    const entries = await readdir(dir)
    const files = []
    for (const entry of entries) {
      const full = path.join(dir, entry)
      const info = await stat(full)
      if (info.isDirectory()) {
        files.push(...await walk(full))
      } else {
        files.push({
          rel: path.relative(root, full).split(path.sep).join('/'),
          content: await readFile(full),
        })
      }
    }
    return files
  }
  return walk(root)
}

/** Ensure a target directory does not exist or is empty. */
async function assertTargetAvailable(targetDir) {
  try {
    const info = await stat(targetDir)
    if (!info.isDirectory()) {
      throw new Error(`target ${targetDir} exists and is not a directory`)
    }
    const entries = await readdir(targetDir)
    if (entries.length > 0) {
      throw new Error(`target ${targetDir} is not empty; scaffold requires a new or empty directory`)
    }
  } catch (error) {
    if (error && error.code === 'ENOENT') return
    throw error
  }
}

/**
 * Scaffold one project from the shipped template.
 * @param {object} options
 * @param {string} options.platform - supported platform key (v0.2: paper/fabric/forge/neoforge).
 * @param {string} options.minecraftVersion - full or line version, e.g. "1.21.8".
 * @param {string} options.targetDir - absolute path of the new project root.
 * @param {string} options.name - kebab-case project name.
 * @param {string} options.packageName - Java package name.
 * @param {number} [options.javaVersion] - Java level; defaults to the era value.
 * @param {AbortSignal} [options.signal] - cancellation; aborts before the write phase.
 * @returns {Promise<{ platform: string, minecraftVersion: string, projectDir: string, filesCreated: string[], buildCommand: string, wrapperReady: boolean }>}
 */
export async function scaffoldProject(options) {
  const { platform, targetDir, name } = options
  const minecraftVersion = validateMcVersion(options.minecraftVersion)
  const packageName = validateJavaPackage(options.packageName)
  validateProjectName(name)
  const lineEntry = resolveLine(platform, minecraftVersion)
  const javaVersion = validateJavaVersion(options.javaVersion ?? defaultJavaVersion(platform, minecraftVersion))
  const mainClass = toMainClass(name)

  await assertTargetAvailable(targetDir)
  if (options.signal?.aborted) throw new Error('scaffold cancelled')

  const templateDir = path.join(TEMPLATES_ROOT, lineEntry.templateDir)
  const templateFiles = await readTree(templateDir)
  const wrapperFiles = await readTree(WRAPPER_DIR)
  const coords = lineCoords(platform, minecraftVersion)

  // A line-form request ("1.20", "1.21.x", "26.x") names a support line, not a
  // buildable version. Render the line's pinned default so the generated
  // coordinates are real: `fabric 1.21.x` used to emit `minecraft:1.21.x`.
  // A full version the caller named explicitly (paper/spigot are lenient) still
  // drives the coordinate, which is why the raw value is kept for 3+ segments.
  const requested = minecraftVersion.replace(/\.x$/i, '')
  const isLineRequest = requested.split('.').length < 3
  const resolvedVersion = isLineRequest ? lineEntry.defaultMcVersion : minecraftVersion

  const vars = {
    name,
    pkg: packageName,
    pkgPath: toPackagePath(packageName),
    MainClass: mainClass,
    mcVersion: resolvedVersion,
    javaVersion,
    apiVersion: toApiVersion(resolvedVersion),
    paperApiVersion: paperApiVersion(resolvedVersion),
    // v0.2: per-line static coordinates (loom/loader/fabric-api, forgeGradle/
    // forgeVersion/mappings, moddev/neoVersion, gradleVersion).
    ...coords,
    // The wrapper properties are rendered for every platform: the common
    // wrapper carries `{{gradleVersion}}`, templates that ship their own
    // wrapper properties carry it too. Fall back to the historical default so
    // a platform without coords still scaffolds a working wrapper.
    gradleVersion: coords.gradleVersion ?? FALLBACK_GRADLE_VERSION,
  }
  const rendered = renderTemplateTree(templateFiles, vars)
  const renderedWrapper = renderTemplateTree(wrapperFiles, vars)
  const renderedRels = new Set(rendered.map(file => file.rel))

  // Write template files first, then wrapper files — a wrapper file whose rel
  // path the template already provided is skipped (each template dir ships its
  // own gradle-wrapper.properties pinned to that line's gradleVersion; the
  // common wrapper fills the gap for templates without one, e.g. paper). On
  // any failure remove everything.
  const filesCreated = []
  try {
    const toWrite = [...rendered, ...renderedWrapper.filter(file => !renderedRels.has(file.rel))]
    for (const file of toWrite) {
      if (options.signal?.aborted) throw new Error('scaffold cancelled')
      const full = path.join(targetDir, ...file.rel.split('/'))
      await mkdir(path.dirname(full), { recursive: true })
      await writeFile(full, file.content)
      filesCreated.push(file.rel)
    }
  } catch (error) {
    await rm(targetDir, { recursive: true, force: true }).catch(() => {})
    throw error
  }

  return {
    platform,
    minecraftVersion: resolvedVersion,
    projectDir: targetDir,
    filesCreated,
    buildCommand: process.platform === 'win32' ? 'gradlew.bat build' : './gradlew build',
    wrapperReady: true,
  }
}
