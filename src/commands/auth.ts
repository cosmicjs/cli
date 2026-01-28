/**
 * Auth Commands
 * Login, logout, and user management
 */

import { Command } from 'commander';
import chalk from 'chalk';
import open from 'open';
import {
  authenticateWithPassword,
  authenticateWithBucketKeys,
  logout as authLogout,
  getCurrentUser,
  getAuthType,
  validateAuth,
} from '../auth/manager.js';
import { isAuthenticated } from '../config/store.js';
import { formatContext } from '../config/context.js';
import * as display from '../utils/display.js';
import * as prompts from '../utils/prompts.js';
import * as spinner from '../utils/spinner.js';

/**
 * Login command
 */
async function login(options: { email?: string; password?: string }): Promise<void> {
  // Check if already logged in
  if (isAuthenticated()) {
    const user = getCurrentUser();
    if (user) {
      display.warning(`Already logged in as ${user.email}`);
      const shouldLogout = await prompts.confirm({
        message: 'Do you want to log out and log in with a different account?',
      });
      if (!shouldLogout) {
        return;
      }
      authLogout();
    }
  }

  // Get email
  const email =
    options.email ||
    (await prompts.text({
      message: 'Email:',
      required: true,
    }));

  // Get password
  const password =
    options.password ||
    (await prompts.password({
      message: 'Password:',
      required: true,
    }));

  try {
    spinner.start('Authenticating...');
    let result = await authenticateWithPassword(email, password);
    
    // Handle 2FA if required
    if (result.requires2FA) {
      spinner.stop();
      display.info('Two-factor authentication required');
      
      const otp = await prompts.text({
        message: 'Enter your 2FA code:',
        required: true,
      });
      
      spinner.start('Verifying 2FA...');
      result = await authenticateWithPassword(email, password, otp);
    }
    
    spinner.succeed(`Logged in as ${chalk.cyan(result.user.email)}`);

    display.newline();
    display.info(
      `Run ${chalk.cyan('cosmic use <workspace>/<project>/<bucket>')} to set your working context.`
    );
  } catch (error) {
    spinner.fail('Authentication failed');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Logout command
 */
function logout(): void {
  const user = getCurrentUser();

  if (!isAuthenticated()) {
    display.info('Not logged in');
    return;
  }

  authLogout();

  if (user) {
    display.success(`Logged out from ${user.email}`);
  } else {
    display.success('Logged out');
  }
}

/**
 * Whoami command - show current user info
 */
async function whoami(): Promise<void> {
  const authType = getAuthType();

  if (authType === 'none') {
    display.error('Not authenticated');
    display.info(`Run ${chalk.cyan('cosmic login')} to authenticate`);
    process.exit(1);
  }

  if (authType === 'bucket') {
    display.info('Authenticated with bucket keys');
    display.keyValue('Context', formatContext());
    return;
  }

  // User auth
  const user = getCurrentUser();

  if (!user) {
    // Try to fetch user from API
    try {
      spinner.start('Fetching user info...');
      const isValid = await validateAuth();
      spinner.stop();

      if (!isValid) {
        display.error('Session expired. Please log in again.');
        process.exit(1);
      }

      const updatedUser = getCurrentUser();
      if (updatedUser) {
        displayUserInfo(updatedUser);
      }
    } catch (error) {
      spinner.fail('Failed to fetch user info');
      display.error((error as Error).message);
      process.exit(1);
    }
  } else {
    displayUserInfo(user);
  }
}

/**
 * Display user info
 */
function displayUserInfo(user: { email: string; first_name?: string; last_name?: string }): void {
  display.header('Current User');
  display.keyValue('Email', user.email);
  if (user.first_name || user.last_name) {
    display.keyValue('Name', `${user.first_name || ''} ${user.last_name || ''}`.trim());
  }
  display.keyValue('Context', formatContext());
}

/**
 * Create auth commands
 */
export function createAuthCommands(program: Command): void {
  program
    .command('login')
    .description('Authenticate with Cosmic')
    .option('-e, --email <email>', 'Email address')
    .option('-p, --password <password>', 'Password')
    .action(login);

  program
    .command('logout')
    .description('Clear authentication credentials')
    .action(logout);

  program
    .command('whoami')
    .description('Show current user information')
    .action(whoami);
}

export default { createAuthCommands };
