/**
 * Config Commands
 * Context and configuration management
 */

import { Command } from 'commander';
import chalk from 'chalk';
import {
  getConfig,
  setConfigValue,
  getCurrentBucketSlug,
  getCurrentWorkspaceSlug,
  getCurrentWorkspaceId,
  getCurrentProjectSlug,
  getDefaultModel,
  setContext,
  getConfigDir,
  setCredentials,
  getCredentials,
  getApiUrl,
} from '../config/store.js';
import { authenticateWithBucketKeys } from '../auth/manager.js';
import { formatContext, setContextFromString } from '../config/context.js';
import * as display from '../utils/display.js';
import * as spinner from '../utils/spinner.js';
import * as prompts from '../utils/prompts.js';
import * as api from '../api/dashboard.js';
import { clearSDKClient, getBucketKeys, getApiEnv } from '../api/sdk.js';
import { createProject } from './navigation.js';

/**
 * Look up workspace ID from slug
 */
async function lookupWorkspaceId(workspaceSlug: string): Promise<string | undefined> {
  try {
    const workspaces = await api.listWorkspaces();
    const workspace = workspaces.find(ws => ws.slug === workspaceSlug || ws.id === workspaceSlug);
    return workspace?.id;
  } catch {
    return undefined;
  }
}

/**
 * Use command - set working context
 */
async function use(
  contextString: string | undefined,
  options: {
    bucket?: string;
    readKey?: string;
    writeKey?: string;
    workspace?: string;
    project?: string;
  }
): Promise<void> {
  // If bucket keys are provided, use bucket key auth
  if (options.bucket && options.readKey) {
    authenticateWithBucketKeys(options.bucket, options.readKey, options.writeKey);
    setContext(undefined, undefined, options.bucket);
    display.success(`Configured bucket key auth for ${chalk.cyan(options.bucket)}`);
    return;
  }

  // If context string is provided (workspace/project/bucket format)
  if (contextString) {
    const parts = contextString.split('/').filter(Boolean);
    const workspaceSlug = parts[0];
    const projectSlug = parts[1];
    const bucket = parts[2];

    // Look up workspace ID
    let workspaceId: string | undefined;
    if (workspaceSlug) {
      spinner.start('Looking up workspace...');
      workspaceId = await lookupWorkspaceId(workspaceSlug);
      spinner.stop();
      if (!workspaceId) {
        display.error(`Workspace "${workspaceSlug}" not found`);
        process.exit(1);
      }
    }

    setContext(workspaceSlug, projectSlug, bucket, workspaceId, undefined);
    display.success(`Context set to ${formatContext()}`);
    return;
  }

  // If individual options are provided
  if (options.workspace || options.project) {
    let workspaceId: string | undefined;
    if (options.workspace) {
      spinner.start('Looking up workspace...');
      workspaceId = await lookupWorkspaceId(options.workspace);
      spinner.stop();
      if (!workspaceId) {
        display.error(`Workspace "${options.workspace}" not found`);
        process.exit(1);
      }
    }
    setContext(options.workspace, options.project, options.bucket, workspaceId, undefined);
    display.success(`Context set to ${formatContext()}`);
    return;
  }

  // No arguments - show interactive selection
  try {
    spinner.start('Loading workspaces...');
    const workspaces = await api.listWorkspaces();
    spinner.stop();

    if (workspaces.length === 0) {
      display.warning('No workspaces found');
      return;
    }

    display.header('Available Workspaces');
    workspaces.forEach((ws, index) => {
      console.log(`  ${chalk.dim(String(index + 1) + '.')} ${chalk.cyan(ws.slug || ws.id)} - ${ws.title}`);
    });

    display.newline();
    display.info(
      `Use ${chalk.cyan('cosmic use <workspace>/<project>/<bucket>')} to set context`
    );
  } catch (error) {
    spinner.fail('Failed to load workspaces');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Context command - show current context
 */
function context(): void {
  display.header('Current Context');
  display.keyValue('Workspace', getCurrentWorkspaceSlug() || chalk.dim('not set'));
  display.keyValue('Project', getCurrentProjectSlug() || chalk.dim('not set'));
  display.keyValue('Bucket', getCurrentBucketSlug() || chalk.dim('not set'));
  display.keyValue('Model', getDefaultModel());

  // Show API environment
  const apiEnv = getApiEnv();
  if (apiEnv === 'staging') {
    display.keyValue('Environment', chalk.yellow('staging'));
  } else {
    display.keyValue('Environment', chalk.dim('production'));
  }

  // Show Dashboard API URL
  const dapiUrl = getApiUrl();
  const isCustomDapi = process.env.COSMIC_DAPI_URL;
  if (isCustomDapi) {
    display.keyValue('DAPI URL', chalk.yellow(dapiUrl) + chalk.dim(' (custom)'));
  } else {
    display.keyValue('DAPI URL', chalk.dim(dapiUrl));
  }

  // Show API environment
  display.keyValue('API Environment', getApiEnv());

  display.newline();
  display.dim(`Config stored in: ${getConfigDir()}`);
}

/**
 * Config set command
 */
function configSet(key: string, value: string): void {
  const validKeys = ['defaultModel', 'apiUrl', 'sdkUrl'] as const;

  if (!validKeys.includes(key as any)) {
    display.error(`Invalid config key: ${key}`);
    display.info(`Valid keys: ${validKeys.join(', ')}`);
    process.exit(1);
  }

  setConfigValue(key as 'defaultModel' | 'apiUrl' | 'sdkUrl', value);
  display.success(`Set ${chalk.cyan(key)} to ${chalk.green(value)}`);

  // Clear SDK client cache if URL changed
  if (key === 'sdkUrl') {
    clearSDKClient();
    display.info('SDK client cache cleared. New URL will be used on next request.');
  }
}

/**
 * Config get command
 */
function configGet(key?: string): void {
  const config = getConfig();

  if (key) {
    const value = (config as Record<string, unknown>)[key];
    if (value !== undefined) {
      console.log(value);
    } else {
      display.error(`Config key not found: ${key}`);
      process.exit(1);
    }
    return;
  }

  // Show all config
  display.header('Configuration');
  for (const [k, v] of Object.entries(config)) {
    display.keyValue(k, v as string);
  }
}

/**
 * Workspaces command - list workspaces
 */
async function workspaces(): Promise<void> {
  try {
    spinner.start('Loading workspaces...');
    const workspaceList = await api.listWorkspaces();
    spinner.succeed(`Found ${workspaceList.length} workspace(s)`);

    if (workspaceList.length === 0) {
      display.info('No workspaces found');
      return;
    }

    display.newline();
    console.log(chalk.bold.cyan('  Slug/ID                  Title                          Created'));
    console.log(chalk.dim('  ' + '─'.repeat(70)));

    for (const ws of workspaceList) {
      const wsAny = ws as Record<string, unknown>;
      const slug = String(wsAny.slug || wsAny.id || '-').substring(0, 24).padEnd(24);
      const title = display.truncate(String(wsAny.title || '-'), 30).padEnd(30);
      const created = wsAny.created_at || wsAny.createdAt || wsAny.created;

      console.log(`  ${chalk.cyan(slug)} ${title} ${display.formatDate(created as string)}`);
    }

    display.newline();
  } catch (error) {
    spinner.fail('Failed to load workspaces');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Projects command - list projects
 */
async function projects(options: { workspace?: string; all?: boolean } = {}): Promise<void> {
  // Use provided ID, or stored workspace ID, or look up by stored slug
  let wsId = options.workspace || getCurrentWorkspaceId();

  if (!wsId && !options.all) {
    // Try to look up by slug if we have one
    const wsSlug = getCurrentWorkspaceSlug();
    if (wsSlug) {
      spinner.start('Looking up workspace...');
      wsId = await lookupWorkspaceId(wsSlug);
      spinner.stop();
    }
  }

  try {
    spinner.start('Loading projects...');
    // If no workspace ID, this will list default/unassigned projects
    const projectList = await api.listProjects(wsId);
    if (wsId) {
      spinner.succeed(`Found ${projectList.length} project(s) in workspace`);
    } else {
      spinner.succeed(`Found ${projectList.length} default project(s)`);
    }

    if (projectList.length === 0) {
      display.info('No projects found');
      return;
    }

    // Debug: log first project structure if DEBUG env is set
    if (process.env.DEBUG && projectList[0]) {
      console.log('DEBUG: First project structure:', JSON.stringify(projectList[0], null, 2));
    }

    display.newline();
    console.log(chalk.bold.cyan('  ID                       Title                          Created'));
    console.log(chalk.dim('  ' + '─'.repeat(70)));

    for (const proj of projectList) {
      // Handle different possible field names from API
      const projAny = proj as Record<string, unknown>;
      const id = String(projAny.id || projAny._id || '-').substring(0, 24).padEnd(24);
      const title = display.truncate(String(projAny.title || projAny.name || '-'), 30).padEnd(30);
      const created = projAny.created_at || projAny.createdAt || projAny.created;

      console.log(`  ${chalk.cyan(id)} ${title} ${display.formatDate(created as string)}`);
    }

    display.newline();
    console.log(chalk.dim(`  Use ${chalk.cyan('cosmic cd <project-id>')} to navigate to a project.`));
    display.newline();
  } catch (error) {
    spinner.fail('Failed to load projects');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Models command - list available AI models
 */
async function models(): Promise<void> {
  try {
    const bucketSlug = getCurrentBucketSlug();
    if (!bucketSlug) {
      display.error('No bucket selected. Navigate to a bucket first with: cosmic cd <project>/<bucket>');
      process.exit(1);
    }

    spinner.start('Loading models...');
    const modelList = await api.listModels(bucketSlug);
    spinner.succeed(`Found ${modelList.length} model(s)`);

    if (modelList.length === 0) {
      display.info('No models found');
      return;
    }

    const defaultModel = getDefaultModel();

    console.log();
    console.log(chalk.bold('  Available AI Models:'));
    console.log(chalk.dim('  ' + '─'.repeat(70)));

    for (const model of modelList) {
      if (!model) continue;

      const modelAny = model as Record<string, unknown>;
      const id = String(modelAny.id || modelAny._id || 'unknown');
      const name = String(modelAny.name || id);
      const provider = String(modelAny.provider || '-');
      const isDefault = id === defaultModel;

      if (isDefault) {
        console.log(chalk.green(`  ✓ ${id.padEnd(35)} ${name.padEnd(25)} ${provider}`));
      } else {
        console.log(`    ${id.padEnd(35)} ${name.padEnd(25)} ${chalk.dim(provider)}`);
      }
    }

    display.newline();
    display.info(
      `Use ${chalk.cyan('cosmic config set defaultModel <model-id>')} to set default model`
    );
  } catch (error) {
    spinner.fail('Failed to load models');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Keys command - manage bucket API keys
 */
async function keys(action?: string): Promise<void> {
  const currentKeys = getBucketKeys();

  if (!action || action === 'show') {
    // Show current keys
    display.header('Bucket API Keys');
    display.keyValue('Bucket', currentKeys.bucketSlug || chalk.dim('(not set)'));
    display.keyValue('Read Key', currentKeys.readKey
      ? chalk.dim(currentKeys.readKey.substring(0, 8) + '...')
      : chalk.dim('(not set)'));
    display.keyValue('Write Key', currentKeys.writeKey
      ? chalk.dim(currentKeys.writeKey.substring(0, 8) + '...')
      : chalk.dim('(not set)'));

    if (!currentKeys.writeKey) {
      display.newline();
      display.info(`Use ${chalk.cyan('cosmic keys set')} to configure bucket keys for AI features.`);
    }
    return;
  }

  if (action === 'set') {
    // Prompt for bucket keys
    const bucketSlug = await prompts.text({
      message: 'Bucket slug:',
      initial: currentKeys.bucketSlug || getCurrentBucketSlug() || '',
      required: true,
    });

    const readKey = await prompts.text({
      message: 'Read key:',
      initial: currentKeys.readKey || '',
      required: true,
    });

    const writeKey = await prompts.text({
      message: 'Write key:',
      initial: currentKeys.writeKey || '',
      required: true,
    });

    // Store the keys
    setCredentials({
      bucketSlug,
      readKey,
      writeKey,
    });

    // Clear SDK client cache so it uses new keys
    clearSDKClient();

    display.success('Bucket keys saved successfully!');
    display.info(`AI features will now use the ${chalk.cyan(bucketSlug)} bucket.`);
    return;
  }

  if (action === 'clear') {
    setCredentials({
      bucketSlug: undefined,
      readKey: undefined,
      writeKey: undefined,
    });
    clearSDKClient();
    display.success('Bucket keys cleared.');
    return;
  }

  display.error(`Unknown action: ${action}. Use 'show', 'set', or 'clear'.`);
}

/**
 * Create config commands
 */
export function createConfigCommands(program: Command): void {
  program
    .command('use [context]')
    .description('Set working context (workspace/project/bucket)')
    .option('-b, --bucket <slug>', 'Bucket slug')
    .option('-r, --read-key <key>', 'Bucket read key')
    .option('-w, --write-key <key>', 'Bucket write key')
    .option('--workspace <slug>', 'Workspace slug')
    .option('--project <slug>', 'Project slug')
    .action(use);

  program
    .command('context')
    .description('Show current working context')
    .action(context);

  program
    .command('workspaces')
    .alias('ws')
    .description('List workspaces')
    .action(workspaces);

  // Projects command with subcommands
  const projectsCmd = program
    .command('projects')
    .alias('proj')
    .description('Manage projects');

  projectsCmd
    .command('list')
    .description('List projects (in workspace or default)')
    .option('--workspace <id>', 'Workspace ID')
    .option('--default', 'List default projects (not in any workspace)')
    .action((options) => projects({ workspace: options.workspace, all: options.default }));

  projectsCmd
    .command('create')
    .description('Create a new project')
    .action(createProject);

  // Default action for 'projects' without subcommand is to list
  projectsCmd.action((options) => projects({ workspace: options.workspace, all: options.default }));

  program
    .command('models')
    .description('List available AI models')
    .action(models);

  program
    .command('keys [action]')
    .description('Manage bucket API keys (show, set, clear)')
    .action(keys);

  // Config subcommand
  const configCmd = program
    .command('config')
    .description('Manage configuration');

  configCmd
    .command('set <key> <value>')
    .description('Set a configuration value')
    .action(configSet);

  configCmd
    .command('get [key]')
    .description('Get configuration value(s)')
    .action(configGet);
}

export default { createConfigCommands };
