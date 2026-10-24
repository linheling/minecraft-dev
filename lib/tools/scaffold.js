/**
 * `mc_scaffold` definition, extracted from tools.js so it can be mounted either
 * as part of the combined `minecraft-tools` component or alone through
 * `minecraft-dev/tools-scaffold`. The definition is built by a factory, not
 * registered at import time, because `defineTool` compiles the schema and must
 * only run when the owning component activates.
 * @module minecraft-dev/lib/tools/scaffold
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { SCAFFOLD_DESCRIPTION } from '../descriptions.js'
import { NEXT_OUTPUT_DESCRIPTION, appendNextSteps, scaffoldNextSteps } from '../next-steps.js'
import { scaffoldCallView } from '../present.js'
import { scaffoldProject } from '../scaffold.js'
import { SUPPORTED_PLATFORMS } from '../versions.js'

const SCAFFOLD_OUTPUT_DESCRIPTION = {
  platform: 'The platform scaffolded.',
  minecraftVersion: 'The Minecraft version the project targets.',
  projectDir: 'Absolute path of the created project root.',
  filesCreated: 'Root-relative paths of every file written.',
  buildCommand: 'The shell command that builds the project.',
  wrapperReady: 'Whether the Gradle wrapper files were included.',
}

/** @returns {object} the compiled mc_scaffold tool definition. */
export function createScaffoldTool() {
  return defineTool({
    name: 'mc_scaffold',
    description: SCAFFOLD_DESCRIPTION,
    parameters: {
      platform: {
        type: 'string',
        required: true,
        enum: [...SUPPORTED_PLATFORMS],
        description: `Project platform. Supported: ${SUPPORTED_PLATFORMS.join(', ')}.`,
      },
      targetDir: {
        type: 'string',
        required: true,
        description: 'Absolute path of the new project root directory; must not exist or must be empty.',
      },
      name: {
        type: 'string',
        required: true,
        description: 'Project name in lowercase kebab-case (e.g. my-plugin); used as the jar name and plugin/mod id.',
      },
      packageName: {
        type: 'string',
        required: true,
        description: 'Java package name, e.g. com.example.myplugin.',
      },
      minecraftVersion: {
        type: 'string',
        required: true,
        description: 'Target Minecraft version, e.g. 1.7.10, 1.12.2, 1.16.5, 1.21.8, 1.21.x, 26.3. Supported lines per platform are listed in the error when unknown.',
      },
      javaVersion: {
        type: 'integer',
        enum: [8, 17, 21, 25],
        description: 'Java language level (8, 17, 21, or 25). Omit to use the era default: 8 for the 1.7.10/1.12.2/1.16.5 lines (spigot/forge); 17 for fabric/neoforge 1.20.x; 21 for paper 1.20.x and the 1.21.x lines; 25 for 26.x.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          platform: { type: 'string', required: true, description: SCAFFOLD_OUTPUT_DESCRIPTION.platform },
          minecraftVersion: { type: 'string', required: true, description: SCAFFOLD_OUTPUT_DESCRIPTION.minecraftVersion },
          projectDir: { type: 'string', required: true, description: SCAFFOLD_OUTPUT_DESCRIPTION.projectDir },
          filesCreated: {
            type: 'array',
            required: true,
            items: { type: 'string' },
            description: SCAFFOLD_OUTPUT_DESCRIPTION.filesCreated,
          },
          buildCommand: { type: 'string', required: true, description: SCAFFOLD_OUTPUT_DESCRIPTION.buildCommand },
          wrapperReady: { type: 'boolean', required: true, description: SCAFFOLD_OUTPUT_DESCRIPTION.wrapperReady },
          next: {
            type: 'array',
            required: true,
            items: { type: 'string' },
            description: NEXT_OUTPUT_DESCRIPTION,
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: appendNextSteps(
          `Created ${value.platform} project ${value.projectDir} for Minecraft ${value.minecraftVersion} `
          + `(${value.filesCreated.length} files, Gradle wrapper included). `
          + `Build with: ${value.buildCommand} — the first build downloads dependencies and takes several minutes.`
          + (value.platform === 'spigot' && value.minecraftVersion.startsWith('1.7')
            ? `\nNote: before building, place the vendored API jar into ${value.projectDir}\\libs\\ per libs/README.txt (no public maven hosts 1.7.10 spigot-api).`
            : ''),
          value.next,
        ),
      }],
    },
    async execute(args, exec) {
      const value = await scaffoldProject({
        platform: args.platform,
        targetDir: args.targetDir,
        name: args.name,
        packageName: args.packageName,
        minecraftVersion: args.minecraftVersion,
        javaVersion: args.javaVersion,
        signal: exec.signal,
      })
      return { ...value, next: scaffoldNextSteps(value) }
    },
    presentCall: scaffoldCallView,
  })
}
