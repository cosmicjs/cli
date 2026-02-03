/**
 * Shell Command
 * Interactive REPL for Cosmic CLI
 */

import { Command } from 'commander';
import * as readline from 'readline';
import chalk from 'chalk';
import { spawn } from 'child_process';
import {
  getCurrentWorkspaceSlug,
  getCurrentBucketSlug,
  getCurrentProjectSlug,
  isAuthenticated,
  getFreshContext,
} from '../config/store.js';
import { getCurrentUser } from '../auth/manager.js';

const VERSION = '1.0.0';

/**
 * Get the shell prompt string (reads fresh from disk to catch subprocess changes)
 */
function getPrompt(): string {
  // Read fresh context from disk (bypasses cached values)
  const freshContext = getFreshContext();
  const workspace = freshContext.workspace;
  const bucket = freshContext.bucket;

  let context = '';
  if (workspace) {
    context = chalk.cyan(workspace);
  } else {
    context = chalk.dim('default');
  }

  if (bucket) {
    context += chalk.dim('/') + chalk.yellow(bucket);
  }

  return `${chalk.bold.magenta('cosmic')} ${context}${chalk.dim('>')} `;
}

/**
 * Print welcome message
 */
function printWelcome(): void {
  console.log();
  console.log(chalk.bold.cyan('  Cosmic Shell') + chalk.dim(` v${VERSION}`));
  console.log();

  if (isAuthenticated()) {
    const user = getCurrentUser();
    if (user) {
      console.log(`  ${chalk.dim('Logged in as:')} ${chalk.cyan(user.email)}`);
    }
  } else {
    console.log(chalk.yellow('  Not logged in. Run "login" to authenticate.'));
  }

  const workspace = getCurrentWorkspaceSlug();
  const project = getCurrentProjectSlug();
  const bucket = getCurrentBucketSlug();

  if (workspace || project || bucket) {
    const parts = [];
    if (workspace) parts.push(chalk.cyan(workspace));
    if (project) parts.push(chalk.green(project));
    if (bucket) parts.push(chalk.yellow(bucket));
    console.log(`  ${chalk.dim('Context:')} ${parts.join(chalk.dim(' / '))}`);
  }

  console.log();
  console.log(chalk.dim('  Type commands without "cosmic" prefix. Use "!" for system shell.'));
  console.log(chalk.dim('  Type "help" for commands, "exit" to quit.'));
  console.log();
}

/**
 * Print help message
 */
function printHelp(): void {
  console.log();
  console.log(chalk.bold('  Available Commands:'));
  console.log();
  console.log(chalk.cyan('  Navigation'));
  console.log('    ls [path]              List contents');
  console.log('    cd <path>              Navigate to project/bucket/type');
  console.log('    pwd                    Show current location');
  console.log('    use [workspace]        Set workspace (or "-" for default)');
  console.log('    context                Show current context');
  console.log();
  console.log(chalk.cyan('  Content'));
  console.log('    objects list           List objects');
  console.log('    objects get <id>       Get object details');
  console.log('    objects types          List object types');
  console.log('    media list             List media files');
  console.log();
  console.log(chalk.cyan('  AI'));
  console.log('    chat                   Start AI chat');
  console.log('    content                Content mode chat');
  console.log('    build                  Build mode chat');
  console.log('    update [repo]          Update repo mode chat');
  console.log('    ai generate <prompt>   Generate text');
  console.log('    ai image <prompt>      Generate image');
  console.log();
  console.log(chalk.cyan('  Other'));
  console.log('    agents list            List agents');
  console.log('    workflows list         List workflows');
  console.log('    repos list             List repositories');
  console.log('    !<command>             Run system shell command');
  console.log('    help                   Show this help');
  console.log('    exit, quit             Exit shell');
  console.log();
}

/**
 * Execute a system shell command
 */
function executeSystemCommand(command: string): Promise<void> {
  return new Promise((resolve) => {
    const child = spawn(command, {
      shell: true,
      stdio: 'inherit',
    });

    child.on('close', () => {
      resolve();
    });

    child.on('error', (error) => {
      console.error(chalk.red('Error:'), error.message);
      resolve();
    });
  });
}

/**
 * Execute a cosmic command by spawning the CLI
 * Note: We use subprocess spawning because Commander doesn't support
 * calling parseAsync multiple times on the same program instance reliably.
 */
function executeCosmicCommand(args: string[]): Promise<void> {
  // Prevent recursive shell calls
  if (args[0] === 'shell' || args[0] === 'sh') {
    console.log(chalk.yellow('Already in shell mode.'));
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    // Get the path to the cosmic CLI (same as current process)
    const cosmicPath = process.argv[1];

    const child = spawn(process.argv[0], [cosmicPath, ...args], {
      stdio: 'inherit',
    });

    child.on('close', () => {
      resolve();
    });

    child.on('error', (error) => {
      console.error(chalk.red('Error:'), error.message);
      resolve();
    });
  });
}

/**
 * Parse input into command and arguments
 */
function parseInput(input: string): string[] {
  const args: string[] = [];
  let current = '';
  let inQuotes = false;
  let quoteChar = '';

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (inQuotes) {
      if (char === quoteChar) {
        inQuotes = false;
      } else {
        current += char;
      }
    } else if (char === '"' || char === "'") {
      inQuotes = true;
      quoteChar = char;
    } else if (char === ' ') {
      if (current) {
        args.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }

  if (current) {
    args.push(current);
  }

  return args;
}

/**
 * Start the interactive shell
 */
async function startShell(): Promise<void> {
  printWelcome();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: getPrompt(),
    historySize: 100,
  });

  rl.prompt();

  rl.on('line', async (line) => {
    const input = line.trim();

    if (!input) {
      rl.setPrompt(getPrompt());
      rl.prompt();
      return;
    }

    // Handle built-in commands
    if (input === 'exit' || input === 'quit') {
      console.log(chalk.dim('Goodbye!'));
      rl.close();
      return;
    }

    if (input === 'help') {
      printHelp();
      rl.setPrompt(getPrompt());
      rl.prompt();
      return;
    }

    // Handle system shell commands (! prefix)
    if (input.startsWith('!')) {
      const systemCmd = input.slice(1).trim();
      if (systemCmd) {
        await executeSystemCommand(systemCmd);
      }
      rl.setPrompt(getPrompt());
      rl.prompt();
      return;
    }

    // Parse and execute cosmic command directly
    const args = parseInput(input);

    if (args.length > 0) {
      await executeCosmicCommand(args);
    }

    // Update prompt (context may have changed)
    rl.setPrompt(getPrompt());
    rl.prompt();
  });

  rl.on('close', () => {
    process.exit(0);
  });

  // Handle Ctrl+C gracefully
  rl.on('SIGINT', () => {
    console.log();
    console.log(chalk.dim('(Use "exit" to quit)'));
    rl.setPrompt(getPrompt());
    rl.prompt();
  });
}

/**
 * Create shell command
 */
export function createShellCommand(program: Command): void {
  program
    .command('shell')
    .alias('sh')
    .description('Start interactive shell (type commands without "cosmic" prefix)')
    .action(startShell);
}

export default { createShellCommand };
