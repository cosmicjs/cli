/**
 * Dashboard API - Workflows
 * Workflow operations and executions
 */

import { get, post, put, del } from '../client.js';
import type { Workflow, WorkflowExecution, EventTriggerConfig } from '../../types.js';

export interface ListWorkflowsOptions {
  status?: 'active' | 'draft' | 'paused' | 'archived';
  schedule_type?: 'manual' | 'scheduled' | 'event';
  limit?: number;
  skip?: number;
}

export async function listWorkflows(
  bucketSlug: string,
  options: ListWorkflowsOptions = {}
): Promise<Workflow[]> {
  const params: Record<string, unknown> = {};

  if (options.status) params.status = options.status;
  if (options.schedule_type) params.schedule_type = options.schedule_type;
  if (options.limit) params.limit = options.limit;
  if (options.skip) params.skip = options.skip;

  const response = await get<Record<string, unknown>>('/ai/workflows', {
    bucketSlug,
    params,
  });

  if (response && typeof response === 'object') {
    const data = response.data as Record<string, unknown> | undefined;
    if (data && typeof data === 'object' && Array.isArray(data.workflows)) {
      return data.workflows as Workflow[];
    }

    if (Array.isArray(response.workflows)) {
      return response.workflows as Workflow[];
    }

    if (Array.isArray(response)) {
      return response as Workflow[];
    }
  }

  return [];
}

export async function getWorkflow(
  bucketSlug: string,
  workflowId: string
): Promise<Workflow> {
  const response = await get<Record<string, unknown>>(
    `/ai/workflows/${workflowId}`,
    { bucketSlug }
  );

  const data = response.data as Record<string, unknown> | undefined;
  if (data && typeof data === 'object' && data.workflow) {
    return data.workflow as Workflow;
  }

  if (response.workflow) {
    return response.workflow as Workflow;
  }

  throw new Error('Workflow not found');
}

export interface CreateWorkflowData {
  workflow_name: string;
  description?: string;
  emoji?: string;
  steps: Workflow['steps'];
  shared_context?: Record<string, unknown>;
  user_inputs?: Workflow['user_inputs'];
  schedule_type?: Workflow['schedule_type'];
  schedule_config?: Workflow['schedule_config'];
  event_trigger_config?: EventTriggerConfig;
  status?: Workflow['status'];
}

export async function createWorkflow(
  bucketSlug: string,
  data: CreateWorkflowData
): Promise<Workflow> {
  const response = await post<{ workflow?: Workflow; data?: Workflow; success?: boolean } & Workflow>('/ai/workflows', data, {
    bucketSlug,
  });
  return response.workflow || response.data || response;
}

export async function updateWorkflow(
  bucketSlug: string,
  workflowId: string,
  data: Partial<CreateWorkflowData>
): Promise<Workflow> {
  const response = await put<Record<string, unknown>>(
    `/ai/workflows/${workflowId}`,
    data,
    { bucketSlug }
  );

  const responseData = response.data as Record<string, unknown> | undefined;
  if (responseData && typeof responseData === 'object' && responseData.workflow) {
    return responseData.workflow as Workflow;
  }

  if (response.workflow) {
    return response.workflow as Workflow;
  }

  return response as unknown as Workflow;
}

export async function deleteWorkflow(
  bucketSlug: string,
  workflowId: string
): Promise<void> {
  await del(`/ai/workflows/${workflowId}`, { bucketSlug });
}

export interface ExecuteWorkflowOptions {
  user_inputs?: Record<string, unknown>;
}

export async function executeWorkflow(
  bucketSlug: string,
  workflowId: string,
  options: ExecuteWorkflowOptions = {}
): Promise<WorkflowExecution> {
  const response = await post<Record<string, unknown>>(
    `/ai/workflows/${workflowId}/execute`,
    options,
    { bucketSlug }
  );

  const data = response.data as Record<string, unknown> | undefined;
  if (data && typeof data === 'object' && data.execution) {
    return data.execution as WorkflowExecution;
  }

  if (response.execution) {
    return response.execution as WorkflowExecution;
  }

  return response as unknown as WorkflowExecution;
}

export async function listExecutions(
  bucketSlug: string,
  options: { workflow_id?: string; status?: string; limit?: number } = {}
): Promise<{ executions: WorkflowExecution[]; total: number }> {
  const params: Record<string, unknown> = {};

  if (options.workflow_id) params.workflow_id = options.workflow_id;
  if (options.status) params.status = options.status;
  if (options.limit) params.limit = options.limit;

  const response = await get<{
    executions: WorkflowExecution[];
    total: number;
  }>('/ai/executions', { bucketSlug, params });

  return {
    executions: response.executions || [],
    total: response.total || 0,
  };
}

export async function getExecution(
  bucketSlug: string,
  executionId: string
): Promise<WorkflowExecution> {
  const response = await get<Record<string, unknown>>(
    `/ai/executions/${executionId}`,
    { bucketSlug }
  );

  const data = response.data as Record<string, unknown> | undefined;
  if (data && typeof data === 'object' && data.execution) {
    return data.execution as WorkflowExecution;
  }

  if (response.execution) {
    return response.execution as WorkflowExecution;
  }

  return response as unknown as WorkflowExecution;
}

export async function cancelExecution(
  bucketSlug: string,
  executionId: string
): Promise<WorkflowExecution> {
  const response = await post<{ execution: WorkflowExecution }>(
    `/ai/executions/${executionId}/cancel`,
    {},
    { bucketSlug }
  );
  return response.execution;
}

export async function resumeExecution(
  bucketSlug: string,
  executionId: string,
  options: { approved?: boolean } = {}
): Promise<WorkflowExecution> {
  const response = await post<{ execution: WorkflowExecution }>(
    `/ai/executions/${executionId}/resume`,
    options,
    { bucketSlug }
  );
  return response.execution;
}
