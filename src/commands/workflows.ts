/**
 * Workflows Commands
 * Workflow management and execution
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { requireBucket } from '../config/context.js';
import * as display from '../utils/display.js';
import * as spinner from '../utils/spinner.js';
import * as prompts from '../utils/prompts.js';
import * as api from '../api/dashboard.js';
import type { Agent, WorkflowStep } from '../types.js';

/**
 * List workflows
 */
async function listWorkflows(options: {
  status?: string;
  scheduleType?: string;
  limit?: string;
  json?: boolean;
}): Promise<void> {
  const bucketSlug = requireBucket();

  try {
    spinner.start('Loading workflows...');
    const workflows = await api.listWorkflows(bucketSlug, {
      status: options.status as 'active' | 'draft' | 'paused',
      schedule_type: options.scheduleType as 'manual' | 'cron' | 'event_triggered',
      limit: options.limit ? parseInt(options.limit, 10) : undefined,
    });

    // Ensure workflows is an array
    const workflowList = Array.isArray(workflows) ? workflows : [];
    spinner.succeed(`Found ${workflowList.length} workflow(s)`);

    if (workflowList.length === 0) {
      display.info('No workflows found');
      return;
    }

    if (options.json) {
      display.json(workflowList);
      return;
    }

    const table = display.createTable({
      head: ['ID', 'Name', 'Status', 'Schedule', 'Steps'],
    });

    for (const workflow of workflowList) {
      table.push([
        chalk.dim(workflow.id || '-'),
        display.truncate(workflow.workflow_name || 'Untitled', 35),
        display.formatStatus(workflow.status || 'draft'),
        workflow.schedule_type || 'manual',
        String(workflow.steps?.length || 0),
      ]);
    }

    console.log(table.toString());
  } catch (error) {
    spinner.fail('Failed to load workflows');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Get workflow details
 */
async function getWorkflow(
  workflowId: string,
  options: { json?: boolean }
): Promise<void> {
  const bucketSlug = requireBucket();

  try {
    spinner.start('Loading workflow...');
    const workflow = await api.getWorkflow(bucketSlug, workflowId);
    spinner.succeed();

    if (options.json) {
      display.json(workflow);
      return;
    }

    display.header(workflow.workflow_name);
    display.keyValue('ID', workflow.id);
    display.keyValue('Status', display.formatStatus(workflow.status));
    display.keyValue('Schedule', workflow.schedule_type);
    if (workflow.description) {
      display.keyValue('Description', workflow.description);
    }
    display.keyValue('Created', display.formatDate(workflow.created_at));
    display.keyValue('Modified', display.formatDate(workflow.modified_at));

    if (workflow.steps && workflow.steps.length > 0) {
      display.subheader(`Steps (${workflow.steps.length})`);
      workflow.steps.forEach((step, index) => {
        // Handle both flat and nested config structures
        const stepAny = step as Record<string, unknown>;
        const config = stepAny.config as Record<string, unknown> | undefined;
        const stepName = stepAny.name || stepAny.agent_name || 'Unnamed';
        const stepEmoji = config?.emoji || stepAny.emoji || '🤖';
        const stepPrompt = config?.prompt || stepAny.prompt;
        console.log(
          `  ${chalk.dim(String(index + 1) + '.')} ${stepEmoji} ${chalk.cyan(stepName)} (${step.agent_type})`
        );
        if (stepPrompt) {
          console.log(`     ${chalk.dim(display.truncate(String(stepPrompt), 60))}`);
        }
      });
    }

    if (workflow.schedule_config?.cron_expression) {
      display.subheader('Schedule Configuration');
      display.keyValue('Enabled', workflow.schedule_config.enabled ? 'Yes' : 'No');
      display.keyValue('Cron', workflow.schedule_config.cron_expression);
      if (workflow.schedule_config.timezone) {
        display.keyValue('Timezone', workflow.schedule_config.timezone);
      }
    }
  } catch (error) {
    spinner.fail('Failed to load workflow');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Execute workflow
 */
async function executeWorkflow(
  workflowId: string,
  options: {
    inputs?: string;
    json?: boolean;
  }
): Promise<void> {
  const bucketSlug = requireBucket();

  try {
    spinner.start('Starting workflow execution...');

    let userInputs: Record<string, unknown> | undefined;
    if (options.inputs) {
      try {
        userInputs = JSON.parse(options.inputs);
      } catch {
        spinner.fail('Invalid inputs JSON');
        process.exit(1);
      }
    }

    const execution = await api.executeWorkflow(bucketSlug, workflowId, {
      user_inputs: userInputs,
    });
    spinner.succeed(`Workflow execution started`);

    if (options.json) {
      display.json(execution);
      return;
    }

    // Handle potentially undefined execution properties
    const execData = execution as Record<string, unknown>;
    const execId = execData.id || execData._id || 'unknown';
    const execStatus = (execData.status as string) || 'pending';

    display.keyValue('Execution ID', String(execId));
    display.keyValue('Status', display.formatStatus(execStatus));

    display.newline();
    display.info(
      `Track progress with: ${chalk.cyan(`cosmic workflows executions ${execId}`)}`
    );
  } catch (error) {
    spinner.fail('Failed to execute workflow');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * List executions
 */
async function listExecutions(options: {
  workflowId?: string;
  status?: string;
  limit?: string;
  json?: boolean;
}): Promise<void> {
  const bucketSlug = requireBucket();

  try {
    spinner.start('Loading executions...');
    const { executions, total } = await api.listExecutions(bucketSlug, {
      workflow_id: options.workflowId,
      status: options.status,
      limit: options.limit ? parseInt(options.limit, 10) : 20,
    });
    spinner.succeed(`Found ${total} execution(s)`);

    if (executions.length === 0) {
      display.info('No executions found');
      return;
    }

    if (options.json) {
      display.json(executions);
      return;
    }

    const table = display.createTable({
      head: ['ID', 'Workflow', 'Status', 'Trigger', 'Started'],
    });

    for (const exec of executions) {
      table.push([
        chalk.dim(exec.id),
        chalk.dim(exec.workflow_id),
        display.formatStatus(exec.status),
        exec.trigger_type,
        display.formatDate(exec.started_at),
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
 * Get execution details
 */
async function getExecution(
  executionId: string,
  options: { json?: boolean }
): Promise<void> {
  const bucketSlug = requireBucket();

  try {
    spinner.start('Loading execution...');
    const execution = await api.getExecution(bucketSlug, executionId);
    spinner.succeed();

    if (options.json) {
      display.json(execution);
      return;
    }

    // Handle potentially undefined execution properties
    const execData = execution as Record<string, unknown>;
    const execId = String(execData.id || execData._id || executionId);
    const execWorkflowId = String(execData.workflow_id || '-');
    const execStatus = String(execData.status || 'unknown');
    const execTrigger = String(execData.trigger_type || 'manual');
    const execStarted = execData.started_at as string | undefined;
    const execCompleted = execData.completed_at as string | undefined;
    const execCurrentStep = execData.current_step as number | undefined;
    const execError = execData.error as string | undefined;
    // API returns 'steps' not 'step_results'
    const execSteps = (execData.steps || execData.step_results) as Array<Record<string, unknown>> | undefined;

    display.header('Workflow Execution');
    display.keyValue('ID', execId);
    display.keyValue('Workflow ID', execWorkflowId);
    display.keyValue('Status', display.formatStatus(execStatus));
    display.keyValue('Trigger', execTrigger);
    display.keyValue('Started', display.formatDate(execStarted));
    display.keyValue('Completed', display.formatDate(execCompleted));

    if (execCurrentStep !== undefined) {
      display.keyValue('Current Step', String(execCurrentStep + 1));
    }

    if (execError) {
      display.subheader('Error');
      console.log(chalk.red(String(execError)));
    }

    if (execSteps && execSteps.length > 0) {
      display.subheader('Step Results');
      execSteps.forEach((result, index) => {
        const resultStatus = String(result.status || 'pending');
        const resultError = result.error_message || result.error;
        const stepName = String(result.name || `Step ${index + 1}`);
        const statusIcon =
          resultStatus === 'completed'
            ? chalk.green('✓')
            : resultStatus === 'failed'
              ? chalk.red('✗')
              : resultStatus === 'running'
                ? chalk.blue('●')
                : resultStatus === 'waiting_approval'
                  ? chalk.yellow('⏸')
                  : chalk.dim('○');

        console.log(`  ${statusIcon} ${stepName}: ${resultStatus}`);
        if (resultError) {
          console.log(`     ${chalk.dim(String(resultError))}`);
        }
      });
    }
  } catch (error) {
    spinner.fail('Failed to load execution');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Cancel execution
 */
async function cancelExecution(executionId: string): Promise<void> {
  const bucketSlug = requireBucket();

  try {
    spinner.start('Cancelling execution...');
    const execution = await api.cancelExecution(bucketSlug, executionId);
    spinner.succeed(`Execution cancelled`);

    display.keyValue('Status', display.formatStatus(execution.status));
  } catch (error) {
    spinner.fail('Failed to cancel execution');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Create workflow
 */
async function createWorkflow(options: {
  name?: string;
  description?: string;
  agent?: string;
  scheduleType?: string;
  status?: string;
  json?: boolean;
}): Promise<void> {
  const bucketSlug = requireBucket();

  // Get name if not provided
  const name =
    options.name ||
    (await prompts.text({
      message: 'Workflow name:',
      required: true,
    }));

  // Get description if not provided
  const description =
    options.description ||
    (await prompts.text({
      message: 'Description (optional):',
      required: false,
    }));

  // Workflows require at least one step - get initial agent
  let agentId = options.agent;
  if (!agentId) {
    // List agents and let user select
    spinner.start('Loading agents...');
    const agents = await api.listAgents(bucketSlug);
    spinner.stop();

    if (agents.length === 0) {
      display.error('No agents found. Workflows require at least one step.');
      display.info(`Create an agent first: ${chalk.cyan('cosmic agents create')}`);
      process.exit(1);
    }

    const agentChoices = agents.map((agent) => ({
      name: agent.id,
      message: `${agent.emoji || '🤖'} ${agent.agent_name} (${agent.agent_type})`,
    }));

    agentId = await prompts.select({
      message: 'Select initial agent for the workflow:',
      choices: agentChoices,
    });
  }

  try {
    // Fetch the agent
    spinner.start('Loading agent...');
    const agent = await api.getAgent(bucketSlug, agentId);
    spinner.stop();

    // Convert agent to step (step_number 1 for initial step)
    const initialStep = agentToWorkflowStep(agent, 1);

    spinner.start('Creating workflow...');

    const data: api.CreateWorkflowData = {
      workflow_name: name,
      description: description || undefined,
      steps: [initialStep],
      schedule_type: (options.scheduleType as 'manual' | 'cron' | 'event_triggered') || 'manual',
      status: (options.status as 'active' | 'draft' | 'paused') || 'draft',
    };

    const workflow = await api.createWorkflow(bucketSlug, data);

    // Handle different response formats - the API might return the workflow directly or nested
    const workflowData = workflow as Record<string, unknown>;
    const workflowName = workflowData.workflow_name || workflowData.name || name;
    const workflowId = workflowData.id || workflowData._id || '';
    const workflowStatus = (workflowData.status as string) || 'draft';
    const workflowSchedule = (workflowData.schedule_type as string) || 'manual';

    spinner.succeed(`Created workflow: ${chalk.cyan(workflowName)}`);

    if (options.json) {
      display.json(workflow);
      return;
    }

    display.keyValue('ID', workflowId || '-');
    display.keyValue('Status', display.formatStatus(workflowStatus));
    display.keyValue('Schedule', workflowSchedule);

    display.newline();
    display.subheader('Steps (1)');
    console.log(`  ${chalk.dim('1.')} ${agent.emoji || '🤖'} ${chalk.cyan(agent.agent_name)} (${agent.agent_type})`);

    display.newline();
    if (workflowId) {
      display.info(`Add more agents with: ${chalk.cyan(`cosmic workflows add-step ${workflowId} --agent <agent-id>`)}`);
    }
  } catch (error) {
    spinner.fail('Failed to create workflow');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Convert agent to workflow step format
 * Matches the dashboard's AddToWorkflowModal agentToStep function
 */
function agentToWorkflowStep(agent: Agent, stepNumber: number): Record<string, unknown> {
  const step: Record<string, unknown> = {
    step_number: stepNumber,
    type: 'agent',
    name: agent.agent_name,
    agent_type: agent.agent_type,
    config: {
      emoji: agent.emoji,
      prompt: agent.prompt,
      model: agent.model,
      context: agent.context,
      email_notifications: agent.email_notifications,
      require_approval: agent.require_approval,
    },
    wait_for_completion: true,
  };

  // Add repository-specific fields to config
  if (agent.agent_type === 'repository') {
    (step.config as Record<string, unknown>).repository_id = agent.repository_id;
    (step.config as Record<string, unknown>).base_branch = agent.base_branch;
  }

  // Add computer_use-specific fields to config
  if (agent.agent_type === 'computer_use') {
    (step.config as Record<string, unknown>).start_url = agent.start_url;
    (step.config as Record<string, unknown>).goal = agent.goal;
  }

  return step;
}

/**
 * Add an agent as a step to a workflow
 */
async function addStepToWorkflow(
  workflowId: string,
  options: {
    agent?: string;
    json?: boolean;
  }
): Promise<void> {
  const bucketSlug = requireBucket();

  // Get agent ID if not provided
  let agentId = options.agent;
  if (!agentId) {
    // List agents and let user select
    spinner.start('Loading agents...');
    const agents = await api.listAgents(bucketSlug);
    spinner.stop();

    if (agents.length === 0) {
      display.error('No agents found');
      display.info(`Create an agent first: ${chalk.cyan('cosmic agents create')}`);
      process.exit(1);
    }

    const agentChoices = agents.map((agent) => ({
      name: agent.id,
      message: `${agent.emoji || '🤖'} ${agent.agent_name} (${agent.agent_type})`,
    }));

    agentId = await prompts.select({
      message: 'Select agent to add:',
      choices: agentChoices,
    });
  }

  try {
    // Fetch the agent
    spinner.start('Loading agent...');
    const agent = await api.getAgent(bucketSlug, agentId);
    spinner.stop();

    // Fetch the workflow
    spinner.start('Loading workflow...');
    const workflow = await api.getWorkflow(bucketSlug, workflowId);
    spinner.stop();

    // Handle potentially missing steps array
    const existingSteps = workflow.steps || [];

    // Convert agent to step format
    const newStep = agentToWorkflowStep(agent, existingSteps.length + 1);

    // Update workflow with new step
    spinner.start('Adding step to workflow...');
    const updatedWorkflow = await api.updateWorkflow(bucketSlug, workflowId, {
      steps: [...existingSteps, newStep],
    });
    const updatedSteps = updatedWorkflow.steps || [];
    spinner.succeed(`Added ${chalk.cyan(agent.agent_name)} as step ${updatedSteps.length}`);

    if (options.json) {
      display.json(updatedWorkflow);
      return;
    }

    display.newline();
    display.subheader(`Steps (${updatedSteps.length})`);
    updatedSteps.forEach((step, index) => {
      const stepAny = step as Record<string, unknown>;
      const config = stepAny.config as Record<string, unknown> | undefined;
      const stepName = stepAny.name || stepAny.agent_name || 'Unnamed';
      const stepEmoji = config?.emoji || stepAny.emoji || '🤖';
      const marker = index === updatedSteps.length - 1 ? chalk.green('→') : ' ';
      console.log(
        `  ${marker} ${chalk.dim(String(index + 1) + '.')} ${stepEmoji} ${chalk.cyan(stepName)} (${step.agent_type})`
      );
    });

    display.newline();
    display.info(`View workflow: ${chalk.cyan(`cosmic workflows get ${workflowId}`)}`);
  } catch (error) {
    spinner.fail('Failed to add step');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Remove a step from a workflow
 */
async function removeStepFromWorkflow(
  workflowId: string,
  options: {
    step?: string;
    force?: boolean;
    json?: boolean;
  }
): Promise<void> {
  const bucketSlug = requireBucket();

  try {
    // Fetch the workflow
    spinner.start('Loading workflow...');
    const workflow = await api.getWorkflow(bucketSlug, workflowId);
    spinner.stop();

    if (workflow.steps.length === 0) {
      display.error('Workflow has no steps to remove');
      process.exit(1);
    }

    // Get step number if not provided
    let stepNumber: number;
    if (options.step) {
      stepNumber = parseInt(options.step, 10);
    } else {
      // Show steps and let user select
      display.subheader('Current Steps');
      workflow.steps.forEach((step, index) => {
        const stepAny = step as Record<string, unknown>;
        const config = stepAny.config as Record<string, unknown> | undefined;
        const stepName = stepAny.name || stepAny.agent_name || 'Unnamed';
        const stepEmoji = config?.emoji || stepAny.emoji || '🤖';
        console.log(
          `  ${chalk.dim(String(index + 1) + '.')} ${stepEmoji} ${chalk.cyan(stepName)} (${step.agent_type})`
        );
      });
      display.newline();

      const stepStr = await prompts.text({
        message: 'Step number to remove:',
        required: true,
      });
      stepNumber = parseInt(stepStr, 10);
    }

    // Validate step number
    if (stepNumber < 1 || stepNumber > workflow.steps.length) {
      display.error(`Invalid step number. Must be between 1 and ${workflow.steps.length}`);
      process.exit(1);
    }

    const stepToRemove = workflow.steps[stepNumber - 1];

    // Confirm deletion
    if (!options.force) {
      const confirmed = await prompts.confirm({
        message: `Remove step ${stepNumber} (${stepToRemove.agent_name})?`,
      });

      if (!confirmed) {
        display.info('Cancelled');
        return;
      }
    }

    // Remove the step
    const newSteps = workflow.steps.filter((_, index) => index !== stepNumber - 1);

    spinner.start('Removing step...');
    const updatedWorkflow = await api.updateWorkflow(bucketSlug, workflowId, {
      steps: newSteps,
    });
    spinner.succeed(`Removed step ${stepNumber} (${stepToRemove.agent_name})`);

    if (options.json) {
      display.json(updatedWorkflow);
      return;
    }

    if (updatedWorkflow.steps.length > 0) {
      display.newline();
      display.subheader(`Remaining Steps (${updatedWorkflow.steps.length})`);
      updatedWorkflow.steps.forEach((step, index) => {
        const stepAny = step as Record<string, unknown>;
        const config = stepAny.config as Record<string, unknown> | undefined;
        const stepName = stepAny.name || stepAny.agent_name || 'Unnamed';
        const stepEmoji = config?.emoji || stepAny.emoji || '🤖';
        console.log(
          `  ${chalk.dim(String(index + 1) + '.')} ${stepEmoji} ${chalk.cyan(stepName)} (${step.agent_type})`
        );
      });
    } else {
      display.info('Workflow now has no steps');
    }
  } catch (error) {
    spinner.fail('Failed to remove step');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Delete workflow
 */
async function deleteWorkflow(
  workflowId: string,
  options: { force?: boolean }
): Promise<void> {
  const bucketSlug = requireBucket();

  // Confirm deletion
  if (!options.force) {
    const confirmed = await prompts.confirm({
      message: 'Delete this workflow? This cannot be undone.',
    });

    if (!confirmed) {
      display.info('Cancelled');
      return;
    }
  }

  try {
    spinner.start('Deleting workflow...');
    await api.deleteWorkflow(bucketSlug, workflowId);
    spinner.succeed('Workflow deleted');
  } catch (error) {
    spinner.fail('Failed to delete workflow');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Create workflows commands
 */
export function createWorkflowsCommands(program: Command): void {
  const workflowsCmd = program
    .command('workflows')
    .alias('wf')
    .description('Manage AI workflows');

  workflowsCmd
    .command('list')
    .alias('ls')
    .description('List workflows')
    .option('-s, --status <status>', 'Filter by status (active, draft, paused)')
    .option('--schedule-type <type>', 'Filter by schedule type (manual, cron, event_triggered)')
    .option('-l, --limit <number>', 'Limit results')
    .option('--json', 'Output as JSON')
    .action(listWorkflows);

  workflowsCmd
    .command('get <id>')
    .description('Get workflow details')
    .option('--json', 'Output as JSON')
    .action(getWorkflow);

  workflowsCmd
    .command('create')
    .alias('add')
    .description('Create a new workflow (requires at least one agent as initial step)')
    .option('-n, --name <name>', 'Workflow name')
    .option('-d, --description <description>', 'Workflow description')
    .option('-a, --agent <agentId>', 'Initial agent ID for the first step')
    .option('--schedule-type <type>', 'Schedule type (manual, cron, event_triggered)', 'manual')
    .option('--status <status>', 'Initial status (draft, active, paused)', 'draft')
    .option('--json', 'Output as JSON')
    .action(createWorkflow);

  workflowsCmd
    .command('add-step <workflowId>')
    .description('Add an agent as a step to a workflow')
    .option('-a, --agent <agentId>', 'Agent ID to add as step')
    .option('--json', 'Output as JSON')
    .action(addStepToWorkflow);

  workflowsCmd
    .command('remove-step <workflowId>')
    .description('Remove a step from a workflow')
    .option('-s, --step <stepNumber>', 'Step number to remove (1-based)')
    .option('-f, --force', 'Skip confirmation')
    .option('--json', 'Output as JSON')
    .action(removeStepFromWorkflow);

  workflowsCmd
    .command('run <id>')
    .alias('execute')
    .description('Execute a workflow')
    .option('-i, --inputs <json>', 'User inputs as JSON')
    .option('--json', 'Output as JSON')
    .action(executeWorkflow);

  workflowsCmd
    .command('delete <id>')
    .alias('rm')
    .description('Delete a workflow')
    .option('-f, --force', 'Skip confirmation')
    .action(deleteWorkflow);

  workflowsCmd
    .command('executions [executionId]')
    .alias('exec')
    .description('List or get execution details')
    .option('-w, --workflow-id <id>', 'Filter by workflow ID')
    .option('-s, --status <status>', 'Filter by status')
    .option('-l, --limit <number>', 'Limit results', '20')
    .option('--json', 'Output as JSON')
    .action((executionId, options) => {
      if (executionId) {
        return getExecution(executionId, options);
      }
      return listExecutions(options);
    });

  workflowsCmd
    .command('cancel <executionId>')
    .description('Cancel a running execution')
    .action(cancelExecution);
}

export default { createWorkflowsCommands };
