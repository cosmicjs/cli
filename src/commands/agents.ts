/**
 * Agents Commands
 * AI agent management and execution
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { requireBucket } from '../config/context.js';
import * as display from '../utils/display.js';
import * as spinner from '../utils/spinner.js';
import * as prompts from '../utils/prompts.js';
import * as api from '../api/dashboard.js';
import { captureAuthWithDoneButton, formatCookiesForApi, formatLocalStorageForApi } from '../auth/capture.js';

/**
 * Default AI models by agent type
 */
const DEFAULT_MODELS = {
  content: 'claude-opus-4-5-20251101',
  repository: 'claude-opus-4-5-20251101',
  computer_use: 'claude-haiku-4-5-20251001',
} as const;

/**
 * Get the default model for an agent type
 */
function getDefaultModelForAgentType(agentType: 'content' | 'repository' | 'computer_use'): string {
  return DEFAULT_MODELS[agentType];
}

/**
 * List agents
 */
async function listAgents(options: { json?: boolean }): Promise<void> {
  const bucketSlug = requireBucket();

  try {
    spinner.start('Loading agents...');
    const agents = await api.listAgents(bucketSlug);
    spinner.succeed(`Found ${agents.length} agent(s)`);

    if (agents.length === 0) {
      display.info('No agents found');
      return;
    }

    if (options.json) {
      display.json(agents);
      return;
    }

    const table = display.createTable({
      head: ['ID', 'Name', 'Type', 'Schedule', 'Created'],
    });

    for (const agent of agents) {
      // Format schedule status
      let scheduleStatus = '-';
      if (agent.schedule?.enabled) {
        scheduleStatus = agent.schedule.frequency || 'enabled';
      }

      table.push([
        agent.id || '-',
        `${agent.emoji || '🤖'} ${display.truncate(agent.agent_name || '', 30)}`,
        agent.agent_type || '-',
        scheduleStatus,
        display.formatDate(agent.created_at),
      ]);
    }

    console.log(table.toString());
  } catch (error) {
    spinner.fail('Failed to load agents');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Get agent details
 */
async function getAgent(
  agentId: string,
  options: { json?: boolean }
): Promise<void> {
  const bucketSlug = requireBucket();

  try {
    spinner.start('Loading agent...');
    const agent = await api.getAgent(bucketSlug, agentId);
    spinner.succeed();

    if (options.json) {
      display.json(agent);
      return;
    }

    display.header(`${agent.emoji || '🤖'} ${agent.agent_name}`);
    display.keyValue('ID', agent.id);
    display.keyValue('Type', agent.agent_type);
    display.keyValue('Model', agent.model || 'default');
    display.keyValue('Created', display.formatDate(agent.created_at));
    display.keyValue('Modified', display.formatDate(agent.modified_at));

    if (agent.agent_type === 'repository') {
      display.keyValue('Repository ID', agent.repository_id || '-');
      display.keyValue('Base Branch', agent.base_branch || '-');
    }

    if (agent.agent_type === 'computer_use') {
      display.keyValue('Start URL', agent.start_url || '-');
      display.keyValue('Goal', agent.goal || '-');
    }

    display.keyValue('Email Notifications', agent.email_notifications ? 'Yes' : 'No');
    display.keyValue('Require Approval', agent.require_approval ? 'Yes' : 'No');

    // Display schedule information
    if (agent.schedule?.enabled) {
      display.subheader('Schedule');
      display.keyValue('Status', 'Enabled');
      display.keyValue('Type', agent.schedule.type || 'recurring');
      display.keyValue('Frequency', agent.schedule.frequency || '-');
      display.keyValue('Timezone', agent.schedule.timezone || 'UTC');
      if (agent.schedule.next_run_at) {
        display.keyValue('Next Run', display.formatDate(agent.schedule.next_run_at));
      }
    }

    display.subheader('Prompt');
    console.log(agent.prompt);

    if (agent.context && Object.keys(agent.context).length > 0) {
      display.subheader('Context');
      display.json(agent.context);
    }
  } catch (error) {
    spinner.fail('Failed to load agent');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Build agent context from CLI options (matches chat/build/repo context format)
 */
function buildAgentContext(options: {
  types?: string;
  links?: string;
  objectsLimit?: string;
  objectsDepth?: string;
}): Record<string, unknown> | undefined {
  const objectTypes = options.types
    ? options.types.split(',').map((t) => t.trim()).filter(Boolean)
    : [];
  const links = options.links
    ? options.links.split(',').map((l) => l.trim()).filter(Boolean)
    : [];
  const limit = options.objectsLimit ? parseInt(options.objectsLimit, 10) : 100;
  const depth = options.objectsDepth ? parseInt(options.objectsDepth, 10) : 1;

  if (objectTypes.length === 0 && links.length === 0) {
    return undefined;
  }

  const context: Record<string, unknown> = {
    objects: {
      enabled: true,
      object_types: objectTypes.length > 0 ? objectTypes : undefined,
      include_models: true,
      limit,
      depth,
    },
    bucket: {
      enabled: true,
      include_object_types: true,
      include_media: false,
    },
  };

  if (links.length > 0) {
    context.links = links;
  }

  return context;
}

/**
 * Normalize agent type - accept aliases for convenience
 */
function normalizeAgentType(type: string): 'content' | 'repository' | 'computer_use' {
  const normalized = type.toLowerCase().trim();

  // Accept 'code', 'repo', or 'repository' as repository type
  if (normalized === 'code' || normalized === 'repo' || normalized === 'repository') {
    return 'repository';
  }

  if (normalized === 'content') {
    return 'content';
  }

  if (normalized === 'computer_use') {
    return 'computer_use';
  }

  // Invalid type - let it pass through and API will reject
  display.error(`Invalid agent_type. Must be one of: content, repository (or code/repo), computer_use`);
  process.exit(1);
}

/**
 * Create agent with interactive flow for repository agents
 */
async function createAgent(options: {
  name?: string;
  type: string;
  prompt?: string;
  model?: string;
  emoji?: string;
  repositoryId?: string;
  baseBranch?: string;
  startUrl?: string;
  goal?: string;
  emailNotifications?: boolean;
  requireApproval?: boolean;
  json?: boolean;
  interactive?: boolean;
  run?: boolean;
  types?: string;
  links?: string;
  objectsLimit?: string;
  objectsDepth?: string;
  // Schedule options
  schedule?: boolean;
  scheduleType?: 'once' | 'recurring';
  scheduleFrequency?: 'hourly' | 'daily' | 'weekly' | 'monthly';
  timezone?: string;
  // Auth session for computer use agents
  authSession?: string;
}): Promise<void> {
  const bucketSlug = requireBucket();
  const agentType = normalizeAgentType(options.type);
  const isRepository = agentType === 'repository';

  // Get name if not provided
  const name =
    options.name ||
    (await prompts.text({
      message: 'Agent name:',
      required: true,
    }));

  // For repository agents, interactive selection of repo and branch
  let repositoryId = options.repositoryId;
  let baseBranch = options.baseBranch;

  if (isRepository && !repositoryId) {
    // List repositories and let user select
    spinner.start('Loading repositories...');
    const { repositories } = await api.listRepositories(bucketSlug);
    spinner.stop();

    if (repositories.length === 0) {
      display.error('No repositories connected');
      display.info(`Connect a repository first: ${chalk.cyan('cosmic repos connect')}`);
      process.exit(1);
    }

    const repoChoices = repositories.map((repo) => ({
      name: repo.id,
      message: `${repo.repository_name} (${repo.framework || 'other'})`,
    }));

    repositoryId = await prompts.select({
      message: 'Select repository:',
      choices: repoChoices,
    });

    // List branches for selected repository
    spinner.start('Loading branches...');
    const branches = await api.listBranches(bucketSlug, repositoryId);
    spinner.stop();

    if (branches.length === 0) {
      baseBranch = 'main';
      display.info('Using default branch: main');
    } else {
      const branchChoices = branches.map((branch) => ({
        name: branch.name,
        message: branch.name,
      }));

      baseBranch = await prompts.select({
        message: 'Select base branch:',
        choices: branchChoices,
      });
    }
  }

  // Get prompt if not provided
  const prompt =
    options.prompt ||
    (await prompts.text({
      message: isRepository
        ? 'What would you like the agent to do with the code?'
        : 'Prompt (instructions for the agent):',
      required: true,
    }));

  try {
    spinner.start('Creating agent...');

    const context = buildAgentContext({
      types: options.types,
      links: options.links,
      objectsLimit: options.objectsLimit,
      objectsDepth: options.objectsDepth,
    });

    // Use provided model or default based on agent type
    const model = options.model || getDefaultModelForAgentType(agentType);

    // Build schedule config if schedule options are provided
    const schedule = options.schedule ? {
      enabled: true,
      type: options.scheduleType || 'recurring',
      frequency: options.scheduleFrequency || 'daily',
      timezone: options.timezone || 'UTC',
    } : undefined;

    // Build auth_sessions for computer_use agents if session ID provided
    const authSessions = options.authSession && agentType === 'computer_use'
      ? [{ session_id: options.authSession }]
      : undefined;

    const data: api.CreateAgentData = {
      agent_name: name,
      agent_type: agentType,
      prompt,
      model,
      emoji: options.emoji || (isRepository ? '🔧' : '🤖'),
      repository_id: repositoryId,
      base_branch: baseBranch,
      start_url: options.startUrl,
      goal: options.goal,
      schedule,
      auth_sessions: authSessions,
      email_notifications: options.emailNotifications,
      require_approval: options.requireApproval,
      context,
    };

    const agent = await api.createAgent(bucketSlug, data);
    spinner.succeed(`Created agent: ${chalk.cyan(agent.agent_name)}`);

    if (options.json) {
      display.json(agent);
      return;
    }

    display.keyValue('ID', agent.id);
    display.keyValue('Type', agent.agent_type);

    if (isRepository) {
      display.keyValue('Repository', repositoryId || '-');
      display.keyValue('Base Branch', baseBranch || '-');
    }

    if (schedule?.enabled) {
      display.keyValue('Schedule', `${schedule.frequency} (${schedule.type})`);
      display.keyValue('Timezone', schedule.timezone || 'UTC');
    }

    // Optionally run the agent immediately
    if (options.run) {
      display.newline();
      await runAgent(agent.id, { json: options.json });
    } else if (isRepository) {
      display.newline();
      const shouldRun = await prompts.confirm({
        message: 'Run the agent now?',
        initial: true,
      });

      if (shouldRun) {
        await runAgent(agent.id, { json: options.json });
      } else {
        display.info(`Run later with: ${chalk.cyan(`cosmic agents run ${agent.id}`)}`);
      }
    }
  } catch (error) {
    spinner.fail('Failed to create agent');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Run agent
 */
async function runAgent(
  agentId: string,
  options: {
    prompt?: string;
    json?: boolean;
  }
): Promise<void> {
  const bucketSlug = requireBucket();

  try {
    spinner.start('Starting agent execution...');
    const execution = await api.runAgent(bucketSlug, agentId, {
      prompt: options.prompt,
    });
    spinner.succeed('Agent execution started');

    if (options.json) {
      display.json(execution);
      return;
    }

    const executionId = execution.id || execution.execution_id || (execution as any)._id;

    display.keyValue('Execution ID', executionId || 'Started (check dashboard for details)');
    display.keyValue('Status', display.formatStatus(execution.status || 'pending'));

    if (executionId) {
      display.newline();
      display.info(
        `Track progress with: ${chalk.cyan(`cosmic agents executions ${agentId} ${executionId}`)}`
      );
    } else {
      display.newline();
      display.info(
        `View executions with: ${chalk.cyan(`cosmic agents executions ${agentId}`)}`
      );
    }
  } catch (error) {
    spinner.fail('Failed to run agent');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * List agent executions
 */
async function listAgentExecutions(
  agentId: string,
  options: { json?: boolean }
): Promise<void> {
  const bucketSlug = requireBucket();

  try {
    spinner.start('Loading executions...');
    const executions = await api.listAgentExecutions(bucketSlug, agentId);
    spinner.succeed(`Found ${executions.length} execution(s)`);

    if (executions.length === 0) {
      display.info('No executions found');
      return;
    }

    if (options.json) {
      display.json(executions);
      return;
    }

    const table = display.createTable({
      head: ['ID', 'Status', 'Started', 'Completed'],
    });

    for (const exec of executions) {
      table.push([
        chalk.dim(exec.id.slice(0, 8)),
        display.formatStatus(exec.status),
        display.formatDate(exec.started_at),
        display.formatDate(exec.completed_at),
      ]);
    }

    console.log(table.toString());
  } catch (error) {
    spinner.fail('Failed to load executions');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Check if execution status indicates it's still in progress
 * Note: pending_review is NOT in progress - it's waiting for user action
 */
function isExecutionInProgress(status: string): boolean {
  const inProgressStatuses = ['pending', 'working', 'running', 'queued', 'in_progress', 'active'];
  return inProgressStatuses.includes(status?.toLowerCase());
}

/**
 * Format elapsed time in human-readable format
 */
function formatElapsedTime(startTime: number): string {
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

/**
 * Display execution details
 */
function displayExecution(execution: any, agentId?: string): void {
  display.header('Agent Execution');
  display.keyValue('ID', execution.id);
  display.keyValue('Agent ID', execution.agent_id || agentId);
  display.keyValue('Status', display.formatStatus(execution.status));
  display.keyValue('Started', display.formatDate(execution.started_at));
  display.keyValue('Completed', display.formatDate(execution.completed_at));

  if (execution.error) {
    display.subheader('Error');
    console.log(chalk.red(execution.error));
  }

  if (execution.output) {
    display.subheader('Output');
    display.json(execution.output);
  }

  // Show hint for pending_review status
  if (execution.status === 'pending_review') {
    display.newline();
    display.info('This execution has pending operations that need approval.');
    display.info(`Review and approve with: ${chalk.cyan(`cosmic agents approve ${execution.agent_id || agentId} ${execution.id}`)}`);
  }
}

/**
 * Get agent execution details with optional polling
 */
async function getAgentExecution(
  agentId: string,
  executionId: string,
  options: { json?: boolean; watch?: boolean }
): Promise<void> {
  const bucketSlug = requireBucket();
  const pollInterval = 3000; // 3 seconds
  const startTime = Date.now();

  try {
    spinner.start('Loading execution...');
    let execution = await api.getAgentExecution(bucketSlug, agentId, executionId);

    // If not watching or execution is already complete, show result immediately
    if (!options.watch || !isExecutionInProgress(execution.status)) {
      spinner.succeed();

      if (options.json) {
        display.json(execution);
        return;
      }

      displayExecution(execution, agentId);
      return;
    }

    // Poll while execution is in progress
    while (isExecutionInProgress(execution.status)) {
      const elapsed = formatElapsedTime(startTime);
      spinner.update(`Agent working... (${elapsed})`);

      await new Promise((resolve) => setTimeout(resolve, pollInterval));
      execution = await api.getAgentExecution(bucketSlug, agentId, executionId);
    }

    // Execution complete
    const totalElapsed = formatElapsedTime(startTime);
    if (execution.status === 'completed' || execution.status === 'success') {
      spinner.succeed(`Execution completed (${totalElapsed})`);
    } else if (execution.status === 'failed' || execution.status === 'error') {
      spinner.fail(`Execution failed (${totalElapsed})`);
    } else {
      spinner.succeed(`Execution finished with status: ${execution.status} (${totalElapsed})`);
    }

    if (options.json) {
      display.json(execution);
      return;
    }

    displayExecution(execution, agentId);
  } catch (error) {
    spinner.fail('Failed to load execution');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Delete agent
 */
async function deleteAgent(
  agentId: string,
  options: { force?: boolean }
): Promise<void> {
  const bucketSlug = requireBucket();

  // Confirm deletion
  if (!options.force) {
    const confirmed = await prompts.confirm({
      message: 'Delete this agent? This cannot be undone.',
    });

    if (!confirmed) {
      display.info('Cancelled');
      return;
    }
  }

  try {
    spinner.start('Deleting agent...');
    await api.deleteAgent(bucketSlug, agentId);
    spinner.succeed('Agent deleted');
  } catch (error) {
    spinner.fail('Failed to delete agent');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Add follow-up task to an agent
 */
async function addFollowUp(
  agentId: string,
  options: { prompt?: string; json?: boolean }
): Promise<void> {
  const bucketSlug = requireBucket();

  // Get prompt if not provided
  const prompt =
    options.prompt ||
    (await prompts.text({
      message: 'Follow-up instructions:',
      required: true,
    }));

  try {
    spinner.start('Adding follow-up task...');
    const execution = await api.addAgentFollowUp(bucketSlug, agentId, prompt);
    spinner.succeed('Follow-up task started');

    if (options.json) {
      display.json(execution);
      return;
    }

    display.keyValue('Execution ID', execution.id);
    display.keyValue('Status', display.formatStatus(execution.status));

    display.newline();
    display.info(
      `Track progress with: ${chalk.cyan(`cosmic agents executions ${agentId} ${execution.id}`)}`
    );
  } catch (error) {
    spinner.fail('Failed to add follow-up');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Create pull request from agent's work
 */
async function createPR(
  agentId: string,
  options: { title?: string; body?: string; json?: boolean }
): Promise<void> {
  const bucketSlug = requireBucket();

  // Get latest execution
  spinner.start('Loading agent...');
  const executions = await api.listAgentExecutions(bucketSlug, agentId);
  spinner.stop();

  if (executions.length === 0) {
    display.error('No executions found for this agent');
    display.info('Run the agent first to generate code changes.');
    process.exit(1);
  }

  const latestExecution = executions[0];

  // Get PR title if not provided
  const title =
    options.title ||
    (await prompts.text({
      message: 'PR title:',
      required: true,
    }));

  // Get PR body if not provided
  const body =
    options.body ||
    (await prompts.text({
      message: 'PR description (optional):',
      required: false,
    }));

  try {
    spinner.start('Creating pull request...');
    const result = await api.createAgentPR(bucketSlug, agentId, latestExecution.id, {
      title,
      body,
    });

    if (result.success) {
      spinner.succeed('Pull request created');

      if (options.json) {
        display.json(result);
        return;
      }

      if (result.pr_url) {
        display.keyValue('PR URL', chalk.green(result.pr_url));
      }
      if (result.pr_number) {
        display.keyValue('PR Number', `#${result.pr_number}`);
      }
    } else {
      spinner.fail('Failed to create pull request');
    }
  } catch (error) {
    spinner.fail('Failed to create pull request');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Approve pending operations for an agent execution
 */
async function approveOperations(
  agentId: string,
  executionId: string,
  options: { all?: boolean; skip?: boolean; json?: boolean }
): Promise<void> {
  const bucketSlug = requireBucket();

  try {
    // Fetch execution to check status
    spinner.start('Loading execution...');
    const execution = await api.getAgentExecution(bucketSlug, agentId, executionId);
    spinner.stop();

    if (execution.status !== 'pending_review') {
      display.error(`Execution is not pending review (status: ${execution.status})`);
      process.exit(1);
    }

    // Fetch pending operations
    spinner.start('Loading pending operations...');
    const pendingOps = await api.getPendingOperations(bucketSlug, agentId, executionId);
    spinner.stop();

    const totalOps =
      (pendingOps.objects?.length || 0) +
      (pendingOps.object_types?.length || 0) +
      (pendingOps.env_vars?.length || 0);

    if (totalOps === 0) {
      display.info('No pending operations to approve');

      // Mark as complete since there's nothing to approve
      spinner.start('Marking execution as complete...');
      await api.markExecutionComplete(bucketSlug, agentId, executionId);
      spinner.succeed('Execution marked as complete');
      return;
    }

    // Display pending operations
    display.header('Pending Operations');

    if (pendingOps.object_types?.length > 0) {
      display.subheader(`Object Types (${pendingOps.object_types.length})`);
      for (const [index, op] of pendingOps.object_types.entries()) {
        const title = (op.data as { title?: string })?.title || 'Untitled';
        console.log(`  ${chalk.dim(`[${index}]`)} ${chalk.cyan(op.type)}: ${title}`);
      }
    }

    if (pendingOps.objects?.length > 0) {
      display.subheader(`Objects (${pendingOps.objects.length})`);
      for (const [index, op] of pendingOps.objects.entries()) {
        const title = (op.data as { title?: string })?.title || 'Untitled';
        const type = (op.data as { type?: string })?.type || 'unknown';
        console.log(`  ${chalk.dim(`[${index}]`)} ${chalk.cyan(op.type)}: ${title} (${type})`);
      }
    }

    if (pendingOps.env_vars?.length > 0) {
      display.subheader(`Environment Variables (${pendingOps.env_vars.length})`);
      for (const [index, envVar] of pendingOps.env_vars.entries()) {
        console.log(`  ${chalk.dim(`[${index}]`)} ${chalk.yellow(envVar.key)}: ${envVar.description}`);
      }
    }

    display.newline();

    // Skip if --skip flag
    if (options.skip) {
      spinner.start('Skipping operations and marking complete...');
      await api.markExecutionComplete(bucketSlug, agentId, executionId);
      spinner.succeed('Execution marked as complete (operations skipped)');
      return;
    }

    // Confirm approval
    let shouldApprove = options.all;
    if (!shouldApprove) {
      shouldApprove = await prompts.confirm({
        message: `Approve all ${totalOps} operation(s)?`,
        initial: true,
      });
    }

    if (!shouldApprove) {
      display.info('Cancelled');
      return;
    }

    // Execute all operations
    spinner.start('Executing operations...');
    const operations = {
      object_types: pendingOps.object_types?.map((_, i) => i),
      objects: pendingOps.objects?.map((_, i) => i),
      env_vars: pendingOps.env_vars?.map((_, i) => i),
    };

    const result = await api.executeOperations(bucketSlug, agentId, executionId, operations);
    spinner.succeed(`Executed ${totalOps} operation(s)`);

    if (options.json) {
      display.json(result);
      return;
    }

    display.newline();
    display.success('All operations approved and executed');
    display.info(`View execution: ${chalk.cyan(`cosmic agents executions ${agentId} ${executionId}`)}`);
  } catch (error) {
    spinner.fail('Failed to approve operations');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Capture auth from local browser for computer use agents
 */
async function captureAuth(options: {
  url: string;
  label?: string;
  timeout?: string;
  json?: boolean;
}): Promise<void> {
  const bucketSlug = requireBucket();

  try {
    display.info('Opening local browser for authentication...');
    display.info(chalk.yellow('Please log in to the site, then click "Done - Capture Auth" in the banner.'));
    display.newline();

    const timeoutMs = parseInt(options.timeout || '600', 10) * 1000;

    // Capture auth from local browser
    const result = await captureAuthWithDoneButton(options.url, {
      timeout: timeoutMs,
      onStatus: (message) => console.log(chalk.gray(message)),
    });

    display.newline();
    spinner.start('Uploading auth session to Cosmic...');

    // Format cookies for the API
    const formattedCookies = formatCookiesForApi(result.authState.cookies);

    // Upload to Cosmic API
    const response = await api.importAuthSession(bucketSlug, {
      url: result.url,
      cookies: formattedCookies,
      localStorage: result.authState.localStorage,
      label: options.label,
    });

    spinner.succeed('Auth session created');

    if (options.json) {
      display.json(response);
      return;
    }

    display.newline();
    display.keyValue('Session ID', response.session_id);
    display.keyValue('Label', response.auth_info.label);
    display.keyValue('Cookies', response.auth_info.cookies_count.toString());
    display.keyValue('LocalStorage Items', response.auth_info.localStorage_count.toString());
    display.newline();

    display.success('Auth session captured successfully!');
    display.info(`Use this session when creating a computer use agent:`);
    display.info(chalk.cyan(`  cosmic agents create --type computer_use --auth-session ${response.session_id} ...`));
  } catch (error) {
    spinner.fail('Failed to capture auth');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Create agents commands
 */
export function createAgentsCommands(program: Command): void {
  const agentsCmd = program
    .command('agents')
    .description('Manage AI agents');

  agentsCmd
    .command('list')
    .alias('ls')
    .description('List agents')
    .option('--json', 'Output as JSON')
    .action(listAgents);

  agentsCmd
    .command('get <id>')
    .description('Get agent details')
    .option('--json', 'Output as JSON')
    .action(getAgent);

  agentsCmd
    .command('create')
    .alias('add')
    .description('Create a new agent')
    .requiredOption('-t, --type <type>', 'Agent type (content, code/repo/repository, computer_use)')
    .option('-n, --name <name>', 'Agent name')
    .option('-p, --prompt <prompt>', 'Agent prompt')
    .option('-m, --model <model>', 'AI model (default: opus-4.5 for content/repo, haiku-4.5 for computer_use)')
    .option('-e, --emoji <emoji>', 'Agent emoji')
    .option('--repository-id <id>', 'Repository ID (for repository type)')
    .option('--base-branch <branch>', 'Base branch (for repository type)')
    .option('--start-url <url>', 'Start URL (for computer_use type)')
    .option('--goal <goal>', 'Goal (for computer_use type)')
    .option('--types <types>', 'Object type slugs for context (comma-separated)')
    .option('-l, --links <urls>', 'External URLs for context (comma-separated)')
    .option('--objects-limit <n>', 'Max objects per type for context (default: 100)', '100')
    .option('--objects-depth <n>', 'Object depth for nested metafields (default: 1)', '1')
    .option('--email-notifications', 'Enable email notifications')
    .option('--require-approval', 'Require approval before execution')
    .option('--schedule', 'Enable scheduled runs')
    .option('--schedule-type <type>', 'Schedule type: once or recurring (default: recurring)')
    .option('--schedule-frequency <freq>', 'Run frequency: hourly, daily, weekly, monthly (default: daily)')
    .option('--timezone <tz>', 'Timezone for schedule (default: UTC)')
    .option('--auth-session <sessionId>', 'Pre-auth session ID for computer_use agents (from capture-auth)')
    .option('--run', 'Run the agent immediately after creation')
    .option('--json', 'Output as JSON')
    .action(createAgent);

  agentsCmd
    .command('run <id>')
    .description('Run an agent')
    .option('-p, --prompt <prompt>', 'Override prompt')
    .option('--json', 'Output as JSON')
    .action(runAgent);

  agentsCmd
    .command('follow-up <agentId>')
    .alias('followup')
    .description('Add a follow-up task to continue work on the same branch')
    .option('-p, --prompt <prompt>', 'Follow-up instructions')
    .option('--json', 'Output as JSON')
    .action(addFollowUp);

  agentsCmd
    .command('pr <agentId>')
    .alias('pull-request')
    .description('Create a pull request from agent work')
    .option('-t, --title <title>', 'PR title')
    .option('-b, --body <body>', 'PR description')
    .option('--json', 'Output as JSON')
    .action(createPR);

  agentsCmd
    .command('approve <agentId> <executionId>')
    .description('Approve and execute pending operations for an execution')
    .option('-y, --all', 'Approve all operations without confirmation')
    .option('--skip', 'Skip operations and mark execution as complete')
    .option('--json', 'Output as JSON')
    .action(approveOperations);

  agentsCmd
    .command('delete <id>')
    .alias('rm')
    .description('Delete an agent')
    .option('-f, --force', 'Skip confirmation')
    .action(deleteAgent);

  agentsCmd
    .command('executions <agentId> [executionId]')
    .alias('exec')
    .description('List or get agent execution details')
    .option('-w, --watch', 'Watch execution and poll until complete')
    .option('--json', 'Output as JSON')
    .action((agentId, executionId, options) => {
      if (executionId) {
        return getAgentExecution(agentId, executionId, options);
      }
      return listAgentExecutions(agentId, options);
    });

  // Auth capture commands for computer use agents
  agentsCmd
    .command('capture-auth')
    .description('Capture authentication from local browser for computer use agents')
    .requiredOption('-u, --url <url>', 'URL to authenticate on')
    .option('-l, --label <label>', 'Label for this auth session')
    .option('--timeout <seconds>', 'Timeout in seconds (default: 600)', '600')
    .option('--json', 'Output as JSON')
    .action(captureAuth);
}

export default { createAgentsCommands };
