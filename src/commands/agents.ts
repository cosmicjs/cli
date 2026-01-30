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
      head: ['ID', 'Name', 'Type', 'Model', 'Created'],
    });

    for (const agent of agents) {
      table.push([
        agent.id || '-',
        `${agent.emoji || '🤖'} ${display.truncate(agent.agent_name || '', 30)}`,
        agent.agent_type || '-',
        agent.model || 'default',
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
 * Create agent
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
}): Promise<void> {
  const bucketSlug = requireBucket();

  // Get name if not provided
  const name =
    options.name ||
    (await prompts.text({
      message: 'Agent name:',
      required: true,
    }));

  // Get prompt if not provided
  const prompt =
    options.prompt ||
    (await prompts.text({
      message: 'Prompt (instructions for the agent):',
      required: true,
    }));

  try {
    spinner.start('Creating agent...');

    const data: api.CreateAgentData = {
      agent_name: name,
      agent_type: options.type as 'content' | 'repository' | 'computer_use',
      prompt,
      model: options.model,
      emoji: options.emoji,
      repository_id: options.repositoryId,
      base_branch: options.baseBranch,
      start_url: options.startUrl,
      goal: options.goal,
      email_notifications: options.emailNotifications,
      require_approval: options.requireApproval,
    };

    const agent = await api.createAgent(bucketSlug, data);
    spinner.succeed(`Created agent: ${chalk.cyan(agent.agent_name)}`);

    if (options.json) {
      display.json(agent);
    } else {
      display.keyValue('ID', agent.id);
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

    display.keyValue('Execution ID', execution.id);
    display.keyValue('Status', display.formatStatus(execution.status));

    display.newline();
    display.info(
      `Track progress with: ${chalk.cyan(`cosmic agents executions ${agentId} ${execution.id}`)}`
    );
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
 * Get agent execution details
 */
async function getAgentExecution(
  agentId: string,
  executionId: string,
  options: { json?: boolean }
): Promise<void> {
  const bucketSlug = requireBucket();

  try {
    spinner.start('Loading execution...');
    const execution = await api.getAgentExecution(bucketSlug, agentId, executionId);
    spinner.succeed();

    if (options.json) {
      display.json(execution);
      return;
    }

    display.header('Agent Execution');
    display.keyValue('ID', execution.id);
    display.keyValue('Agent ID', execution.agent_id);
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
    .requiredOption('-t, --type <type>', 'Agent type (content, repository, computer_use)')
    .option('-n, --name <name>', 'Agent name')
    .option('-p, --prompt <prompt>', 'Agent prompt')
    .option('-m, --model <model>', 'AI model to use')
    .option('-e, --emoji <emoji>', 'Agent emoji')
    .option('--repository-id <id>', 'Repository ID (for repository type)')
    .option('--base-branch <branch>', 'Base branch (for repository type)')
    .option('--start-url <url>', 'Start URL (for computer_use type)')
    .option('--goal <goal>', 'Goal (for computer_use type)')
    .option('--email-notifications', 'Enable email notifications')
    .option('--require-approval', 'Require approval before execution')
    .option('--json', 'Output as JSON')
    .action(createAgent);

  agentsCmd
    .command('run <id>')
    .description('Run an agent')
    .option('-p, --prompt <prompt>', 'Override prompt')
    .option('--json', 'Output as JSON')
    .action(runAgent);

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
    .option('--json', 'Output as JSON')
    .action((agentId, executionId, options) => {
      if (executionId) {
        return getAgentExecution(agentId, executionId, options);
      }
      return listAgentExecutions(agentId, options);
    });
}

export default { createAgentsCommands };
