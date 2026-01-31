/**
 * Deployment Commands
 * Deploy and manage Vercel deployments
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { requireBucket } from '../config/context.js';
import * as display from '../utils/display.js';
import * as spinner from '../utils/spinner.js';
import * as prompts from '../utils/prompts.js';
import * as api from '../api/dashboard.js';

/**
 * Deploy a repository
 */
async function deployRepository(
  repositoryId: string,
  options: { json?: boolean; watch?: boolean }
): Promise<void> {
  const bucketSlug = requireBucket();

  // Get repository info
  let repoName = repositoryId;
  let vercelProjectId: string | undefined;
  
  try {
    spinner.start('Loading repository...');
    const repo = await api.getRepository(bucketSlug, repositoryId);
    repoName = repo.repository_name;
    vercelProjectId = repo.vercel_project_id;
    spinner.succeed();
    
    display.keyValue('Repository', chalk.cyan(repoName));
    display.keyValue('Framework', repo.framework || 'other');
  } catch (error) {
    spinner.fail('Failed to load repository');
    display.error((error as Error).message);
    process.exit(1);
  }

  // Confirm deployment
  const confirmed = await prompts.confirm({
    message: `Deploy "${repoName}" to Vercel?`,
    initial: true,
  });

  if (!confirmed) {
    display.info('Cancelled');
    return;
  }

  try {
    spinner.start('Starting deployment...');
    const result = await api.deployRepository(bucketSlug, repositoryId);
    
    if (!result.success) {
      spinner.fail('Deployment failed');
      return;
    }

    spinner.succeed('Deployment started');

    if (result.deployment_url) {
      display.keyValue('Deployment URL', chalk.green(result.deployment_url));
    }

    if (result.vercel_project_id) {
      vercelProjectId = result.vercel_project_id;
    }

    if (options.json) {
      display.json(result);
      return;
    }

    // Watch deployment if requested
    if (options.watch && vercelProjectId) {
      display.newline();
      await watchDeployment(bucketSlug, vercelProjectId);
    } else {
      display.newline();
      display.info(`Watch deployment with: ${chalk.cyan(`cosmic deploy logs ${repositoryId}`)}`);
    }
  } catch (error) {
    spinner.fail('Failed to start deployment');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Watch deployment status
 */
async function watchDeployment(
  bucketSlug: string,
  vercelProjectId: string
): Promise<void> {
  display.info('Watching deployment...');
  
  let lastState = '';
  let attempts = 0;
  const maxAttempts = 60; // 5 minutes max
  
  while (attempts < maxAttempts) {
    try {
      const { deployments } = await api.listDeployments(bucketSlug, vercelProjectId, { limit: 1 });
      
      if (deployments.length === 0) {
        await sleep(5000);
        attempts++;
        continue;
      }

      const deployment = deployments[0];
      
      if (deployment.state !== lastState) {
        lastState = deployment.state;
        
        const stateIcon = getStateIcon(deployment.state);
        console.log(`  ${stateIcon} ${deployment.state}`);
        
        if (deployment.state === 'READY') {
          display.newline();
          display.success(`Deployment ready: ${chalk.green(deployment.url)}`);
          return;
        }
        
        if (deployment.state === 'ERROR' || deployment.state === 'CANCELED') {
          display.newline();
          display.error(`Deployment ${deployment.state.toLowerCase()}`);
          return;
        }
      }
      
      await sleep(5000);
      attempts++;
    } catch {
      await sleep(5000);
      attempts++;
    }
  }
  
  display.warning('Deployment monitoring timed out. Check the dashboard for status.');
}

/**
 * List deployments
 */
async function listDeployments(
  repositoryId: string,
  options: { json?: boolean; limit?: number }
): Promise<void> {
  const bucketSlug = requireBucket();

  try {
    // Get repository to get vercel project ID
    spinner.start('Loading repository...');
    const repo = await api.getRepository(bucketSlug, repositoryId);
    
    if (!repo.vercel_project_id) {
      spinner.fail('Repository has no Vercel project');
      display.info(`Deploy first with: ${chalk.cyan(`cosmic deploy ${repositoryId}`)}`);
      return;
    }

    spinner.update('Loading deployments...');
    const { deployments } = await api.listDeployments(
      bucketSlug,
      repo.vercel_project_id,
      { limit: options.limit || 10 }
    );
    
    spinner.succeed(`Found ${deployments.length} deployment(s)`);

    if (deployments.length === 0) {
      display.info('No deployments found');
      return;
    }

    if (options.json) {
      display.json(deployments);
      return;
    }

    const table = display.createTable({
      head: ['Status', 'URL', 'Branch', 'Created'],
    });

    for (const deployment of deployments) {
      const stateIcon = getStateIcon(deployment.state);
      table.push([
        `${stateIcon} ${deployment.state}`,
        display.truncate(deployment.url, 40),
        deployment.meta?.githubCommitRef || '-',
        display.formatDate(new Date(deployment.created).toISOString()),
      ]);
    }

    console.log(table.toString());
  } catch (error) {
    spinner.fail('Failed to load deployments');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Get deployment logs
 */
async function getDeploymentLogs(
  deploymentId: string,
  options: { json?: boolean; follow?: boolean }
): Promise<void> {
  try {
    if (options.follow) {
      // Poll for logs
      display.info('Streaming deployment logs...');
      display.newline();
      
      let lastLogCount = 0;
      let attempts = 0;
      const maxAttempts = 120; // 10 minutes max
      
      while (attempts < maxAttempts) {
        const logs = await api.getDeploymentLogs(deploymentId);
        
        // Print new logs
        if (logs.length > lastLogCount) {
          for (let i = lastLogCount; i < logs.length; i++) {
            const log = logs[i];
            const prefix = log.type === 'stderr' ? chalk.red('[ERR]') : chalk.dim('[LOG]');
            console.log(`${prefix} ${log.text}`);
          }
          lastLogCount = logs.length;
        }
        
        await sleep(2000);
        attempts++;
      }
    } else {
      spinner.start('Loading logs...');
      const logs = await api.getDeploymentLogs(deploymentId);
      spinner.succeed(`Found ${logs.length} log entries`);

      if (logs.length === 0) {
        display.info('No logs available');
        return;
      }

      if (options.json) {
        display.json(logs);
        return;
      }

      display.newline();
      for (const log of logs) {
        const prefix = log.type === 'stderr' ? chalk.red('[ERR]') : chalk.dim('[LOG]');
        console.log(`${prefix} ${log.text}`);
      }
    }
  } catch (error) {
    spinner.fail('Failed to load logs');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Cancel a deployment
 */
async function cancelDeployment(
  repositoryId: string,
  deploymentId: string,
  options: { force?: boolean }
): Promise<void> {
  const bucketSlug = requireBucket();

  // Confirm cancellation
  if (!options.force) {
    const confirmed = await prompts.confirm({
      message: 'Cancel this deployment?',
    });

    if (!confirmed) {
      display.info('Cancelled');
      return;
    }
  }

  try {
    spinner.start('Cancelling deployment...');
    const result = await api.cancelDeployment(bucketSlug, repositoryId, deploymentId);
    
    if (result.success) {
      spinner.succeed('Deployment cancelled');
    } else {
      spinner.fail(result.message || 'Failed to cancel deployment');
    }
  } catch (error) {
    spinner.fail('Failed to cancel deployment');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Get status icon for deployment state
 */
function getStateIcon(state: string): string {
  switch (state) {
    case 'READY':
      return chalk.green('✓');
    case 'BUILDING':
    case 'QUEUED':
      return chalk.yellow('◐');
    case 'ERROR':
      return chalk.red('✗');
    case 'CANCELED':
      return chalk.gray('○');
    default:
      return chalk.gray('?');
  }
}

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create deploy commands
 */
export function createDeployCommands(program: Command): void {
  const deployCmd = program
    .command('deploy')
    .description('Deploy and manage Vercel deployments');

  deployCmd
    .command('start <repositoryId>')
    .alias('trigger')
    .description('Deploy a repository to Vercel')
    .option('--json', 'Output as JSON')
    .option('-w, --watch', 'Watch deployment progress')
    .action(deployRepository);

  deployCmd
    .command('list <repositoryId>')
    .alias('ls')
    .description('List deployments for a repository')
    .option('--json', 'Output as JSON')
    .option('-n, --limit <number>', 'Number of deployments to show', '10')
    .action((repositoryId, options) => 
      listDeployments(repositoryId, { ...options, limit: parseInt(options.limit, 10) })
    );

  deployCmd
    .command('logs <deploymentId>')
    .description('Get deployment logs')
    .option('--json', 'Output as JSON')
    .option('-f, --follow', 'Follow/stream logs')
    .action(getDeploymentLogs);

  deployCmd
    .command('cancel <repositoryId> <deploymentId>')
    .description('Cancel an in-progress deployment')
    .option('-f, --force', 'Skip confirmation')
    .action(cancelDeployment);

  // Default action shows help
  deployCmd.action(() => {
    deployCmd.help();
  });
}

export default { createDeployCommands };
