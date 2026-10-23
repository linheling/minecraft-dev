/**
 * Bundled Minecraft development skills for DeepSeek Harness. One provider
 * registers every skill shipped under assets/skills; the model loads a skill
 * body on demand through the `skill` tool (or the /<name> gesture).
 * Mirrors the dsh-skill-badge provider pattern (rank: bundled 600).
 * @module minecraft-dev/skills
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { BUNDLED_SKILL_RANK } from '@deepseek-ai/dsh-skill'

const PROVIDER_NAME = 'minecraft-dev'

/**
 * One skill per entry. `description` is the model-routing signal (when to load
 * this skill); keep it under ~500 chars and English. v0.11 ships the shared
 * build skill, the Paper / Fabric / Forge / NeoForge / Spigot skills, the
 * major-mods addon-reference skill, the intake skill and the cross-version
 * porting skill.
 */
const SKILLS = [
  {
    name: 'minecraft-java-build',
    description: 'Java, Gradle, and toolchain knowledge for Minecraft projects spanning MC 1.7.10 to 26.x: JDK level per version (Java 8 for 1.7.10/1.12.2, 17 for 1.18-1.20.4, 21 for 1.20.5-1.21.x, 25 for 26.x), era-appropriate Gradle wrappers, foojay toolchain auto-provisioning, dependency repositories (PaperMC, Fabric, NeoForged, Spigot hub), common build tasks and troubleshooting. Use when a Minecraft project has build, Gradle, or Java version problems, or when planning build setup for any new Minecraft project.',
  },
  {
    name: 'minecraft-paper-plugin',
    description: 'Develop Paper/Spigot server plugins for Minecraft 1.20.x, 1.21.x and 26.x. Project setup with paper-api and shadow jar, plugin.yml fields, the JavaPlugin lifecycle, events, commands, permissions, config, scheduler, and the build/test/reload loop. Also notes the Paper family (Purpur, Pufferfish, Folia). Use when creating or extending a modern Paper/Spigot server plugin.',
  },
  {
    name: 'minecraft-fabric-mod',
    description: 'Develop Fabric mods for Minecraft 1.20.1, 1.21.x and 26.x. Project setup with the fabric-loom Gradle plugin (loom 1.17.19, loader 0.19.3, Fabric API per version), fabric.mod.json entrypoints and depends blocks, official Mojang mappings, Mixin, client/common source sets, and the build/runClient/runServer loop. Use when creating or extending a Fabric mod, or fixing Fabric build, remap or dependency problems.',
  },
  {
    name: 'minecraft-forge-mod',
    description: 'Develop Forge mods across the four eras: 1.7.10 (ForgeGradle 1.2 fork, Gradle 7.4.2, MCP), 1.12.2 (ForgeGradle 3, Gradle 4.9, MCP snapshot 20171003), 1.16.5 (ForgeGradle 5, Gradle 7.3.3, official mappings), 1.20.1 (ForgeGradle 6, Gradle 8.8, mods.toml). Covers mcmod.info vs mods.toml metadata, @Mod lifecycle per era, reobfJar, JDK 8 requirement for old lines, runClient/runServer/runData. Use when creating or extending a Forge mod, or fixing era-specific Forge build problems.',
  },
  {
    name: 'minecraft-neoforge-mod',
    description: 'Develop NeoForge mods for 1.20.1, 1.21.x and 26.x (26.2 has non-beta builds; 26.3 is beta-only so far). Project setup with the net.neoforged.moddev Gradle plugin (2.0.147; legacyforge 2.0.91 for 1.20.1), NeoForm pipeline, neoforge.mods.toml mandatory fields, @Mod and event bus, DeferredRegister, data generation, runClient/runServer/runData, optional Parchment mappings. Use when creating or extending a NeoForge mod, or fixing moddev/NeoForm/mods.toml problems.',
  },
  {
    name: 'minecraft-spigot-legacy',
    description: 'Develop Spigot/Bukkit server plugins for legacy Minecraft 1.7.10 and 1.12.2: Java 8 build setup with spigot-api compileOnly (1.12.2 from the Spigot hub maven, 1.7.10 from a vendored server jar), plugin.yml fields without api-version, the JavaPlugin lifecycle, events, commands, permissions, config, and the build/copy-to-server/reload loop on old servers. Also covers Cauldron/KCauldron/Thermos hybrid servers (Forge mods + Bukkit plugins on one 1.7.10 server). Use when creating or extending a plugin for a 1.7.10 or 1.12.2 server.',
  },
  {
    name: 'minecraft-major-mods',
    description: 'Reference for addon development against major mods across the legacy and modern lines: Thaumcraft, Tinkers Construct, Botania, Twilight Forest, Applied Energistics 2, Mekanism, IndustrialCraft 2, Thermal Expansion, Draconic Evolution and SlashBlade on Minecraft 1.7.10 / 1.12.2, plus Create, Botania, AE2, Mekanism, Ars Nouveau, Farmer\'s Delight, Curios, JEI, REI and Patchouli on 1.20.1 Forge and 1.21.x / 26.x NeoForge. Covers the general addon patterns: soft-dependency detection across Forge/Cauldron/Spigot/NeoForge, compileOnly optional dependencies, curse.maven and Modrinth maven coordinates per mod, and recipe/event integration hooks. Per-mod coordinates and API entry points live in references/api/mods-1.7.10.md, mods-1.12.2.md and mods-modern.md. Use when developing an addon for one of these mods on any version line.',
  },
  {
    name: 'minecraft-intake',
    description: 'Task intake and requirement clarification for Minecraft development (v0.7): when the user asks to create a plugin, mod, or addon but left out critical details, this skill provides the question matrix — Minecraft version, platform / mod loader, server core (Paper family incl. Folia, hybrid cores KCauldron/Thermos/Mohist/CatServer on legacy lines), target mod/plugin compatibility (softdepend list), and deployment (single server vs BungeeCord/Velocity proxy). Rules: ask once in a batch via ask_user_question with (Recommended) options; never re-ask what the user already gave; when the user says "you decide", pick the era default (Paper + current stable line on modern, era-pinned stack on legacy) and state the choice. Use when a Minecraft task lacks version, platform, loader, or compatibility details.',
  },
  {
    name: 'minecraft-porting',
    description: 'Plan and execute cross-version or cross-loader ports of Minecraft mods and plugins: the regenerate-skeleton-then-port-module-by-module procedure, version-family breakpoints (Java/Gradle/mappings/metadata per era from 1.7.10 to 26.x), API rename tables (registries, networking, NBT to DataComponents, ResourceLocation), mapping lookups (MCP/SRG/official/Yarn), and a Forge 1.20.1 to NeoForge 1.21.x migration guide with side-by-side snippets. Use when upgrading a project to a newer Minecraft version, moving between Forge and NeoForge (or Fabric), or asked whether an existing project can be ported. Pair with the mc_port_audit tool for a read-only blocker report before editing.',
  },
  {
    name: 'minecraft-proxy-plugin',
    description: 'Develop Velocity and BungeeCord proxy plugins for Minecraft 1.20.1, 1.21.x and 26.x. Covers velocity-api 4.x with the annotation processor and velocity-plugin.json, @Plugin/@Inject/@Subscribe, login and server-connect events, commands, scheduling, Adventure text and plugin messaging, the BungeeCord 26.1 API as the legacy comparison, player-info forwarding (modern/legacy/bungeeguard) with Paper backend config, and the proxy pitfalls: non-Bukkit plugins, classloader isolation, async events, shutdown order and dependency shading. Use when writing or debugging a proxy-side plugin, or when setting up a Velocity/BungeeCord network.',
  },
  {
    name: 'minecraft-datapack',
    description: 'Develop Minecraft Java data packs for 1.20.1, 1.21.1 and 26.x. Covers pack.mcmeta pack_format values (15 / 48 / 121) and min_format/max_format, the plural-to-singular folder rename in 1.21, functions and macros, the load/tick tags, execute/return/schedule, data-driven registries (recipe, loot_table, advancement, predicate, item_modifier, damage_type, enchantment, jukebox_song, variants) and registry tags, the 1.20.5+ data component model with the 1.20.1 NBT migration, /datapack and /reload limits, and JSON/path debugging. Use when creating or porting a data pack, or when a pack loads but does nothing.',
  },
]

const candidates = SKILLS.map(skill => {
  // skills.js sits at the package root, so assets are a sibling directory
  // (unlike dsh-skill-badge, whose ../ escapes its src/ subdirectory).
  const dir = fileURLToPath(new URL(`./assets/skills/${skill.name}/`, import.meta.url))
  return {
    name: skill.name,
    description: skill.description,
    invocation: { modelInvocable: true, userInvocable: true },
    provider: PROVIDER_NAME,
    source: 'bundled',
    resourceBase: { kind: 'directory', path: dir },
    rank: BUNDLED_SKILL_RANK,
    locator: new URL(`./assets/skills/${skill.name}/SKILL.md`, import.meta.url),
  }
})

const provider = {
  name: PROVIDER_NAME,
  list: () => Promise.resolve([...candidates]),
  async get(candidate) {
    return {
      name: candidate.name,
      description: candidate.description,
      invocation: candidate.invocation,
      provider: candidate.provider,
      source: candidate.source,
      resourceBase: candidate.resourceBase,
      content: await readFile(candidate.locator, 'utf8'),
    }
  },
}

/** Cordis plugin name. */
export const name = 'minecraft-skills'
/** Service required by the bundled provider. */
export const inject = ['skills']

/** Register the bundled Minecraft skills provider on `ctx.skills`. */
export function apply(ctx) {
  ctx.skills.registerProvider(() => provider)
}
