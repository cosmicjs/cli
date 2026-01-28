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
    spinner.succeed(`Found ${workflows.length} workflow(s)`);

    if (workflows.length === 0) {
      display.info('No workflows found');
      return;
    }

    if (options.json) {
      display.json(workflows);
      return;
    }

    const table = display.createTable({
      head: ['ID', 'Name', 'Status', 'Schedule', 'Steps'],
    });

    for (const workflow of workflows) {
      table.push([
        chalk.dim(workflow.id.slice(0, 8)),
        display.truncate(workflow.workflow_name, 35),
        display.formatStatus(workflow.status),
        workflow.schedule_type,
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
        console.log(
          `  ${chalk.dim(String(index + 1) + '.')} ${step.emoji || '🤖'} ${chalk.cyan(step.agent_name)} (${step.agent_type})`
        );
        if (step.prompt) {
          console.log(`     ${chalk.dim(display.truncate(step.prompt, 60))}`);
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

    display.keyValue('Execution ID', execution.id);
    display.keyValue('Status', display.formatStatus(execution.status));

    display.newline();
    display.info(
      `Track progress with: ${chalk.cyan(`cosmic workflows executions ${execution.id}`)}`
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
        chalk.dim(exec.id.slice(0, 8)),
        chalk.dim(exec.workflow_id.slice(0, 8)),
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

    display.header('Workflow Execution');
    display.keyValue('ID', execution.id);
    display.keyValue('Workflow ID', execution.workflow_id);
    display.keyValue('Status', display.formatStatus(execution.status));
    display.keyValue('Trigger', execution.trigger_type);
    display.keyValue('Started', display.formatDate(execution.started_at));
    display.keyValue('Completed', display.formatDate(execution.completed_at));

    if (execution.current_step !== undefined) {
      display.keyValue('Current Step', String(execution.current_step + 1));
    }

    if (execution.error) {
      display.subheader('Error');
      console.log(chalk.red(execution.error));
    }

    if (execution.step_results && execution.step_results.length > 0) {
      display.subheader('Step Results');
      execution.step_results.forEach((result, index) => {
        const statusIcon =
          result.status === 'completed'
            ? chalk.green('✓')
            : result.status === 'failed'
              ? chalk.red('✗')
              : result.status === 'running'
                ? chalk.blue('●')
                : chalk.dim('○');

        console.log(`  ${statusIcon} Step ${index + 1}: ${result.status}`);
        if (result.error) {
          console.log(`     ${chalk.red(result.error)}`);
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
