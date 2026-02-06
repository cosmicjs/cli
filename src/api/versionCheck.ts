/**
 * CLI Version Check
 * Checks the DAPI for minimum version requirements and warns if the CLI is outdated.
 * This is advisory only -- it never blocks the CLI from running.
 */

import axios from 'axios';
import chalk from 'chalk';
import { getApiUrl } from '../config/store.js';
import { CLI_VERSION } from '../version.js';

/**
 * Simple semver comparison: returns -1 if a < b, 0 if equal, 1 if a > b.
 * Only handles standard major.minor.patch versions.
 */
function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);

  for (let i = 0; i < 3; i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

/**
 * Check if the current CLI version meets the server's minimum requirements.
 * Runs with a short timeout and never throws -- failures are silently ignored.
 */
export async function checkClientVersion(): Promise<void> {
  try {
    const apiUrl = getApiUrl();
    const response = await axios.get(`${apiUrl}/client-requirements`, {
      timeout: 3000,
      headers: {
        'User-Agent': `CosmicCLI/${CLI_VERSION}`,
        'X-Cosmic-Client': 'cli',
      },
    });

    const { cli } = response.data;
    if (!cli) return;

    // Show urgent server message if present
    if (cli.message) {
      console.log(chalk.yellow(`  [Cosmic] ${cli.message}`));
      console.log();
    }

    // Check minimum version
    if (cli.minVersion && compareSemver(CLI_VERSION, cli.minVersion) < 0) {
      console.log(chalk.yellow(`  Warning: Your CLI version (${CLI_VERSION}) is below the minimum supported version (${cli.minVersion}).`));
      console.log(chalk.yellow(`  Please update: ${chalk.cyan('bun add -g @cosmicjs/cli')}`));
      console.log();
      return;
    }

    // Suggest update if a newer version is available (but not required)
    if (cli.latestVersion && compareSemver(CLI_VERSION, cli.latestVersion) < 0) {
      console.log(chalk.dim(`  A newer CLI version is available (${cli.latestVersion}). Run ${chalk.cyan('bun add -g @cosmicjs/cli')} to update.`));
      console.log();
    }
  } catch {
    // Silently ignore any errors -- version check should never block the CLI
  }
}
