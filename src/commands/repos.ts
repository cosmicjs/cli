/**
 * Repository Commands
 * Manage GitHub repositories connected to Cosmic
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { requireBucket } from '../config/context.js';
import * as display from '../utils/display.js';
import * as spinner from '../utils/spinner.js';
import * as prompts from '../utils/prompts.js';
import * as api from '../api/dashboard.js';

/**
 * List repositories
 */
async function listRepositories(options: { json?: boolean }): Promise<void> {
  const bucketSlug = requireBucket();

  try {
    spinner.start('Loading repositories...');
    const { repositories } = await api.listRepositories(bucketSlug);
    spinner.succeed(`Found ${repositories.length} repository(ies)`);

    if (repositories.length === 0) {
      display.info('No repositories connected');
      display.newline();
      display.info(`Connect a repository with: ${chalk.cyan('cosmic repos connect')}`);
      return;
    }

    if (options.json) {
      display.json(repositories);
      return;
    }

    const table = display.createTable({
      head: ['ID', 'Name', 'Framework', 'Branch', 'URL'],
    });

    for (const repo of repositories) {
      table.push([
        chalk.dim(repo.id),
        chalk.cyan(repo.repository_name),
        repo.framework || 'other',
        repo.branch || repo.default_branch || 'main',
        display.truncate(repo.production_url || repo.repository_url, 40),
      ]);
    }

    console.log(table.toString());
  } catch (error) {
    spinner.fail('Failed to load repositories');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Get repository details
 */
async function getRepository(
  repositoryId: string,
  options: { json?: boolean }
): Promise<void> {
  const bucketSlug = requireBucket();

  try {
    spinner.start('Loading repository...');
    const repo = await api.getRepository(bucketSlug, repositoryId);
    spinner.succeed();

    if (options.json) {
      display.json(repo);
      return;
    }

    display.header(repo.repository_name);
    display.keyValue('ID', repo.id);
    display.keyValue('Platform', repo.platform || 'github');
    display.keyValue('Framework', repo.framework || 'other');
    display.keyValue('Default Branch', repo.branch || repo.default_branch || 'main');
    display.keyValue('GitHub URL', repo.repository_url);

    if (repo.production_url) {
      display.keyValue('Production URL', chalk.green(repo.production_url));
    }

    if (repo.vercel_project_id) {
      display.keyValue('Vercel Project', repo.vercel_project_id);
    }

    display.keyValue('Created', display.formatDate(repo.created_at));

    if (repo.updated_at) {
      display.keyValue('Updated', display.formatDate(repo.updated_at));
    }

    // List branches
    display.newline();
    display.subheader('Branches');
    try {
      const branches = await api.listBranches(bucketSlug, repositoryId);
      if (branches.length === 0) {
        display.info('No branches found');
      } else {
        for (const branch of branches.slice(0, 10)) {
          const isDefault = branch.name === (repo.branch || repo.default_branch || 'main');
          console.log(`  ${isDefault ? chalk.green('*') : ' '} ${branch.name}${isDefault ? chalk.dim(' (default)') : ''}`);
        }
        if (branches.length > 10) {
          display.info(`  ... and ${branches.length - 10} more`);
        }
      }
    } catch {
      display.info('Could not load branches');
    }
  } catch (error) {
    spinner.fail('Failed to load repository');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Connect a repository
 */
async function connectRepository(options: {
  name?: string;
  url?: string;
  framework?: string;
  json?: boolean;
}): Promise<void> {
  const bucketSlug = requireBucket();

  // Get repository URL
  const repoUrl =
    options.url ||
    (await prompts.text({
      message: 'GitHub repository URL:',
      required: true,
      validate: (value) => {
        if (!value.includes('github.com')) {
          return 'Please enter a valid GitHub repository URL';
        }
        return true;
      },
    }));

  // Parse owner and name from URL
  const urlMatch = repoUrl.match(/github\.com[/:]([^/]+)\/([^/.\s]+)/);
  if (!urlMatch) {
    display.error('Invalid GitHub repository URL');
    process.exit(1);
  }

  const [, owner, parsedName] = urlMatch;
  const repoName = options.name || parsedName;

  // Get framework
  const framework =
    options.framework ||
    (await prompts.select({
      message: 'Framework:',
      choices: [
        { name: 'nextjs', message: 'Next.js' },
        { name: 'react', message: 'React' },
        { name: 'vue', message: 'Vue' },
        { name: 'nuxt', message: 'Nuxt' },
        { name: 'astro', message: 'Astro' },
        { name: 'svelte', message: 'Svelte' },
        { name: 'other', message: 'Other' },
      ],
    }));

  try {
    spinner.start('Connecting repository...');

    const repo = await api.createRepository(bucketSlug, {
      repository_name: repoName,
      repository_url: repoUrl.endsWith('.git') ? repoUrl : `${repoUrl}.git`,
      platform: 'github',
      framework,
      repository_type: 'reference',
    });

    spinner.succeed(`Connected repository: ${chalk.cyan(repo.repository_name)}`);

    if (options.json) {
      display.json(repo);
    } else {
      display.keyValue('ID', repo.id);
      display.keyValue('Owner', owner);
      display.keyValue('Framework', repo.framework);
      display.newline();
      display.info(`Create a repository agent with: ${chalk.cyan(`cosmic agents create -t repository --repository-id ${repo.id}`)}`);
    }
  } catch (error) {
    spinner.fail('Failed to connect repository');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Delete repository
 */
async function deleteRepository(
  repositoryId: string,
  options: { force?: boolean }
): Promise<void> {
  const bucketSlug = requireBucket();

  // Get repo details first
  let repoName = repositoryId;
  try {
    const repo = await api.getRepository(bucketSlug, repositoryId);
    repoName = repo.repository_name;
  } catch {
    // Continue with ID if we can't get name
  }

  // Confirm deletion
  if (!options.force) {
    const confirmed = await prompts.confirm({
      message: `Delete repository "${repoName}"? This will disconnect it from Cosmic (the GitHub repo will not be deleted).`,
    });

    if (!confirmed) {
      display.info('Cancelled');
      return;
    }
  }

  try {
    spinner.start('Deleting repository...');
    await api.deleteRepository(bucketSlug, repositoryId);
    spinner.succeed('Repository disconnected');
  } catch (error) {
    spinner.fail('Failed to delete repository');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * List branches
 */
async function listBranches(
  repositoryId: string,
  options: { json?: boolean }
): Promise<void> {
  const bucketSlug = requireBucket();

  try {
    spinner.start('Loading branches...');
    const branches = await api.listBranches(bucketSlug, repositoryId);
    spinner.succeed(`Found ${branches.length} branch(es)`);

    if (branches.length === 0) {
      display.info('No branches found');
      return;
    }

    if (options.json) {
      display.json(branches);
      return;
    }

    // Get repo to know default branch
    let defaultBranch = 'main';
    try {
      const repo = await api.getRepository(bucketSlug, repositoryId);
      defaultBranch = repo.branch || repo.default_branch || 'main';
    } catch {
      // Use default
    }

    const table = display.createTable({
      head: ['Branch', 'SHA', 'Status'],
    });

    for (const branch of branches) {
      const isDefault = branch.name === defaultBranch;
      table.push([
        isDefault ? chalk.green(`* ${branch.name}`) : `  ${branch.name}`,
        chalk.dim(branch.sha?.slice(0, 7) || '-'),
        isDefault ? chalk.dim('default') : (branch.protected ? chalk.yellow('protected') : ''),
      ]);
    }

    console.log(table.toString());
  } catch (error) {
    spinner.fail('Failed to load branches');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Create branch
 */
async function createBranch(
  repositoryId: string,
  options: { name?: string; from?: string; json?: boolean }
): Promise<void> {
  const bucketSlug = requireBucket();

  // Get branch name
  const branchName =
    options.name ||
    (await prompts.text({
      message: 'New branch name:',
      required: true,
    }));

  // Get source branch
  let sourceBranch = options.from;
  if (!sourceBranch) {
    // Try to get default branch
    try {
      const repo = await api.getRepository(bucketSlug, repositoryId);
      sourceBranch = repo.branch || repo.default_branch || 'main';
    } catch {
      sourceBranch = 'main';
    }

    const useDefault = await prompts.confirm({
      message: `Create from "${sourceBranch}"?`,
      initial: true,
    });

    if (!useDefault) {
      sourceBranch = await prompts.text({
        message: 'Source branch:',
        required: true,
      });
    }
  }

  try {
    spinner.start(`Creating branch "${branchName}"...`);
    const branch = await api.createBranch(bucketSlug, repositoryId, {
      branch_name: branchName,
      source_branch: sourceBranch,
    });
    spinner.succeed(`Created branch: ${chalk.cyan(branch.name)}`);

    if (options.json) {
      display.json(branch);
    }
  } catch (error) {
    spinner.fail('Failed to create branch');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Delete branch
 */
async function deleteBranch(
  repositoryId: string,
  branchName: string,
  options: { force?: boolean }
): Promise<void> {
  const bucketSlug = requireBucket();

  // Confirm deletion
  if (!options.force) {
    const confirmed = await prompts.confirm({
      message: `Delete branch "${branchName}"? This cannot be undone.`,
    });

    if (!confirmed) {
      display.info('Cancelled');
      return;
    }
  }

  try {
    spinner.start(`Deleting branch "${branchName}"...`);
    await api.deleteBranch(bucketSlug, repositoryId, branchName);
    spinner.succeed('Branch deleted');
  } catch (error) {
    spinner.fail('Failed to delete branch');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Validate repository ID format
 * Returns true if valid, exits process if invalid
 */
function validateRepositoryId(repositoryId: string, command: string): boolean {
  // Check if it looks like a command instead of an ID
  const commonCommands = ['list', 'ls', 'get', 'create', 'add', 'delete', 'rm', 'merge', 'close'];
  if (commonCommands.includes(repositoryId)) {
    display.error(`Invalid repository ID: "${repositoryId}"`);
    display.newline();
    display.info(`Correct usage: ${chalk.cyan(`cosmic repos pr ${command} <repositoryId>`)}`);
    display.newline();
    display.info('To list repositories: ' + chalk.cyan('cosmic repos list'));
    process.exit(1);
  }

  // Basic MongoDB ObjectID validation (24 hex characters)
  if (!/^[a-f0-9]{24}$/i.test(repositoryId) && !/^[a-z0-9-]{20,}$/i.test(repositoryId)) {
    display.error(`Invalid repository ID format: "${repositoryId}"`);
    display.newline();
    display.info('Repository IDs are typically 24-character hex strings');
    display.info('To list your repositories: ' + chalk.cyan('cosmic repos list'));
    process.exit(1);
  }

  return true;
}

/**
 * List pull requests
 */
async function listPullRequests(
  repositoryId: string,
  options: {
    state?: 'open' | 'closed' | 'all';
    base?: string;
    head?: string;
    json?: boolean;
  }
): Promise<void> {
  const bucketSlug = requireBucket();
  validateRepositoryId(repositoryId, 'list');

  try {
    spinner.start('Loading pull requests...');
    const prs = await api.listPullRequests(bucketSlug, repositoryId, {
      state: options.state || 'open',
      base: options.base,
      head: options.head,
    });
    spinner.succeed(`Found ${prs.length} pull request(s)`);

    if (prs.length === 0) {
      display.info(`No ${options.state || 'open'} pull requests found`);
      return;
    }

    if (options.json) {
      display.json(prs);
      return;
    }

    const table = display.createTable({
      head: ['#', 'Title', 'Branch', 'State', 'Author'],
    });

    for (const pr of prs) {
      const stateColor = pr.state === 'open' ? chalk.green : chalk.gray;
      table.push([
        chalk.cyan(`#${pr.number}`),
        display.truncate(pr.title, 40),
        `${pr.head.ref} → ${pr.base.ref}`,
        stateColor(pr.state),
        pr.user.login,
      ]);
    }

    console.log(table.toString());
  } catch (error) {
    spinner.fail('Failed to load pull requests');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Get pull request details
 */
async function getPullRequest(
  repositoryId: string,
  pullNumber: string,
  options: { json?: boolean }
): Promise<void> {
  const bucketSlug = requireBucket();
  validateRepositoryId(repositoryId, 'get');

  const prNumber = parseInt(pullNumber, 10);

  if (isNaN(prNumber)) {
    display.error('Pull request number must be a valid number');
    process.exit(1);
  }

  try {
    spinner.start('Loading pull request...');
    const pr = await api.getPullRequest(bucketSlug, repositoryId, prNumber);
    spinner.succeed();

    if (options.json) {
      display.json(pr);
      return;
    }

    display.header(`Pull Request #${pr.number}`);
    display.keyValue('Title', pr.title);
    display.keyValue('State', pr.state === 'open' ? chalk.green('Open') : chalk.gray('Closed'));
    display.keyValue('Author', pr.user.login);
    display.keyValue('Branch', `${pr.head.ref} → ${pr.base.ref}`);
    display.keyValue('URL', chalk.cyan(pr.html_url));

    if (pr.draft) {
      display.keyValue('Draft', 'Yes');
    }

    if (pr.mergeable !== undefined) {
      display.keyValue('Mergeable', pr.mergeable ? chalk.green('Yes') : chalk.yellow('No'));
    }

    display.keyValue('Created', display.formatDate(pr.created_at));
    display.keyValue('Updated', display.formatDate(pr.updated_at));

    if (pr.merged_at) {
      display.keyValue('Merged', display.formatDate(pr.merged_at));
    }

    if (pr.body) {
      display.newline();
      display.subheader('Description');
      console.log(pr.body);
    }
  } catch (error) {
    spinner.fail('Failed to load pull request');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Create pull request
 */
async function createPullRequest(
  repositoryId: string,
  options: {
    title?: string;
    body?: string;
    head?: string;
    base?: string;
    draft?: boolean;
    json?: boolean;
  }
): Promise<void> {
  const bucketSlug = requireBucket();
  validateRepositoryId(repositoryId, 'create');

  // Get repository and branches for selection
  let repo;
  let branches: api.Branch[] = [];
  let defaultBranch = 'main';

  try {
    repo = await api.getRepository(bucketSlug, repositoryId);
    defaultBranch = repo.branch || repo.default_branch || 'main';
    branches = await api.listBranches(bucketSlug, repositoryId);
  } catch (error) {
    display.warning('Could not load repository branches');
  }

  // Get PR title
  const title =
    options.title ||
    (await prompts.text({
      message: 'Pull request title:',
      required: true,
    }));

  // Get head branch (source)
  let head = options.head;
  if (!head) {
    if (branches && branches.length > 0) {
      try {
        // Offer branch selection
        const branchChoices = branches.map((branch) => ({
          name: branch.name,
          message: branch.name === defaultBranch
            ? `${branch.name} ${chalk.dim('(default)')}`
            : branch.name,
        }));

        head = await prompts.select({
          message: 'Head branch (source, where your changes are):',
          choices: branchChoices,
        });
      } catch (error) {
        // Fall back to text input if selection fails
        head = await prompts.text({
          message: 'Head branch (source, where changes are):',
          required: true,
        });
      }
    } else {
      head = await prompts.text({
        message: 'Head branch (source, where changes are):',
        required: true,
      });
    }
  }

  // Get base branch (target)
  let base = options.base;
  if (!base) {
    if (branches && branches.length > 0) {
      try {
        // Offer branch selection with default preselected
        const branchChoices = branches.map((branch) => ({
          name: branch.name,
          message: branch.name === defaultBranch
            ? `${branch.name} ${chalk.dim('(default)')}`
            : branch.name,
        }));

        // Find index of default branch
        const defaultIndex = branches.findIndex(b => b.name === defaultBranch);

        base = await prompts.select({
          message: 'Base branch (target, where changes will be merged):',
          choices: branchChoices,
          initial: defaultIndex >= 0 ? defaultIndex : 0,
        });
      } catch (error) {
        // Fall back to confirmation/text input if selection fails
        const useDefault = await prompts.confirm({
          message: `Merge into "${defaultBranch}"?`,
          initial: true,
        });

        if (useDefault) {
          base = defaultBranch;
        } else {
          base = await prompts.text({
            message: 'Base branch (target):',
            required: true,
          });
        }
      }
    } else {
      const useDefault = await prompts.confirm({
        message: `Merge into "${defaultBranch}"?`,
        initial: true,
      });

      if (useDefault) {
        base = defaultBranch;
      } else {
        base = await prompts.text({
          message: 'Base branch (target):',
          required: true,
        });
      }
    }
  }

  // Validate that head and base are different
  if (head === base) {
    display.error(`Head and base branches must be different. Both are set to "${head}"`);
    process.exit(1);
  }

  // Get body if not provided
  const body = options.body || (await prompts.text({
    message: 'Description (optional):',
    required: false,
  }));

  try {
    spinner.start('Creating pull request...');
    const pr = await api.createPullRequest(bucketSlug, repositoryId, {
      title,
      body,
      head,
      base,
      draft: options.draft,
    });
    spinner.succeed(`Created pull request: ${chalk.cyan(`#${pr.number}`)}`);

    if (options.json) {
      display.json(pr);
    } else {
      display.keyValue('Title', pr.title);
      if (pr.head?.ref && pr.base?.ref) {
        display.keyValue('Branch', `${pr.head.ref} → ${pr.base.ref}`);
      }
      if (pr.html_url) {
        display.keyValue('URL', chalk.cyan(pr.html_url));
      }
      display.newline();
      display.info(`View PR: ${chalk.cyan(`cosmic repos pr get ${repositoryId} ${pr.number}`)}`);
    }
  } catch (error) {
    spinner.fail('Failed to create pull request');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Merge pull request
 */
async function mergePullRequest(
  repositoryId: string,
  pullNumber: string,
  options: {
    method?: 'merge' | 'squash' | 'rebase';
    title?: string;
    message?: string;
    force?: boolean;
  }
): Promise<void> {
  const bucketSlug = requireBucket();
  validateRepositoryId(repositoryId, 'merge');

  const prNumber = parseInt(pullNumber, 10);

  if (isNaN(prNumber)) {
    display.error('Pull request number must be a valid number');
    process.exit(1);
  }

  // Get PR details first
  let pr;
  try {
    pr = await api.getPullRequest(bucketSlug, repositoryId, prNumber);
  } catch (error) {
    display.error((error as Error).message);
    process.exit(1);
  }

  // Confirm merge
  if (!options.force) {
    const confirmed = await prompts.confirm({
      message: `Merge PR #${pr.number} "${pr.title}" (${pr.head.ref} → ${pr.base.ref})?`,
      initial: true,
    });

    if (!confirmed) {
      display.info('Cancelled');
      return;
    }
  }

  try {
    spinner.start(`Merging pull request #${prNumber}...`);
    const result = await api.mergePullRequest(bucketSlug, repositoryId, prNumber, {
      merge_method: options.method || 'merge',
      commit_title: options.title,
      commit_message: options.message,
    });

    if (process.env.COSMIC_DEBUG) {
      console.log('[DEBUG] Merge result:', JSON.stringify(result, null, 2));
    }

    if (result.merged) {
      spinner.succeed('Pull request merged successfully');
      if (result.message) {
        display.info(result.message);
      }
    } else {
      spinner.fail('Failed to merge pull request');
      display.error(result.message || 'Unknown error');
      process.exit(1);
    }
  } catch (error: any) {
    spinner.fail('Failed to merge pull request');
    const errorMessage = error?.response?.data?.message || error?.message || JSON.stringify(error);
    display.error(errorMessage);
    if (process.env.COSMIC_DEBUG) {
      console.error('Full error:', error);
    }
    process.exit(1);
  }
}

/**
 * Close pull request
 */
async function closePullRequest(
  repositoryId: string,
  pullNumber: string,
  options: { force?: boolean }
): Promise<void> {
  const bucketSlug = requireBucket();
  validateRepositoryId(repositoryId, 'close');

  const prNumber = parseInt(pullNumber, 10);

  if (isNaN(prNumber)) {
    display.error('Pull request number must be a valid number');
    process.exit(1);
  }

  // Get PR details first
  let pr;
  try {
    pr = await api.getPullRequest(bucketSlug, repositoryId, prNumber);
  } catch (error) {
    display.error((error as Error).message);
    process.exit(1);
  }

  // Confirm close
  if (!options.force) {
    const confirmed = await prompts.confirm({
      message: `Close PR #${pr.number} "${pr.title}"?`,
    });

    if (!confirmed) {
      display.info('Cancelled');
      return;
    }
  }

  try {
    spinner.start(`Closing pull request #${prNumber}...`);
    await api.closePullRequest(bucketSlug, repositoryId, prNumber);
    spinner.succeed('Pull request closed');
  } catch (error) {
    spinner.fail('Failed to close pull request');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Create repos commands
 */
export function createReposCommands(program: Command): void {
  const reposCmd = program
    .command('repos')
    .alias('repositories')
    .description('Manage GitHub repositories');

  reposCmd
    .command('list')
    .alias('ls')
    .description('List connected repositories')
    .option('--json', 'Output as JSON')
    .action(listRepositories);

  reposCmd
    .command('get <id>')
    .description('Get repository details')
    .option('--json', 'Output as JSON')
    .action(getRepository);

  reposCmd
    .command('connect')
    .alias('add')
    .description('Connect a GitHub repository')
    .option('-n, --name <name>', 'Repository name')
    .option('-u, --url <url>', 'GitHub repository URL')
    .option('-f, --framework <framework>', 'Framework (nextjs, react, vue, etc.)')
    .option('--json', 'Output as JSON')
    .action(connectRepository);

  reposCmd
    .command('delete <id>')
    .alias('rm')
    .description('Disconnect a repository')
    .option('-f, --force', 'Skip confirmation')
    .action(deleteRepository);

  // Branches subcommand
  const branchesCmd = reposCmd
    .command('branches <repositoryId>')
    .description('Manage repository branches');

  branchesCmd
    .command('list')
    .alias('ls')
    .description('List branches')
    .option('--json', 'Output as JSON')
    .action((options, cmd) => {
      const repositoryId = cmd.parent.args[0];
      return listBranches(repositoryId, options);
    });

  branchesCmd
    .command('create')
    .alias('add')
    .description('Create a new branch')
    .option('-n, --name <name>', 'Branch name')
    .option('--from <branch>', 'Source branch')
    .option('--json', 'Output as JSON')
    .action((options, cmd) => {
      const repositoryId = cmd.parent.args[0];
      return createBranch(repositoryId, options);
    });

  branchesCmd
    .command('delete <branchName>')
    .alias('rm')
    .description('Delete a branch')
    .option('-f, --force', 'Skip confirmation')
    .action((branchName, options, cmd) => {
      const repositoryId = cmd.parent.parent.args[0];
      return deleteBranch(repositoryId, branchName, options);
    });

  // Pull Requests subcommand
  const prCmd = reposCmd
    .command('pr')
    .alias('pull-requests')
    .description('Manage pull requests');

  prCmd
    .command('list <repositoryId>')
    .alias('ls')
    .description('List pull requests')
    .option('-s, --state <state>', 'Filter by state (open, closed, all)', 'open')
    .option('--base <branch>', 'Filter by base branch')
    .option('--head <branch>', 'Filter by head branch')
    .option('--json', 'Output as JSON')
    .action((repositoryId, options) => {
      validateRepositoryId(repositoryId, 'list');
      return listPullRequests(repositoryId, options);
    });

  prCmd
    .command('get <repositoryId> <pull_number>')
    .description('Get pull request details')
    .option('--json', 'Output as JSON')
    .action((repositoryId, pullNumber, options) => {
      validateRepositoryId(repositoryId, 'get');
      return getPullRequest(repositoryId, pullNumber, options);
    });

  prCmd
    .command('create <repositoryId>')
    .alias('add')
    .description('Create a pull request')
    .option('-t, --title <title>', 'Pull request title')
    .option('-b, --body <body>', 'Pull request description')
    .option('--head <branch>', 'Head branch (source, where changes are)')
    .option('--base <branch>', 'Base branch (target, where changes go)')
    .option('--draft', 'Create as draft PR')
    .option('--json', 'Output as JSON')
    .action((repositoryId, options) => {
      validateRepositoryId(repositoryId, 'create');
      return createPullRequest(repositoryId, options);
    });

  prCmd
    .command('merge <repositoryId> <pull_number>')
    .description('Merge a pull request')
    .option('-m, --method <method>', 'Merge method (merge, squash, rebase)', 'merge')
    .option('--title <title>', 'Commit title')
    .option('--message <message>', 'Commit message')
    .option('-f, --force', 'Skip confirmation')
    .action((repositoryId, pullNumber, options) => {
      validateRepositoryId(repositoryId, 'merge');
      return mergePullRequest(repositoryId, pullNumber, options);
    });

  prCmd
    .command('close <repositoryId> <pull_number>')
    .description('Close a pull request')
    .option('-f, --force', 'Skip confirmation')
    .action((repositoryId, pullNumber, options) => {
      validateRepositoryId(repositoryId, 'close');
      return closePullRequest(repositoryId, pullNumber, options);
    });

  // Default action for repos command (list)
  reposCmd.action(() => listRepositories({}));

  // Default action for branches command (list)
  branchesCmd.action((options, cmd) => {
    const repositoryId = cmd.args?.[0];
    if (!repositoryId) {
      display.error('Repository ID is required');
      display.info(`Usage: ${chalk.cyan('cosmic repos branches <repositoryId>')}`);
      process.exit(1);
    }
    return listBranches(repositoryId, {});
  });
}

export default { createReposCommands };
