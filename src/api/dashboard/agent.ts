/**
 * Agent Signup API client.
 *
 * The existing `client.ts` axios wrapper auto-injects user/session auth
 * headers via interceptor, which is wrong for agent signup (no auth) and for
 * verify/status (wrong auth shape: agent_key, not user JWT). We use fetch
 * directly here to keep the auth surface explicit.
 *
 * Endpoints (cosmic-backend public.routes.js):
 *   POST /v3/agents/sign-up
 *   POST /v3/agents/verify   (Authorization: Bearer agk_...)
 *   GET  /v3/agents/status   (Authorization: Bearer agk_...)
 */

import { getApiUrl } from '../../config/store.js';
import { CLI_VERSION } from '../../version.js';

export interface AgentSignupRequest {
  human_email: string;
  project_name: string;
  agent_id: string;
  client?: string;
  prompt_hint?: string;
}

export interface AgentSignupResponse {
  message: string;
  auth_type: 'unclaimed' | 'verified';
  agent_key: string;
  /** User JWT scoped to the shadow user that owns the new project + bucket.
   * Use as `Authorization: Bearer <access_token>` on Dashboard API endpoints
   * to perform user-level operations (object types, webhooks, etc). Auto-
   * revoked when the human claims the bucket (shadow user gets status: 0). */
  access_token?: string;
  project: { id: string; name: string } | null;
  bucket: {
    slug: string;
    read_key?: string;
    write_key?: string;
  } | null;
  claim_url: string;
  limits: {
    ai_credits_remaining: number;
    media_mb_total: number;
    objects_max: number;
  };
  auto_delete_after_days: number;
}

export interface AgentVerifyResponse {
  message: string;
  auth_type: 'verified';
  claim_status: string;
  access_token?: string;
  limits: null;
}

export interface AgentStatusResponse {
  auth_type: 'unclaimed' | 'verified';
  claim_status: string;
  plan_id: string;
  limits: AgentSignupResponse['limits'] | null;
  auto_delete_after_days: number | null;
  /** Fresh user JWT for the shadow user. Returned so a CLI/agent that lost
   * its local credentials can recover its session by hitting /status with
   * just the agent_key. */
  access_token?: string;
  project: { id: string; name: string } | null;
  bucket: { slug: string } | null;
  agent_id: string | null;
  client: string | null;
  human_email: string;
}

async function dapiFetch<T>(
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown; agentKey?: string },
): Promise<T> {
  const url = `${getApiUrl()}${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Origin': 'https://app.cosmicjs.com',
    'User-Agent': `CosmicCLI/${CLI_VERSION}`,
    'X-Cosmic-Client': 'cli',
  };
  if (init.agentKey) {
    headers['Authorization'] = `Bearer ${init.agentKey}`;
  }
  const res = await fetch(url, {
    method: init.method,
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  let parsed: unknown = undefined;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  if (!res.ok) {
    const message =
      typeof parsed === 'object' && parsed !== null && 'message' in parsed
        ? String((parsed as { message?: unknown }).message)
        : `Agent API request failed (${res.status})`;
    const err = new Error(message) as Error & { status: number; code?: string; body?: unknown };
    err.status = res.status;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'code' in parsed &&
      typeof (parsed as { code?: unknown }).code === 'string'
    ) {
      err.code = (parsed as { code: string }).code;
    }
    err.body = parsed;
    throw err;
  }
  return parsed as T;
}

export async function signupAgent(
  body: AgentSignupRequest,
): Promise<AgentSignupResponse> {
  return dapiFetch<AgentSignupResponse>('/agents/sign-up', {
    method: 'POST',
    body,
  });
}

export async function verifyAgent(
  agentKey: string,
  otpCode: string,
): Promise<AgentVerifyResponse> {
  return dapiFetch<AgentVerifyResponse>('/agents/verify', {
    method: 'POST',
    body: { code: otpCode },
    agentKey,
  });
}

export async function getAgentStatus(
  agentKey: string,
): Promise<AgentStatusResponse> {
  return dapiFetch<AgentStatusResponse>('/agents/status', {
    method: 'GET',
    agentKey,
  });
}
