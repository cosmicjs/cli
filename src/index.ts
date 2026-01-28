/**
 * Cosmic CLI
 * AI-powered command-line interface for Cosmic CMS
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { createAuthCommands } from './commands/auth.js';
import { createConfigCommands } from './commands/config.js';
import { createNavigationCommands } from './commands/navigation.js';
import { createObjectsCommands } from './commands/objects.js';
import { createMediaCommands } from './commands/media.js';
import { createWorkflowsCommands } from './commands/workflows.js';
import { createAgentsCommands } from './commands/agents.js';
import { createAICommands } from './commands/ai.js';
import { startChat } from './chat/repl.js';
import { isAuthenticated } from './config/store.js';
import { formatContext, getContextInfo } from './config/context.js';
import { getCurrentUser, getAuthType } from './auth/manager.js';

const VERSION = '1.0.0';

// Create the main program
const program = new Command();

program
  .name('cosmic')
  .description('AI-powered CLI for Cosmic CMS')
  .version(VERSION)
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
createAICommands(program);

// Add chat command (interactive mode)
program
  .command('chat')
  .description('Start interactive AI chat mode')
  .option('-m, --model <model>', 'AI model to use')
  .action(async (options) => {
    await startChat(options);
  });

// Handle no command - show status or start chat
program.action(async () => {
  // If no arguments provided, show welcome and start chat
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    printWelcome();
    
    if (!isAuthenticated()) {
      console.log(chalk.yellow('\nNot logged in.'));
      console.log(`Run ${chalk.cyan('cosmic login')} to authenticate.`);
      console.log(`Or use ${chalk.cyan('cosmic use --bucket=<slug> --read-key=<key>')} for bucket access.`);
      console.log(`\nRun ${chalk.cyan('cosmic --help')} for available commands.`);
      return;
    }

    // Start interactive chat
    await startChat({});
  }
});

/**
 * Print welcome message
 */
function printWelcome(): void {
  console.log();
  console.log(chalk.bold.cyan('  Cosmic CLI') + chalk.dim(` v${VERSION}`));
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
