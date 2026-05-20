/**
 * Agent Signup Commands
 *
 * `cosmic agent-signup`  : provision an unclaimed Cosmic project + bucket
 *                          tied to a human's email.
 * `cosmic agent-verify`  : submit the 6-digit OTP from the claim email.
 * `cosmic agent-status`  : show current auth_type, plan, claim status.
 *
 * Credentials persist to ~/.cosmic/credentials.json under the `agent` slot
 * so subsequent verify/status calls don't need the agent_key on the CLI.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import {
  signupAgent,
  verifyAgent,
  getAgentStatus,
  type AgentSignupResponse,
} from '../api/dashboard/agent.js';
import {
  getCredentials,
  setCredentials,
} from '../config/store.js';
import * as display from '../utils/display.js';
import * as prompts from '../utils/prompts.js';
import * as spinner from '../utils/spinner.js';

const DEFAULT_AGENT_ID = 'cosmic-cli';

interface AgentSignupOptions {
  email?: string;
  project?: string;
  agentId?: string;
  client?: string;
  promptHint?: string;
}

async function agentSignupCommand(options: AgentSignupOptions): Promise<void> {
  const humanEmail =
    options.email ||
    (await prompts.text({
      message: "Human's email address (required):",
      required: true,
    }));

  const projectName =
    options.project ||
    (await prompts.text({
      message: 'Project name:',
      required: true,
    }));

  const agentId = options.agentId || DEFAULT_AGENT_ID;

  try {
    spinner.start('Creating agent project...');
    const result: AgentSignupResponse = await signupAgent({
      human_email: humanEmail,
      project_name: projectName,
      agent_id: agentId,
      ...(options.client && { client: options.client }),
      ...(options.promptHint && { prompt_hint: options.promptHint }),
    });
    spinner.succeed('Agent project created.');

    setCredentials({
      agent: {
        agentKey: result.agent_key,
        bucketSlug: result.bucket?.slug,
        readKey: result.bucket?.read_key,
        writeKey: result.bucket?.write_key,
        humanEmail,
        projectId: result.project?.id,
        projectName: result.project?.name,
        authType: result.auth_type,
      },
    });

    display.newline();
    display.header('Agent Project');
    display.keyValue('Project', result.project?.name ?? '(unknown)');
    display.keyValue('Bucket', result.bucket?.slug ?? '(unknown)');
    display.keyValue('Auth type', result.auth_type);
    display.keyValue(
      'Limits',
      `${result.limits.ai_credits_remaining} AI credits, ${result.limits.objects_max} objects, ${result.limits.media_mb_total} MB media`,
    );
    display.keyValue(
      'Auto-delete in',
      `${result.auto_delete_after_days} days (unless claimed)`,
    );

    display.newline();
    display.info(
      `An email with a 6-digit claim code was sent to ${chalk.cyan(humanEmail)}.`,
    );
    display.info(
      `When the human gives you the code, run ${chalk.cyan('cosmic agent-verify <code>')}.`,
    );
    display.info(
      `Or have the human visit ${chalk.cyan(result.claim_url)} to claim from the dashboard.`,
    );

    display.newline();
    display.dim('Stored agent_key and bucket keys in ~/.cosmic/credentials.json (agent slot).');
  } catch (error) {
    spinner.fail('Agent signup failed');
    const err = error as Error & { status?: number; code?: string };
    if (err.code === 'user_already_exists') {
      display.error(err.message);
      display.info(
        `Ask the human to log in at ${chalk.cyan('https://app.cosmicjs.com')} and grant the agent a bucket key instead.`,
      );
    } else {
      display.error(err.message);
    }
    process.exit(1);
  }
}

async function agentVerifyCommand(otpArg?: string): Promise<void> {
  const creds = getCredentials();
  if (!creds.agent?.agentKey) {
    display.error(
      `No agent_key found. Run ${chalk.cyan('cosmic agent-signup')} first.`,
    );
    process.exit(1);
  }

  const otp =
    otpArg ||
    (await prompts.text({
      message: 'Enter the 6-digit OTP from the claim email:',
      required: true,
    }));

  try {
    spinner.start('Verifying agent project...');
    const result = await verifyAgent(creds.agent.agentKey, otp);
    spinner.succeed('Verified. Restricted-mode limits lifted.');

    setCredentials({
      agent: {
        ...creds.agent,
        authType: result.auth_type,
      },
    });

    display.newline();
    display.info('The bucket is now on standard free-tier limits.');
    display.info(
      `Run ${chalk.cyan('cosmic agent-status')} to see current plan and quotas.`,
    );
  } catch (error) {
    spinner.fail('Verification failed');
    display.error((error as Error).message);
    process.exit(1);
  }
}

async function agentStatusCommand(): Promise<void> {
  const creds = getCredentials();
  if (!creds.agent?.agentKey) {
    display.error(
      `No agent_key found. Run ${chalk.cyan('cosmic agent-signup')} first.`,
    );
    process.exit(1);
  }

  try {
    spinner.start('Fetching agent status...');
    const result = await getAgentStatus(creds.agent.agentKey);
    spinner.stop();

    display.header('Agent Status');
    display.keyValue('Human email', result.human_email);
    display.keyValue('Agent ID', result.agent_id ?? '(none)');
    display.keyValue('Client', result.client ?? '(none)');
    display.keyValue('Project', result.project?.name ?? '(none)');
    display.keyValue('Bucket', result.bucket?.slug ?? '(none)');
    display.keyValue('Plan', result.plan_id);
    display.keyValue('Auth type', result.auth_type);
    display.keyValue('Claim status', result.claim_status);
    if (result.limits) {
      display.keyValue(
        'Limits',
        `${result.limits.ai_credits_remaining} AI credits, ${result.limits.objects_max} objects, ${result.limits.media_mb_total} MB media`,
      );
    }
    if (result.auto_delete_after_days) {
      display.keyValue(
        'Auto-delete in',
        `${result.auto_delete_after_days} days (unless claimed)`,
      );
    }
  } catch (error) {
    spinner.fail('Failed to fetch agent status');
    display.error((error as Error).message);
    process.exit(1);
  }
}

export function createAgentCommands(program: Command): void {
  program
    .command('agent-signup')
    .description(
      'Provision a new Cosmic project + bucket tied to a human email (no prior login needed).',
    )
    .option('-e, --email <email>', "Human's email address")
    .option('-p, --project <name>', 'Project name')
    .option('--agent-id <id>', `Agent platform identifier (default: ${DEFAULT_AGENT_ID})`)
    .option('--client <client>', 'Optional client identifier (e.g. "cursor-1.0.5")')
    .option('--prompt-hint <text>', 'Optional summary of what the human asked for')
    .action(agentSignupCommand);

  program
    .command('agent-verify [otp]')
    .description('Submit the 6-digit OTP from the claim email to lift restricted-mode limits.')
    .action(agentVerifyCommand);

  program
    .command('agent-status')
    .description('Show the current agent project status, plan, and tier limits.')
    .action(agentStatusCommand);
}

export default { createAgentCommands };
