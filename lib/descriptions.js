/**
 * Model-facing tool descriptions. They live in one module because each one is
 * an instruction sheet, not a label: a model that only reads the description
 * must know when the tool applies, when it does not, what it will refuse, and
 * what to read first when it fails. Keeping the five together also lets the
 * tests enforce the same structure across all of them (see
 * test/tool-descriptions.test.js).
 *
 * The label shape is deliberate and stable:
 * `Use when:` / `Do not use for:` / `Constraints:` / `After a failure:`.
 * @module minecraft-dev/lib/descriptions
 */

/** Shared tail for the scaffold: what to do when the template render fails. */
export const SCAFFOLD_DESCRIPTION = 'Create a new Minecraft project from the bundled template for Minecraft 1.7.10–26.3 '
  + 'on paper / fabric / forge / neoforge / spigot (all five platforms are available; fabric/forge/neoforge accept the '
  + 'pinned versions for their line). '
  + 'Generates the complete Gradle project: build scripts, main class, plugin/mod metadata, and a Gradle wrapper so the '
  + 'project builds without a Gradle installation. '
  + 'Use when: you are starting a project from scratch, or porting by regenerating the target skeleton in a new directory '
  + '(the recommended porting procedure). '
  + 'Do not use for: an existing project that should keep its history (run mc_port_audit first and upgrade in place), '
  + 'or to add code to a project that already exists. '
  + 'Constraints: targetDir must not exist or must be empty; javaVersion defaults to the era level (8 for the '
  + '1.7.10/1.12.2/1.16.5 lines, 17 for fabric/neoforge 1.20.x, 21 for paper 1.20.x and the 1.21.x lines, 25 for 26.x) '
  + 'when omitted; the wrapper is included and the first build downloads dependencies, so it takes several minutes. '
  + 'After a failure: read the error, fix targetDir/version and retry; if the build then fails, load the platform skill '
  + '(minecraft-java-build has the Java × Gradle matrix) and use mc_gradle rather than re-scaffolding blindly.'

export const GRADLE_DESCRIPTION = 'Run a Gradle task in an existing Minecraft project via its wrapper (gradlew / gradlew.bat). '
  + 'Reports the exit code in the result instead of failing on non-zero exits; output is truncated head and tail. '
  + 'Use when: building, testing, or running a scaffolded project (task="build", task="test", task="runClient", '
  + 'task="runServer", task="runData"). '
  + 'Do not use for: Maven/Ant projects (no wrapper) or a project you have not scaffolded or audited yet — create it '
  + 'with mc_scaffold or check it with mc_port_audit first, and never start a second run in the same projectDir '
  + '(concurrent Gradle builds corrupt each other). '
  + 'Constraints: one run per projectDir at a time (the second is rejected); before spawning, the wrapper and the JDK are '
  + 'checked against the project toolchain and mismatches come back as [preflight] warnings; the timeout kills the whole '
  + 'process tree; a non-zero exit is a result to read, not a tool error. '
  + 'After a failure: fix one cause and re-run the same task; the hints name the likely cause (JDK/toolchain mismatch, '
  + 'dependency download failure, OOM, daemon lock) and the result ends with next steps for that exact outcome.'

export const PORT_AUDIT_DESCRIPTION = 'Audit an existing Minecraft project read-only against a target platform/version '
  + 'before porting it. Checks the Gradle wrapper version, Java level/toolchain, foojay resolver, mods.toml/'
  + 'neoforge.mods.toml version ranges, plugin.yml api-version, build plugin type, dependency coordinates, and imports '
  + 'of removed/renamed APIs (e.g. GameRegistry, SimpleNetworkWrapper, net.minecraft.block.Block). Returns findings '
  + 'sorted by severity (blocker/warning/info) with file:line and a repair hint. '
  + 'Use when: deciding whether an existing project can be ported, and how (in-place upgrade vs regenerate-skeleton). '
  + 'Do not use for: greenfield projects (use mc_scaffold) or as a substitute for a build (mc_gradle runs the actual '
  + 'compiler; this tool never builds). '
  + 'Constraints: read-only — it writes nothing; minecraftVersion must be one of the shipped platform lines; every '
  + 'finding carries file:line and a repair hint. '
  + 'After a failure: fix every blocker first, then re-run the same audit; when it is clean, mount the target skeleton '
  + 'with mc_scaffold and port module by module with mc_gradle build as the gate (load minecraft-porting for the '
  + 'version-family breakpoints).'

export const CODEX_DESCRIPTION = 'Delegate the plugin architecture to the user\'s own Codex CLI as a fully visible session. '
  + 'Writes the architecture brief to <projectDir>/.dsh/codex-architect.md, runs Codex on it (default: the official '
  + 'app-server protocol, so the session appears in the Codex desktop app and can be continued there), and returns the '
  + 'command, full output, exit code, duration, changed files, session id, rollout path and token usage. '
  + 'Use when: the "Minecraft 架构师" (architect) preset needs a skeleton designed by a coding agent, with the handoff '
  + 'marked by [TODO: Agent B]. '
  + 'Do not use for: querying or editing an existing project without Codex (use the mc-plan/mc-skeleton subagent chain '
  + 'or edit directly) — and do not retry blindly after a non-zero exit. '
  + 'Constraints: the Codex CLI must be on PATH; projectDir must already exist; mode="exec" is a compatibility fallback '
  + 'that keeps the session out of the Codex desktop list; the timeout kills the whole process tree. '
  + 'After a failure: read the last message file, then verify the skeleton with mc_gradle build and confirm the '
  + '[TODO: Agent B] count is 0; fall back to the subagent_mc_plan/skeleton/content/verify chain if Codex stays '
  + 'unavailable.'

export const SMOKE_DESCRIPTION = 'Start a Gradle run task in the project (default `runServer`), watch the merged console '
  + 'for patterns, then stop the server and write evidence under `<projectDir>/.dsh/smoke/`. '
  + 'It returns a pass/fail verdict per scenario step — not a code review, and not a substitute for mc_gradle build. '
  + 'Use when: after `mc_gradle` build is green the open question is "does it actually start and reach the expected '
  + 'state" (server up, plugin/mod loaded, no startup exception, no class errors). '
  + 'Do not use for: build checks or unit tests (mc_gradle does those), and never while another Gradle task runs in '
  + 'the same project — the run holds the project build slot and refuses a second one. '
  + 'Constraints: it starts a real JVM, so the JDK must match the version line (see minecraft-java-build); the first '
  + 'run downloads dependencies and may take minutes — the budget defaults to 600000 ms and is raised with timeoutMs; '
  + 'the scenario is plain JSON (`{"id":"paper-startup","task":"runServer","args":["--no-daemon"],"steps":[{"id":"ready",'
  + '"expect":{"contains":["Done ("]}}]}`) passed inline or as a path to a JSON file; every `contains` pattern must '
  + 'appear and every `notContains` pattern must stay absent before the run passes; on timeout or abort the whole '
  + 'process tree is killed. '
  + 'After a failure: read `console.log` in the returned evidenceDir — the missing patterns name where startup stalled; '
  + 'fix that cause (JDK mismatch, missing dependency, a plugin throwing on enable) and re-run; if the server never '
  + 'reaches `Done (`, run mc_gradle task="runServer" once to read the raw log.'
