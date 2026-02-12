/**
 * Deployment status polling utilities
 */

import chalk from 'chalk';
import {
  getLatestDeploymentStatus,
  getDeploymentLogs,
  type DeploymentLog,
} from '../api/dashboard.js';
import { state } from './state.js';

/**
 * Format elapsed time in human-readable format
 */
export function formatElapsedTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

/**
 * Poll for deployment status until ready, error, or timeout
 */
export async function pollDeploymentStatus(
  bucketSlug: string,
  vercelProjectId: string,
  repositoryUrl?: string
): Promise<{ success: boolean; url?: string; error?: string; deploymentId?: string; logs?: DeploymentLog[] }> {
  const POLL_INTERVAL = 5000; // 5 seconds
  const TIMEOUT = 300000; // 5 minutes
  const startTime = Date.now();

  console.log();
  console.log(chalk.yellow('  Waiting for Vercel deployment...'));

  let lastStatus = '';
  let dotCount = 0;

  const verbose = process.env.COSMIC_DEBUG === '1' || process.env.COSMIC_DEBUG === '2';

  while (Date.now() - startTime < TIMEOUT) {
    try {
      const response = await getLatestDeploymentStatus(bucketSlug, vercelProjectId);

      if (verbose) {
        console.log(`\n[DEBUG] Deployment response: ${JSON.stringify(response, null, 2)}`);
      }

      if (!response.success || !response.deployment) {
        // No deployment found yet, keep waiting
        const elapsed = formatElapsedTime(Date.now() - startTime);
        dotCount = (dotCount + 1) % 4;
        const dots = '.'.repeat(dotCount + 1);
        process.stdout.write(`\r  ${chalk.cyan('Waiting')}${dots.padEnd(4)} ${chalk.dim(`(${elapsed})`)}`);
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
        continue;
      }

      // Handle different possible status field names from the API
      const deployment = response.deployment;
      const statusVal = deployment.status || (deployment as Record<string, unknown>).readyState || (deployment as Record<string, unknown>).state;
      const url = deployment.url;
      const elapsed = formatElapsedTime(Date.now() - startTime);

      // Clear the previous line and show new status
      if (statusVal !== lastStatus) {
        lastStatus = statusVal;
        dotCount = 0;
      }

      // Normalize status to uppercase for comparison
      const normalizedStatus = String(statusVal || '').toUpperCase();

      // Show status based on deployment status
      if (normalizedStatus === 'READY') {
        // Clear the line first
        process.stdout.write('\r' + ' '.repeat(50) + '\r');
        console.log(chalk.green(`  ✓ Deployment complete!`));
        console.log();
        const liveUrl = url?.startsWith('http') ? url : `https://${url}`;
        console.log(chalk.bold.green(`  🌐 Live at: ${liveUrl}`));

        // Save for "open" command
        state.lastDeploymentUrl = liveUrl;

        console.log();
        console.log(chalk.dim('  Type "open" to view in browser, or continue chatting.'));
        console.log();

        return { success: true, url: liveUrl };
      }

      if (normalizedStatus === 'ERROR') {
        process.stdout.write('\r' + ' '.repeat(50) + '\r');
        const errorMsg = response.deployment.meta?.error?.message || 'Build failed';
        console.log(chalk.red(`  ✗ Deployment failed: ${errorMsg}`));
        console.log();

        // Fetch and display build logs
        const deploymentId = response.deployment.deploymentId;
        let fetchedLogs: DeploymentLog[] = [];

        if (deploymentId) {
          console.log(chalk.dim('  Fetching build logs...'));
          const logsResponse = await getDeploymentLogs(deploymentId);

          if (logsResponse.success && logsResponse.logs && logsResponse.logs.length > 0) {
            fetchedLogs = logsResponse.logs;
            console.log();
            console.log(chalk.bold.red('  Build Logs:'));
            console.log(chalk.dim('  ' + '─'.repeat(60)));

            // Filter to show only errors and important messages (last 30 lines)
            const relevantLogs = logsResponse.logs
              .filter(log => log.type === 'stderr' || log.text.toLowerCase().includes('error'))
              .slice(-30);

            if (relevantLogs.length > 0) {
              for (const log of relevantLogs) {
                const logText = log.text.trim();
                if (logText) {
                  // Color code based on log type
                  const color = log.type === 'stderr' ? chalk.red : chalk.yellow;
                  // Indent and wrap long lines
                  const lines = logText.split('\n');
                  for (const line of lines) {
                    console.log(color(`  ${line}`));
                  }
                }
              }
            } else {
              // If no error logs found, show the last few logs
              const lastLogs = logsResponse.logs.slice(-15);
              for (const log of lastLogs) {
                const logText = log.text.trim();
                if (logText) {
                  console.log(chalk.dim(`  ${logText}`));
                }
              }
            }

            console.log(chalk.dim('  ' + '─'.repeat(60)));
            console.log();
          }
        }

        return { success: false, error: errorMsg, deploymentId, logs: fetchedLogs };
      }

      if (normalizedStatus === 'CANCELED') {
        process.stdout.write('\r' + ' '.repeat(50) + '\r');
        console.log(chalk.yellow(`  ✗ Deployment was canceled`));
        console.log();
        return { success: false, error: 'Deployment canceled' };
      }

      // Still building, queued, or initializing
      dotCount = (dotCount + 1) % 4;
      const dots = '.'.repeat(dotCount + 1);
      let statusDisplay = statusVal || 'Building';
      if (normalizedStatus === 'QUEUED') statusDisplay = 'Queued';
      else if (normalizedStatus === 'INITIALIZING') statusDisplay = 'Initializing';
      else if (normalizedStatus === 'BUILDING') statusDisplay = 'Building';

      process.stdout.write(`\r  ${chalk.cyan(statusDisplay)}${dots.padEnd(4)} ${chalk.dim(`(${elapsed})`)}`);

      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
    } catch (error) {
      // On error, continue polling (might be temporary)
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
    }
  }

  // Timeout reached
  process.stdout.write('\r' + ' '.repeat(50) + '\r');
  console.log(chalk.yellow(`  ⏱ Deployment is taking longer than expected.`));
  console.log(chalk.dim(`  Check status at: https://vercel.com/dashboard`));
  console.log();
  return { success: false, error: 'Timeout waiting for deployment' };
}
