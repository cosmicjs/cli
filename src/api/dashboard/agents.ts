/**
 * Dashboard API - Agents
 * Agent operations, executions, pre-auth sessions, and agent operations
 */

import axios from 'axios';
import { get, post, patch, del } from '../client.js';
import { getWorkersUrl } from '../../config/store.js';
import { getAuthHeaders } from '../../auth/manager.js';
import type { Agent, AgentExecution } from '../../types.js';

// ============================================================================
// Agents
// ============================================================================

export async function listAgents(bucketSlug: string): Promise<Agent[]> {
  const response = await get<{ agents?: Agent[]; data?: Agent[]; success?: boolean }>('/ai/agents', { bucketSlug });
  return response.agents || response.data || [];
}

export async function getAgent(bucketSlug: string, agentId: string): Promise<Agent> {
  const response = await get<{ agent?: Agent; data?: Agent; success?: boolean }>(`/ai/agents/${agentId}`, {
    bucketSlug,
  });
  return response.agent || response.data || (response as unknown as Agent);
}

export interface CreateAgentData {
  agent_name: string;
  agent_type: 'content' | 'repository' | 'computer_use';
  prompt: string;
  model?: string;
  emoji?: string;
  repository_id?: string;
  base_branch?: string;
  start_url?: string;
  goal?: string;
  context?: Record<string, unknown>;
  schedule?: {
    enabled: boolean;
    type?: 'once' | 'recurring';
    frequency?: 'hourly' | 'daily' | 'weekly' | 'monthly';
    next_run_at?: string;
    timezone?: string;
  };
  auth_sessions?: Array<{
    session_id: string;
    auth_state?: unknown;
  }>;
  email_notifications?: boolean;
  require_approval?: boolean;
}

export async function createAgent(
  bucketSlug: string,
  data: CreateAgentData
): Promise<Agent> {
  const response = await post<{ agent?: Agent; data?: Agent; success?: boolean } & Agent>('/ai/agents', data, {
    bucketSlug,
  });
  return response.agent || response.data || response;
}

export async function updateAgent(
  bucketSlug: string,
  agentId: string,
  data: Partial<CreateAgentData>
): Promise<Agent> {
  const response = await patch<{ agent?: Agent; data?: Agent; success?: boolean } & Agent>(
    `/ai/agents/${agentId}`,
    data,
    { bucketSlug }
  );
  return response.agent || response.data || response;
}

export async function deleteAgent(
  bucketSlug: string,
  agentId: string
): Promise<void> {
  await del(`/ai/agents/${agentId}`, { bucketSlug });
}

export async function runAgent(
  bucketSlug: string,
  agentId: string,
  options: { prompt?: string } = {}
): Promise<AgentExecution> {
  const response = await post<{
    execution?: AgentExecution;
    data?: AgentExecution;
    success?: boolean;
    execution_id?: string;
    id?: string;
    _id?: string;
    status?: string;
  }>(
    `/ai/agents/${agentId}/run`,
    options,
    { bucketSlug }
  );

  if (response.execution) {
    return response.execution;
  }
  if (response.data) {
    return response.data;
  }

  const executionId = response.execution_id || response.id || response._id;
  if (executionId) {
    return {
      id: executionId,
      agent_id: agentId,
      status: (response.status as AgentExecution['status']) || 'pending',
    };
  }

  return response as unknown as AgentExecution;
}

export async function listAgentExecutions(
  bucketSlug: string,
  agentId: string
): Promise<AgentExecution[]> {
  const response = await get<{ executions?: AgentExecution[]; data?: { executions: AgentExecution[] }; success?: boolean }>(
    `/ai/agents/${agentId}/executions`,
    { bucketSlug }
  );
  return response.executions || response.data?.executions || [];
}

export async function getAgentExecution(
  bucketSlug: string,
  agentId: string,
  executionId: string
): Promise<AgentExecution> {
  const response = await get<{ execution?: AgentExecution; data?: AgentExecution; success?: boolean }>(
    `/ai/agents/${agentId}/executions/${executionId}`,
    { bucketSlug }
  );
  return response.execution || response.data || (response as unknown as AgentExecution);
}

// ============================================================================
// Pre-Auth Sessions (Computer Use)
// ============================================================================

export interface PreAuthSession {
  session_id: string;
  status: 'awaiting_auth' | 'auth_captured' | 'failed';
  start_url: string;
  auth_info?: {
    label: string;
    cookies_count: number;
    localStorage_count?: number;
    captured_at: string;
    manual_import?: boolean;
  };
  created_at: string;
}

export interface ImportAuthData {
  url: string;
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    expires?: number;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: string;
  }>;
  localStorage?: Record<string, string> | Array<{ name: string; value: string }>;
  label?: string;
}

export interface ImportAuthResponse {
  success: boolean;
  session_id: string;
  auth_info: {
    label: string;
    cookies_count: number;
    localStorage_count: number;
    captured_at: string;
    manual_import: boolean;
  };
}

export async function importAuthSession(
  bucketSlug: string,
  data: ImportAuthData
): Promise<ImportAuthResponse> {
  const workersUrl = getWorkersUrl();
  const authHeaders = getAuthHeaders();

  const response = await axios.post<ImportAuthResponse>(
    `${workersUrl}/buckets/${bucketSlug}/computer-use/pre-auth/manual-import`,
    data,
    {
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders,
      },
    }
  );

  return response.data;
}

export async function deleteAuthSession(
  bucketSlug: string,
  sessionId: string
): Promise<void> {
  const workersUrl = getWorkersUrl();
  const authHeaders = getAuthHeaders();

  await axios.delete(
    `${workersUrl}/buckets/${bucketSlug}/computer-use/pre-auth/${sessionId}`,
    {
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders,
      },
    }
  );
}

// ============================================================================
// Agent Follow-up & PR
// ============================================================================

export async function addAgentFollowUp(
  bucketSlug: string,
  agentId: string,
  prompt: string
): Promise<AgentExecution> {
  const response = await post<{ execution?: AgentExecution; data?: AgentExecution }>(
    `/ai/agents/${agentId}/follow-up`,
    { prompt },
    { bucketSlug }
  );
  return response.execution || response.data || (response as unknown as AgentExecution);
}

export async function createAgentPR(
  bucketSlug: string,
  agentId: string,
  executionId: string,
  data: { title?: string; body?: string } = {}
): Promise<{ success: boolean; pr_url?: string; pr_number?: number }> {
  const response = await post<{ success: boolean; pr_url?: string; pr_number?: number }>(
    `/ai/agents/${agentId}/executions/${executionId}/create-pr`,
    data,
    { bucketSlug }
  );
  return response;
}

// ============================================================================
// Agent Operations (Pending Review)
// ============================================================================

export interface PendingOperation {
  type: 'create' | 'edit';
  data: Record<string, unknown>;
  target_slug?: string;
  target_id?: string;
  detected_at: string;
}

export interface PendingEnvVar {
  key: string;
  value: string;
  description: string;
  required: boolean;
  detected_at: string;
}

export interface PendingOperations {
  object_types: PendingOperation[];
  objects: PendingOperation[];
  env_vars: PendingEnvVar[];
}

export async function getPendingOperations(
  bucketSlug: string,
  agentId: string,
  executionId: string
): Promise<PendingOperations> {
  const response = await get<{ pending_operations: PendingOperations }>(
    `/ai/agents/${agentId}/executions/${executionId}/pending-operations`,
    { bucketSlug }
  );
  return response.pending_operations;
}

export async function executeOperations(
  bucketSlug: string,
  agentId: string,
  executionId: string,
  operations: {
    object_types?: number[];
    objects?: number[];
    env_vars?: number[];
  }
): Promise<{ success: boolean; results?: unknown[] }> {
  const response = await post<{ success: boolean; results?: unknown[] }>(
    `/ai/agents/${agentId}/executions/${executionId}/execute-operations`,
    { operations },
    { bucketSlug }
  );
  return response;
}

export async function markExecutionComplete(
  bucketSlug: string,
  agentId: string,
  executionId: string
): Promise<AgentExecution> {
  const response = await post<{ execution?: AgentExecution; data?: AgentExecution }>(
    `/ai/agents/${agentId}/executions/${executionId}/complete`,
    {},
    { bucketSlug }
  );
  return response.execution || response.data || (response as unknown as AgentExecution);
}
