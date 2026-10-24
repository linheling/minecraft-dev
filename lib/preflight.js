/**
 * Pre-spawn checks for mc_gradle. The three failures that cost the most time
 * have nothing to do with the code being built:
 *
 * 1. no Gradle wrapper — the spawn fails with a bare ENOENT/EACCES that the
 *    model has to reinterpret;
 * 2. the `java` on PATH is not the JDK the project targets — Gradle fails deep
 *    into configuration, or silently depends on toolchain auto-provisioning;
 * 3. the wrapper's Gradle version predates the JDK it is launched on (Java 25
 *    needs Gradle ≥ 9.1, Java 24 ≥ 8.14, Java 21 ≥ 8.5, Java 17 ≥ 7.3), and a
 *    Gradle 9 wrapper needs a Java 17+ *runtime*.
 *
 * (1) throws with an actionable message — the run cannot work. (2) and (3)
 * return `warnings` instead of failing, because toolchain auto-provisioning
 * (foojay) lets many of them succeed anyway; mc_gradle renders them as
 * `[preflight] …` lines above the Gradle output.
 * @module minecraft-dev/lib/preflight
 */

import { spawnSync } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'

/** Minimum Gradle version required by each Java runtime (from minecraft-java-build). */
export const MIN_GRADLE_FOR_JAVA = {
  17: '7.3',
  21: '8.5',
  24: '8.14',
  25: '9.1',
}

/** First Gradle major that refuses to run on a Java runtime older than 17. */
const GRADLE_9_MIN_JAVA = 17

/**
 * Parse the Java feature version out of `java -version` output. Handles the
 * legacy `1.8.0_402` form and the modern `17.0.2` / `25` forms; `java
 * -version` prints to stderr, so callers usually pass both streams.
 * @param {string} text - combined stdout+stderr of `java -version`.
 * @returns {number | null} the feature version (8, 17, 21, 25, …), or null.
 */
export function parseJavaMajor(text) {
  if (typeof text !== 'string' || text.length === 0) return null
  const legacy = /version\s+"?1\.(\d+)/.exec(text)
  if (legacy?.[1] !== undefined) return Number(legacy[1])
  const modern = /(?:version\s+|openjdk\s+|jdk\s+)"?(\d+)(?:\.(\d+))?/.exec(text)
  if (modern?.[1] === undefined) return null
  const major = Number(modern[1])
  return Number.isFinite(major) && major >= 2 ? major : null
}

/**
 * Detect the feature version of the `java` on PATH. Returns null when the
 * command is missing or fails — a missing JDK is a warning, not a hard stop
 * (the caller may have set JAVA_HOME for Gradle but not for this process).
 * @param {{ spawnSyncImpl?: Function, javaCommand?: string }} [internals]
 * @returns {number | null} feature version or null.
 */
export function detectJavaVersion(internals = {}) {
  const spawnSyncImpl = internals.spawnSyncImpl ?? spawnSync
  const javaCommand = internals.javaCommand ?? 'java'
  try {
    const result = spawnSyncImpl(javaCommand, ['-version'], {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
    })
    if (result?.error || result?.status !== 0) return null
    return parseJavaMajor(`${result.stdout ?? ''}\n${result.stderr ?? ''}`)
  } catch {
    return null
  }
}

/** Build-script patterns that declare the Java level a project targets. */
const PROJECT_JAVA_PATTERNS = [
  /JavaLanguageVersion\.of\(\s*(\d+)\s*\)/,
  /jvmToolchain\(\s*(\d+)\s*\)/,
  /JavaVersion\.VERSION_1_(\d+)/,
  /JavaVersion\.VERSION_(\d+)/,
  /sourceCompatibility\s*=\s*(?:JavaVersion\.VERSION_)?['"]?(?:1\.)?(\d+)/,
  /targetCompatibility\s*=\s*(?:JavaVersion\.VERSION_)?['"]?(?:1\.)?(\d+)/,
]

/**
 * Parse the Java level a build script declares. Kotlin DSL toolchains come
 * first; Groovy `sourceCompatibility`/`targetCompatibility` (including the
 * legacy `'1.8'` spelling) are the fallbacks.
 * @param {string} source - build.gradle or build.gradle.kts contents.
 * @returns {number | null} declared Java level, or null when the script is silent.
 */
export function parseProjectJavaVersion(source) {
  if (typeof source !== 'string' || source.length === 0) return null
  for (const pattern of PROJECT_JAVA_PATTERNS) {
    const match = pattern.exec(source)
    if (match?.[1] !== undefined) return Number(match[1])
  }
  return null
}

/** Compare dotted versions numerically: -1, 0 or 1. */
function compareVersions(a, b) {
  const partsA = a.split('.').map(Number)
  const partsB = b.split('.').map(Number)
  for (let i = 0; i < Math.max(partsA.length, partsB.length); i += 1) {
    const diff = (partsA[i] ?? 0) - (partsB[i] ?? 0)
    if (diff !== 0) return Math.sign(diff)
  }
  return 0
}

/**
 * Find the wrapper script the platform would spawn, or throw with a message
 * that names the fix. On POSIX a present-but-not-executable wrapper is also a
 * hard stop: node's spawn reports EACCES only after Gradle never starts.
 * @param {string} projectDir - resolved project root.
 * @param {string} platform - host platform.
 * @returns {Promise<string>} the wrapper file name.
 */
async function findWrapper(projectDir, platform) {
  const name = platform === 'win32' ? 'gradlew.bat' : 'gradlew'
  const full = path.join(projectDir, name)
  let info
  try {
    info = await stat(full)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    throw new Error(
      `no Gradle wrapper at ${full}: mc_gradle runs gradlew from the project root. `
      + 'Pass projectDir=<the directory mc_scaffold created>, or scaffold a project first.',
    )
  }
  if (!info.isFile()) throw new Error(`${full} exists but is not a regular file`)
  if (platform !== 'win32' && (info.mode & 0o111) === 0) {
    throw new Error(`${full} is not executable: run "chmod +x gradlew" in ${projectDir} before mc_gradle.`)
  }
  return name
}

/**
 * Read the wrapper's pinned Gradle version (`gradle-8.14.3-bin.zip` → 8.14.3).
 * @param {string} projectDir - resolved project root.
 * @returns {Promise<string | null>} version, or null when unreadable/absent.
 */
async function readGradleVersion(projectDir) {
  const properties = path.join(projectDir, 'gradle', 'wrapper', 'gradle-wrapper.properties')
  let text
  try {
    text = await readFile(properties, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
  return /gradle-([\d.]+)-(?:bin|all)\.zip/.exec(text)?.[1] ?? null
}

/**
 * Read the build script the Java level lives in (Kotlin DSL preferred).
 * @param {string} projectDir - resolved project root.
 * @returns {Promise<string>} script contents, or '' when neither file exists.
 */
async function readBuildScript(projectDir) {
  for (const name of ['build.gradle.kts', 'build.gradle']) {
    try {
      return await readFile(path.join(projectDir, name), 'utf8')
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
  return ''
}

/**
 * Run the pre-spawn checks and return what they found.
 * @param {object} options
 * @param {string} options.projectDir - project root that contains the wrapper.
 * @param {string} [options.platform] - host platform; defaults to process.platform.
 * @param {{ javaVersionImpl?: () => number | null | Promise<number | null>, spawnSyncImpl?: Function, javaCommand?: string }} [internals]
 *   - javaVersionImpl: test seam that replaces the `java -version` probe.
 * @returns {Promise<{ wrapper: string, gradleVersion: string | null, javaVersion: number | null, projectJavaVersion: number | null, warnings: string[] }>}
 */
export async function preflightGradle({ projectDir, platform = process.platform, internals = {} }) {
  const dir = path.resolve(projectDir)
  const wrapper = await findWrapper(dir, platform)
  const [gradleVersion, buildScript] = await Promise.all([
    readGradleVersion(dir),
    readBuildScript(dir),
  ])
  const projectJavaVersion = parseProjectJavaVersion(buildScript)
  const javaVersion = typeof internals.javaVersionImpl === 'function'
    ? await internals.javaVersionImpl()
    : detectJavaVersion(internals)

  const warnings = []
  if (javaVersion === null) {
    warnings.push(
      'no working `java` on PATH: Gradle needs a JDK to start. Install the JDK this project targets '
      + '(see the minecraft-java-build skill) or point JAVA_HOME at one.',
    )
  }
  if (javaVersion !== null && projectJavaVersion !== null && javaVersion !== projectJavaVersion) {
    warnings.push(
      `project targets Java ${projectJavaVersion} but \`java -version\` reports ${javaVersion}: Gradle may provision the right `
      + `JDK through its toolchain resolver (foojay), otherwise run Gradle on JDK ${projectJavaVersion} or pass `
      + `args ["-Dorg.gradle.java.home=<jdk-${projectJavaVersion}>"].`,
    )
  }
  if (gradleVersion !== null && javaVersion !== null) {
    const min = MIN_GRADLE_FOR_JAVA[javaVersion]
    if (min !== undefined && compareVersions(gradleVersion, min) < 0) {
      warnings.push(
        `Gradle ${gradleVersion} is older than ${min}, which Java ${javaVersion} requires to run Gradle: upgrade the wrapper `
        + '(minecraft-java-build has the table) or launch Gradle on an older JDK.',
      )
    }
    const gradleMajor = Number(gradleVersion.split('.')[0])
    if (gradleMajor >= 9 && javaVersion < GRADLE_9_MIN_JAVA) {
      warnings.push(
        `Gradle ${gradleVersion} requires Java ${GRADLE_9_MIN_JAVA}+ to run, but \`java -version\` reports ${javaVersion}: `
        + 'set a newer JAVA_HOME or pass args ["-Dorg.gradle.java.home=<jdk>"] (the project can still target Java 8 bytecode).',
      )
    }
  }
  return { wrapper, gradleVersion, javaVersion, projectJavaVersion, warnings }
}
