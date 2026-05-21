/**
 * Agent Signup Commands
 *
 * `cosmic agent-signup`  : provision an unclaimed Cosmic project + bucket
 *                          tied to a human's email.
 * `cosmic agent-verify`  : submit the 6-digit OTP from the claim email.
 * `cosmic agent-status`  : show current auth_type, plan, claim status.
 * `cosmic agent-use`     : promote the stored agent bucket to the active CLI
 *                          context so `cosmic ls`, `cosmic content`, etc.
 *                          operate on it.
 * `cosmic agent-keys`    : reveal the full bucket read/write keys stored
 *                          during signup.
 *
 * Credentials persist to ~/.cosmic/credentials.json under the `agent` slot
 * so subsequent verify/status/use/keys calls don't need the agent_key on
 * the CLI.
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
  setContext,
  clearConfigValue,
} from '../config/store.js';
import { clearSDKClient } from '../api/sdk.js';
import { formatContext } from '../config/context.js';
import * as display from '../utils/display.js';
import * as prompts from '../utils/prompts.js';
import * as spinner from '../utils/spinner.js';

const UNCLAIMED_TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const VERIFIED_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;

function truncateKey(key: string | undefined): string {
  if (!key) return chalk.dim('(none)');
  if (key.length <= 12) return key;
  return `${key.substring(0, 8)}...${key.substring(key.length - 4)}`;
}

interface ActivateInput {
  accessToken: string;
  authType: 'unclaimed' | 'verified';
  humanEmail: string;
  bucketSlug?: string;
  readKey?: string;
  writeKey?: string;
  projectName?: string;
  projectId?: string;
}

/**
 * Promote a fresh agent session to the active CLI session: store the user
 * JWT and bucket keys at the top level and switch context. This makes
 * `cosmic ls`, `cosmic types create`, `cosmic objects`, etc. operate on the
 * new bucket immediately without an explicit `cosmic agent-use` step.
 */
function activateAgentSession(input: ActivateInput): void {
  const ttlMs =
    input.authType === 'verified' ? VERIFIED_TOKEN_TTL_MS : UNCLAIMED_TOKEN_TTL_MS;
  setCredentials({
    accessToken: input.accessToken,
    expiresAt: Date.now() + ttlMs,
    user: {
      id: '',
      email: input.humanEmail,
      first_name: 'Agent',
      last_name: input.projectName ?? '',
    },
    ...(input.bucketSlug && { bucketSlug: input.bucketSlug }),
    ...(input.readKey && { readKey: input.readKey }),
    ...(input.writeKey && { writeKey: input.writeKey }),
  });

  clearConfigValue('currentWorkspace');
  clearConfigValue('currentWorkspaceId');
  setContext(
    undefined,
    input.projectName,
    input.bucketSlug,
    undefined,
    input.projectId,
  );

  clearSDKClient();
}

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

    const previousCreds = getCredentials();
    const previousEmail = previousCreds.user?.email;
    const previousIsAgent =
      previousCreds.user?.first_name === 'Agent' || !previousCreds.user;

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

    if (result.access_token) {
      activateAgentSession({
        accessToken: result.access_token,
        authType: result.auth_type,
        humanEmail,
        bucketSlug: result.bucket?.slug,
        readKey: result.bucket?.read_key,
        writeKey: result.bucket?.write_key,
        projectName: result.project?.name,
        projectId: result.project?.id,
      });
    }

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
    display.keyValue('Read key', truncateKey(result.bucket?.read_key));
    display.keyValue('Write key', truncateKey(result.bucket?.write_key));

    display.newline();
    if (result.access_token) {
      display.success(
        `Switched to ${chalk.cyan(result.bucket?.slug ?? 'new bucket')}. Run ${chalk.cyan('cosmic ls')}, ${chalk.cyan('cosmic types create')}, etc.`,
      );
      if (previousEmail && !previousIsAgent) {
        display.info(
          `Previous login as ${chalk.cyan(previousEmail)} was replaced. Run ${chalk.cyan('cosmic login')} to switch back.`,
        );
      }
    } else {
      display.info(`To start using this bucket now, run ${chalk.cyan('cosmic agent-use')}.`);
    }

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

    if (result.access_token) {
      activateAgentSession({
        accessToken: result.access_token,
        authType: result.auth_type,
        humanEmail: creds.agent.humanEmail,
        bucketSlug: creds.agent.bucketSlug,
        readKey: creds.agent.readKey,
        writeKey: creds.agent.writeKey,
        projectName: creds.agent.projectName,
        projectId: creds.agent.projectId,
      });
    }

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

    // If the server returned a fresh access_token and we're already running
    // as this agent session (or have nothing else active), refresh the
    // top-level JWT so it doesn't expire silently.
    if (result.access_token) {
      const credsNow = getCredentials();
      const sameSession =
        credsNow.user?.email === result.human_email ||
        !credsNow.accessToken;
      if (sameSession) {
        activateAgentSession({
          accessToken: result.access_token,
          authType: result.auth_type,
          humanEmail: result.human_email,
          bucketSlug: result.bucket?.slug,
          readKey: creds.agent.readKey,
          writeKey: creds.agent.writeKey,
          projectName: result.project?.name,
          projectId: result.project?.id ?? creds.agent.projectId,
        });
      }
    }

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

async function agentUseCommand(): Promise<void> {
  const creds = getCredentials();
  if (!creds.agent?.agentKey) {
    display.error(
      `No agent project found. Run ${chalk.cyan('cosmic agent-signup')} first.`,
    );
    process.exit(1);
  }

  const agent = creds.agent;
  if (!agent.bucketSlug || !agent.readKey || !agent.writeKey) {
    display.error(
      `Agent slot is missing bucket keys. Run ${chalk.cyan('cosmic agent-signup')} again.`,
    );
    process.exit(1);
  }

  // Fetch a fresh access_token via /agents/status so the user JWT is current
  // and we can install it as the active session. The agent_key is durable;
  // the access_token rotates on every /status call (cheap, low-risk).
  let accessToken: string | undefined;
  let authType: 'unclaimed' | 'verified' = agent.authType ?? 'unclaimed';
  try {
    spinner.start('Refreshing agent session...');
    const status = await getAgentStatus(agent.agentKey);
    spinner.stop();
    accessToken = status.access_token;
    authType = status.auth_type;
  } catch (error) {
    spinner.stop();
    display.dim(
      `Could not refresh access token (${(error as Error).message}); switching with bucket keys only.`,
    );
  }

  if (accessToken) {
    activateAgentSession({
      accessToken,
      authType,
      humanEmail: agent.humanEmail,
      bucketSlug: agent.bucketSlug,
      readKey: agent.readKey,
      writeKey: agent.writeKey,
      projectName: agent.projectName,
      projectId: agent.projectId,
    });
  } else {
    setCredentials({
      bucketSlug: agent.bucketSlug,
      readKey: agent.readKey,
      writeKey: agent.writeKey,
    });
    clearConfigValue('currentWorkspace');
    clearConfigValue('currentWorkspaceId');
    setContext(
      undefined,
      agent.projectName,
      agent.bucketSlug,
      undefined,
      agent.projectId,
    );
    clearSDKClient();
  }

  display.success(`Switched to ${chalk.cyan(agent.bucketSlug)} bucket.`);
  display.keyValue('Context', formatContext());
  display.newline();
  if (accessToken) {
    display.dim(
      `User-level Dashboard API access enabled. ${authType === 'unclaimed' ? 'Unclaimed limits still apply until you run cosmic agent-verify.' : 'Standard plan limits apply.'}`,
    );
  } else {
    display.dim(
      `Run ${chalk.cyan('cosmic agent-status')} to check claim state and refresh your session.`,
    );
  }
}

async function agentKeysCommand(): Promise<void> {
  const creds = getCredentials();
  if (!creds.agent?.agentKey) {
    display.error(
      `No agent project found. Run ${chalk.cyan('cosmic agent-signup')} first.`,
    );
    process.exit(1);
  }

  const agent = creds.agent;
  display.header('Agent Bucket Keys');
  display.keyValue('Bucket', agent.bucketSlug ?? chalk.dim('(none)'));
  display.keyValue('Read key', agent.readKey ?? chalk.dim('(none)'));
  display.keyValue('Write key', agent.writeKey ?? chalk.dim('(none)'));
  display.keyValue('Agent key', agent.agentKey);
  display.newline();
  display.dim(
    `Run ${chalk.cyan('cosmic agent-use')} to set these as your active bucket.`,
  );
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

  program
    .command('agent-use')
    .description(
      'Switch the active CLI context to the bucket created by the most recent agent-signup.',
    )
    .action(agentUseCommand);

  program
    .command('agent-keys')
    .description('Show the full bucket keys stored from the most recent agent-signup.')
    .action(agentKeysCommand);
}

export default { createAgentCommands };
