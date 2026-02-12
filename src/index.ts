/**
 * Cosmic CLI
 * AI-powered command-line interface for Cosmic CMS
 */

// Load environment variables from .env file (optional, for development)
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Try to load .env from the CLI package directory (for development)
// This is optional - the CLI works without it
const envPath = join(__dirname, '..', '.env');
if (existsSync(envPath)) {
  // Dynamic import to avoid issues if dotenv isn't available
  try {
    const dotenv = await import('dotenv');
    dotenv.config({ path: envPath });
  } catch {
    // Silently ignore if dotenv fails
  }
}

import { Command } from 'commander';
import chalk from 'chalk';
import { createAuthCommands } from './commands/auth.js';
import { createConfigCommands } from './commands/config.js';
import { createNavigationCommands } from './commands/navigation.js';
import { createObjectsCommands } from './commands/objects.js';
import { createMediaCommands } from './commands/media.js';
import { createWorkflowsCommands } from './commands/workflows.js';
import { createAgentsCommands } from './commands/agents.js';
import { createReposCommands } from './commands/repos.js';
import { createDeployCommands } from './commands/deploy.js';
import { createAICommands } from './commands/ai.js';
import { createTypesCommands } from './commands/types.js';
import { createWebhooksCommands } from './commands/webhooks.js';
import { createTeamCommands } from './commands/team.js';
import { createDomainsCommands } from './commands/domains.js';
import { createBillingCommands } from './commands/billing.js';
import { createShellCommand } from './commands/shell.js';
import { startChat } from './chat/repl.js';
import { isAuthenticated } from './config/store.js';
import { formatContext, getContextInfo } from './config/context.js';
import { getCurrentUser, getAuthType } from './auth/manager.js';
import { CLI_VERSION } from './version.js';
import { checkClientVersion } from './api/versionCheck.js';

// Create the main program
const program = new Command();

program
  .name('cosmic')
  .description('AI-powered CLI for Cosmic CMS')
  .version(CLI_VERSION)
  .option('-v, --verbose', 'Enable verbose output')
  .option('--no-color', 'Disable colored output');

// Register all command groups
createAuthCommands(program);
createConfigCommands(program);
createNavigationCommands(program);
createObjectsCommands(program);
createMediaCommands(program);
createWorkflowsCommands(program);
createAgentsCommands(program);
createReposCommands(program);
createDeployCommands(program);
createAICommands(program);
createTypesCommands(program);
createWebhooksCommands(program);
createTeamCommands(program);
createDomainsCommands(program);
createBillingCommands(program);
createShellCommand(program);

// Add chat command (interactive mode)
program
  .command('chat')
  .description('Start interactive AI chat (defaults to ask mode - read-only questions)')
  .option('-m, --model <model>', 'AI model to use')
  .option('--ask', 'Ask mode - read-only questions, no changes')
  .option('-c, --content', 'Start in content mode (create/update content with AI)')
  .option('-b, --build', 'Start in app building mode')
  .option('-a, --automate', 'Start in automation mode (create agents and workflows with AI)')
  .option('-r, --repo [name]', 'Start in repository update mode')
  .option('--branch <branch>', 'Branch to use in repo mode (default: main)')
  .option('-p, --prompt <prompt>', 'Start with an initial prompt')
  .option('-t, --types <types>', 'Object type slugs to include as context (comma-separated)')
  .option('-l, --links <urls>', 'External URLs to include as context (comma-separated)')
  .option('--objects-limit <n>', 'Max objects per type for context (default: 10 for content, 100 for build)')
  .option('--objects-depth <n>', 'Object depth for nested metafields (default: 1)')
  .action(async (options) => {
    let initialPrompt = options.prompt;

    // If --build flag is used, set a helpful initial prompt
    if (options.build && !initialPrompt) {
      initialPrompt = 'I want to build an app. Ask me what kind of app I want to create, which framework I prefer (Next.js, React, Astro, Vue, etc.), and any specific features I need. Then generate the complete application code.';
    }

    // Parse context options
    const context: { objectTypes?: string[]; links?: string[]; objectsLimit?: number; objectsDepth?: number } = {};
    if (options.types) {
      context.objectTypes = options.types.split(',').map((t: string) => t.trim());
    }
    if (options.links) {
      context.links = options.links.split(',').map((l: string) => l.trim());
    }
    if (options.objectsLimit) {
      context.objectsLimit = parseInt(options.objectsLimit, 10);
    }
    if (options.objectsDepth) {
      context.objectsDepth = parseInt(options.objectsDepth, 10);
    }

    // In repo mode, don't set an initial prompt - let the user type their request
    // The CLI will show a greeting and wait for input
    await startChat({
      model: options.model,
      initialPrompt: options.repo ? undefined : initialPrompt, // No auto-prompt for repo mode
      buildMode: options.build,
      contentMode: options.content,
      automateMode: options.automate,
      repoMode: !!options.repo,
      repoName: typeof options.repo === 'string' ? options.repo : undefined,
      repoBranch: options.branch,
      askMode: options.ask || (!options.build && !options.content && !options.repo && !options.automate), // Explicit --ask or default when no mode flags
      context: Object.keys(context).length > 0 ? context : undefined,
    });
  });

// Add content command (shortcut to chat --content)
program
  .command('content')
  .description('Create and manage content with AI (create objects, generate text, etc.)')
  .option('-m, --model <model>', 'AI model to use')
  .option('-p, --prompt <prompt>', 'Describe the content you want to create')
  .option('-a, --ask', 'Ask mode - questions about content without making changes')
  .option('-t, --types <types>', 'Object type slugs to work with (comma-separated)')
  .option('-l, --links <urls>', 'External URLs to include as context (comma-separated)')
  .option('--objects-limit <n>', 'Max objects per type for context (default: 10)')
  .option('--objects-depth <n>', 'Object depth for nested metafields (default: 1)')
  .action(async (options) => {
    const context: { objectTypes?: string[]; links?: string[]; objectsLimit?: number; objectsDepth?: number } = {};
    if (options.types) {
      context.objectTypes = options.types.split(',').map((t: string) => t.trim());
    }
    if (options.links) {
      context.links = options.links.split(',').map((l: string) => l.trim());
    }
    if (options.objectsLimit) {
      context.objectsLimit = parseInt(options.objectsLimit, 10);
    }
    if (options.objectsDepth) {
      context.objectsDepth = parseInt(options.objectsDepth, 10);
    }

    await startChat({
      model: options.model,
      initialPrompt: options.prompt,
      contentMode: true,
      askMode: options.ask || false,
      context: Object.keys(context).length > 0 ? context : undefined,
    });
  });

// Add build command (shortcut to chat --build)
program
  .command('build')
  .description('Build a new app with AI (generates code, creates repo, deploys)')
  .option('-m, --model <model>', 'AI model to use')
  .option('-p, --prompt <prompt>', 'Describe the app you want to build')
  .option('-a, --ask', 'Ask mode - questions about the app without generating code')
  .option('-t, --types <types>', 'Object type slugs to include as context (comma-separated)')
  .option('-l, --links <urls>', 'External URLs to include as context (comma-separated)')
  .option('--objects-limit <n>', 'Max objects per type for context (default: 100)')
  .option('--objects-depth <n>', 'Object depth for nested metafields (default: 1)')
  .action(async (options) => {
    const context: { objectTypes?: string[]; links?: string[]; objectsLimit?: number; objectsDepth?: number } = {};
    if (options.types) {
      context.objectTypes = options.types.split(',').map((t: string) => t.trim());
    }
    if (options.links) {
      context.links = options.links.split(',').map((l: string) => l.trim());
    }
    if (options.objectsLimit) {
      context.objectsLimit = parseInt(options.objectsLimit, 10);
    }
    if (options.objectsDepth) {
      context.objectsDepth = parseInt(options.objectsDepth, 10);
    }

    const isAskMode = options.ask || false;
    const initialPrompt = isAskMode
      ? (options.prompt
        ? `I have questions about building an app: ${options.prompt}`
        : undefined)  // No auto-prompt in ask mode - let user type their question
      : options.prompt
        ? `Build me an app: ${options.prompt}. Generate the complete application code.`
        : 'I want to build an app. Ask me what kind of app I want to create, which framework I prefer (Next.js, React, Astro, Vue, etc.), and any specific features I need. Then generate the complete application code.';

    await startChat({
      model: options.model,
      initialPrompt,
      buildMode: true,
      askMode: isAskMode,
      context: Object.keys(context).length > 0 ? context : undefined,
    });
  });

// Add automate command (shortcut to chat --automate)
program
  .command('automate')
  .description('Set up AI agents and workflows with natural language')
  .option('-m, --model <model>', 'AI model to use')
  .option('-p, --prompt <prompt>', 'Describe what you want to automate')
  .option('-a, --ask', 'Ask mode - questions about automation without creating anything')
  .action(async (options) => {
    await startChat({
      model: options.model,
      initialPrompt: options.prompt,
      automateMode: true,
      askMode: options.ask || false,
    });
  });

// Add update command (shortcut to chat --repo)
program
  .command('update [repo]')
  .description('Update an existing app with AI (edits code, commits, deploys)')
  .option('-m, --model <model>', 'AI model to use')
  .option('-b, --branch <branch>', 'Branch to update (default: main)')
  .option('-p, --prompt <prompt>', 'Describe the changes you want')
  .option('-a, --ask', 'Ask mode - explore/understand code without making changes')
  .option('-t, --types <types>', 'Object type slugs to include as context (comma-separated)')
  .option('-l, --links <urls>', 'External URLs to include as context (comma-separated)')
  .option('--objects-limit <n>', 'Max objects per type for context (default: 100)')
  .option('--objects-depth <n>', 'Object depth for nested metafields (default: 1)')
  .action(async (repoArg, options) => {
    const context: { objectTypes?: string[]; links?: string[]; objectsLimit?: number; objectsDepth?: number } = {};
    if (options.types) {
      context.objectTypes = options.types.split(',').map((t: string) => t.trim());
    }
    if (options.links) {
      context.links = options.links.split(',').map((l: string) => l.trim());
    }
    if (options.objectsLimit) {
      context.objectsLimit = parseInt(options.objectsLimit, 10);
    }
    if (options.objectsDepth) {
      context.objectsDepth = parseInt(options.objectsDepth, 10);
    }

    // Only set initial prompt if explicitly provided via -p flag
    // Otherwise, let user type their request after seeing the greeting
    await startChat({
      model: options.model,
      initialPrompt: options.prompt, // undefined if not provided
      repoMode: true,
      repoName: repoArg,
      repoBranch: options.branch,
      askMode: options.ask || false, // Allow ask mode in repo mode if --ask flag is provided
      context: Object.keys(context).length > 0 ? context : undefined,
    });
  });

// Handle no command - show status and help
program.action(async () => {
  // If no arguments provided, show welcome and available commands
  const args = process.argv.slice(2);

  if (args.length === 0) {
    printWelcome();

    if (!isAuthenticated()) {
      console.log(chalk.yellow('Not logged in.'));
      console.log(`Run ${chalk.cyan('cosmic login')} to authenticate.`);
      console.log(`Or use ${chalk.cyan('cosmic use --bucket=<slug> --read-key=<key>')} for bucket access.`);
    }

    // Show available commands
    console.log(chalk.dim('Available commands:'));
    console.log(`  ${chalk.cyan('cosmic shell')}      ${chalk.bold('Interactive shell')} (no "cosmic" prefix needed)`);
    console.log(`  ${chalk.cyan('cosmic chat')}       Start interactive AI chat mode`);
    console.log(`  ${chalk.cyan('cosmic content')}    ${chalk.yellow('Create/manage content with AI')}`);
    console.log(`  ${chalk.cyan('cosmic build')}      ${chalk.green('Build an app with AI')} (creates repo & deploys)`);
    console.log(`  ${chalk.cyan('cosmic automate')}   ${chalk.blue('Set up AI agents & workflows')} with natural language`);
    console.log(`  ${chalk.cyan('cosmic update')}     ${chalk.magenta('Update an app with AI')} (edits code & deploys)`);
    console.log(`  ${chalk.cyan('cosmic login')}      Login to your Cosmic account`);
    console.log(`  ${chalk.cyan('cosmic projects')}   List and manage projects`);
    console.log(`  ${chalk.cyan('cosmic cd')}         Navigate to project/bucket`);
    console.log(`  ${chalk.cyan('cosmic ls')}         List objects in current bucket`);
    console.log(`  ${chalk.cyan('cosmic media')}      Media file operations`);
    console.log(`  ${chalk.cyan('cosmic types')}      Object type management`);
    console.log(`  ${chalk.cyan('cosmic webhooks')}   Webhook management`);
    console.log(`  ${chalk.cyan('cosmic team')}       Team member management`);
    console.log(`  ${chalk.cyan('cosmic domains')}    Domain & DNS management`);
    console.log(`  ${chalk.cyan('cosmic billing')}    Billing, plans & usage`);
    console.log(`  ${chalk.cyan('cosmic workflows')}  Workflow operations`);
    console.log(`  ${chalk.cyan('cosmic agents')}     AI agent operations`);
    console.log(`  ${chalk.cyan('cosmic repos')}      Repository management`);
    console.log(`  ${chalk.cyan('cosmic deploy')}     Deployment operations`);
    console.log();
    console.log(`Run ${chalk.cyan('cosmic --help')} for all commands and options.`);
  }
});

/**
 * Print welcome message
 */
function printWelcome(): void {
  console.log();
  console.log(chalk.bold.cyan('  Cosmic CLI') + chalk.dim(` v${CLI_VERSION}`));
  console.log();

  const authType = getAuthType();

  if (authType === 'user') {
    const user = getCurrentUser();
    if (user) {
      console.log(`  ${chalk.dim('Logged in as:')} ${chalk.cyan(user.email)}`);
    }
  } else if (authType === 'bucket') {
    console.log(`  ${chalk.dim('Using bucket keys')}`);
  }

  const { hasContext, formatted } = getContextInfo();
  if (hasContext) {
    console.log(`  ${chalk.dim('Context:')} ${formatted}`);
  }

  console.log();
}

// Error handling
program.exitOverride();

async function main(): Promise<void> {
  try {
    // Non-blocking version check - warns if CLI is outdated but never blocks
    await checkClientVersion();

    await program.parseAsync(process.argv);
  } catch (error) {
    if ((error as Error).name === 'CommanderError') {
      // Commander already handled the error
      return;
    }

    console.error(chalk.red('Error:'), (error as Error).message);
    process.exit(1);
  }
}

main();
