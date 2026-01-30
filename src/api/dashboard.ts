/**
 * Dashboard API Methods
 * Wraps the Cosmic Dashboard API endpoints
 */

import { get, post, patch, del } from './client.js';
import type {
  Workspace,
  Project,
  Bucket,
  CosmicObject,
  ObjectType,
  Media,
  Workflow,
  WorkflowExecution,
  Agent,
  AgentExecution,
  AIModel,
  AITextRequest,
  AITextResponse,
  CosmicUser,
} from '../types.js';

// ============================================================================
// User & Auth
// ============================================================================

export async function getUser(): Promise<CosmicUser> {
  const response = await get<{ user: CosmicUser }>('/users/get');
  return response.user;
}

// ============================================================================
// Workspaces
// ============================================================================

export async function listWorkspaces(): Promise<Workspace[]> {
  const response = await get<{ workspaces: Workspace[] }>('/workspaces/list');
  return response.workspaces || [];
}

export async function getWorkspace(workspaceId: string): Promise<Workspace> {
  const response = await get<{ workspace: Workspace }>('/workspaces/get', {
    params: { workspace_id: workspaceId },
  });
  return response.workspace;
}

// ============================================================================
// Projects
// ============================================================================

export async function listProjects(
  workspaceId?: string,
  options?: { includeArchived?: boolean }
): Promise<Project[]> {
  // Workspace ID must be passed as a header (optional - if not provided, returns default projects)
  const headers: Record<string, string> = {};
  if (workspaceId) {
    headers.workspace = workspaceId;
  }
  const response = await get<{ projects: Project[] }>('/projects/list', {
    headers,
  });
  
  const projects = response.projects || [];
  
  // Filter out archived projects by default
  if (!options?.includeArchived) {
    return projects.filter((p: Record<string, unknown>) => !p.archived);
  }
  
  return projects;
}

export async function getProject(projectId: string): Promise<Project> {
  const response = await get<{ project: Project }>('/projects/get', {
    params: { project_id: projectId },
  });
  return response.project;
}

// ============================================================================
// Buckets
// ============================================================================

export async function getBucket(bucketSlug: string): Promise<Bucket> {
  const response = await get<{ bucket: Bucket }>('/buckets/get', {
    bucketSlug,
  });
  return response.bucket;
}

// ============================================================================
// Objects
// ============================================================================

export interface ListObjectsOptions {
  type?: string;
  status?: 'published' | 'draft' | 'any';
  limit?: number;
  skip?: number;
  sort?: string;
  query?: Record<string, unknown>;
  props?: string[];
}

export async function listObjects(
  bucketSlug: string,
  options: ListObjectsOptions = {}
): Promise<{ objects: CosmicObject[]; total: number }> {
  const params: Record<string, unknown> = {};

  // Build the query object - type and other filters go inside query JSON
  const queryObj: Record<string, unknown> = options.query || {};
  if (options.type) queryObj.type = options.type;
  if (options.status) queryObj.status = options.status;
  if (options.limit) queryObj.limit = options.limit;
  if (options.skip) queryObj.skip = options.skip;
  if (options.sort) queryObj.sort = options.sort;

  if (Object.keys(queryObj).length > 0) {
    params.query = JSON.stringify(queryObj);
  }
  if (options.props) params.props = options.props.join(',');

  const response = await get<{ objects: CosmicObject[]; total: number }>(
    '/objects/list',
    { bucketSlug, params }
  );

  return {
    objects: response.objects || [],
    total: response.total || 0,
  };
}

export async function getObject(
  bucketSlug: string,
  objectId: string,
  options: { status?: 'published' | 'draft' | 'any' } = {}
): Promise<CosmicObject> {
  const params: Record<string, unknown> = { id: objectId };
  // Default to 'any' to include both published and draft objects
  const queryObj: Record<string, unknown> = { status: options.status || 'any' };
  params.query = JSON.stringify(queryObj);
  
  const response = await get<{ object: CosmicObject }>('/objects/get', {
    bucketSlug,
    params,
  });
  return response.object;
}

export interface CreateObjectData {
  title: string;
  type: string;
  slug?: string;
  content?: string;
  status?: 'published' | 'draft';
  metadata?: Record<string, unknown>;
  locale?: string;
}

export async function createObject(
  bucketSlug: string,
  objectData: CreateObjectData
): Promise<CosmicObject> {
  // API expects { slug: bucketSlug, data: { object fields } }
  const body = {
    slug: bucketSlug,
    data: {
      title: objectData.title,
      slug: objectData.slug,
      type: objectData.type,
      content: objectData.content || '',
      status: objectData.status || 'draft',
      metafields: objectData.metadata ? Object.entries(objectData.metadata).map(([key, value]) => ({
        key,
        value,
      })) : [],
    },
  };

  const response = await post<{ object: CosmicObject }>('/objects/add', body, {});
  return response.object;
}

export interface UpdateObjectData {
  title?: string;
  slug?: string;
  content?: string;
  status?: 'published' | 'draft';
  metadata?: Record<string, unknown>;
}

export async function updateObject(
  bucketSlug: string,
  objectId: string,
  data: UpdateObjectData
): Promise<CosmicObject> {
  const response = await patch<{ object: CosmicObject }>(
    '/objects/update',
    { id: objectId, ...data },
    { bucketSlug }
  );
  return response.object;
}

export async function deleteObjects(
  bucketSlug: string,
  objectIds: string[]
): Promise<void> {
  await post('/objects/deleteByIds', { ids: objectIds }, { bucketSlug });
}

export async function publishObjects(
  bucketSlug: string,
  objectIds: string[]
): Promise<void> {
  await post('/objects/publishByIds', { ids: objectIds }, { bucketSlug });
}

export async function unpublishObjects(
  bucketSlug: string,
  objectIds: string[]
): Promise<void> {
  await post('/objects/unpublishByIds', { ids: objectIds }, { bucketSlug });
}

// ============================================================================
// Object Types - Use SDK per SDK-first principle
// See: https://www.cosmicjs.com/docs/api/object-types
// ============================================================================

import { getSDKClient } from './sdk.js';

export async function listObjectTypes(bucketSlug: string): Promise<ObjectType[]> {
  const sdk = getSDKClient(bucketSlug);
  if (!sdk) {
    throw new Error('SDK client not available');
  }
  const response = await sdk.objectTypes.find();
  return response.object_types || [];
}

export async function getObjectType(
  bucketSlug: string,
  typeSlug: string
): Promise<ObjectType> {
  const sdk = getSDKClient(bucketSlug);
  if (!sdk) {
    throw new Error('SDK client not available');
  }
  const response = await sdk.objectTypes.findOne(typeSlug);
  return response.object_type;
}

export interface CreateObjectTypeData {
  title: string;
  slug?: string;
  singular?: string;
  emoji?: string;
  metafields?: Array<{
    title: string;
    key: string;
    type: string;
    required?: boolean;
    options?: unknown;
  }>;
  options?: {
    slug_field?: boolean;
    content_editor?: boolean;
  };
  singleton?: boolean;
}

// Note: createObjectType is now handled via SDK in chat/repl.ts
// Use sdk.objectTypes.insertOne() instead of DAPI

// ============================================================================
// Media
// ============================================================================

export interface ListMediaOptions {
  folder?: string;
  limit?: number;
  skip?: number;
}

export async function listMedia(
  bucketSlug: string,
  options: ListMediaOptions = {}
): Promise<{ media: Media[]; total: number }> {
  const params: Record<string, unknown> = {};

  if (options.folder) params.folder = options.folder;
  if (options.limit) params.limit = options.limit;
  if (options.skip) params.skip = options.skip;

  const response = await get<{ media: Media[]; total: number }>('/media/list', {
    bucketSlug,
    params,
  });

  return {
    media: response.media || [],
    total: response.total || 0,
  };
}

export async function getMedia(bucketSlug: string, mediaId: string): Promise<Media> {
  const response = await get<{ media: Media }>('/media/get', {
    bucketSlug,
    params: { id: mediaId },
  });
  return response.media;
}

export async function deleteMedia(bucketSlug: string, mediaIds: string[]): Promise<void> {
  await post('/media/deleteByIds', { ids: mediaIds }, { bucketSlug });
}

// ============================================================================
// Workflows
// ============================================================================

export interface ListWorkflowsOptions {
  status?: 'active' | 'draft' | 'paused';
  schedule_type?: 'manual' | 'cron' | 'event_triggered';
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

  const response = await get<{ workflows: Workflow[] }>('/ai/workflows', {
    bucketSlug,
    params,
  });

  return response.workflows || [];
}

export async function getWorkflow(
  bucketSlug: string,
  workflowId: string
): Promise<Workflow> {
  const response = await get<{ workflow: Workflow }>(
    `/ai/workflows/${workflowId}`,
    { bucketSlug }
  );
  return response.workflow;
}

export interface CreateWorkflowData {
  workflow_name: string;
  description?: string;
  steps: Workflow['steps'];
  shared_context?: Record<string, unknown>;
  user_inputs?: Workflow['user_inputs'];
  schedule_type?: Workflow['schedule_type'];
  schedule_config?: Workflow['schedule_config'];
  status?: Workflow['status'];
}

export async function createWorkflow(
  bucketSlug: string,
  data: CreateWorkflowData
): Promise<Workflow> {
  const response = await post<{ workflow?: Workflow; data?: Workflow; success?: boolean } & Workflow>('/ai/workflows', data, {
    bucketSlug,
  });
  // Handle { workflow: {...} }, { data: {...} }, or direct {...} response formats
  return response.workflow || response.data || response;
}

export async function updateWorkflow(
  bucketSlug: string,
  workflowId: string,
  data: Partial<CreateWorkflowData>
): Promise<Workflow> {
  const response = await patch<{ workflow?: Workflow; data?: Workflow; success?: boolean } & Workflow>(
    `/ai/workflows/${workflowId}`,
    data,
    { bucketSlug }
  );
  return response.workflow || response.data || response;
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
  const response = await post<{ execution: WorkflowExecution }>(
    `/ai/workflows/${workflowId}/execute`,
    options,
    { bucketSlug }
  );
  return response.execution;
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
  const response = await get<{ execution: WorkflowExecution }>(
    `/ai/executions/${executionId}`,
    { bucketSlug }
  );
  return response.execution;
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

// ============================================================================
// Agents
// ============================================================================

export async function listAgents(bucketSlug: string): Promise<Agent[]> {
  const response = await get<{ agents?: Agent[]; data?: Agent[]; success?: boolean }>('/ai/agents', { bucketSlug });
  // Handle { agents: [...] }, { data: [...] }, or direct array response formats
  return response.agents || response.data || [];
}

export async function getAgent(bucketSlug: string, agentId: string): Promise<Agent> {
  const response = await get<{ agent?: Agent; data?: Agent; success?: boolean }>(`/ai/agents/${agentId}`, {
    bucketSlug,
  });
  // Handle { agent: {...} }, { data: {...} }, or direct response formats
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
  // Handle { agent: {...} }, { data: {...} }, or direct {...} response formats
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
  const response = await post<{ execution?: AgentExecution; data?: AgentExecution; success?: boolean }>(
    `/ai/agents/${agentId}/run`,
    options,
    { bucketSlug }
  );
  // Handle { execution: {...} }, { data: {...} }, or direct response formats
  return response.execution || response.data || (response as unknown as AgentExecution);
}

export async function listAgentExecutions(
  bucketSlug: string,
  agentId: string
): Promise<AgentExecution[]> {
  const response = await get<{ executions?: AgentExecution[]; data?: { executions: AgentExecution[] }; success?: boolean }>(
    `/ai/agents/${agentId}/executions`,
    { bucketSlug }
  );
  // Handle { executions: [...] } or { data: { executions: [...] } } response formats
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
  // Handle { execution: {...} }, { data: {...} }, or direct response formats
  return response.execution || response.data || (response as unknown as AgentExecution);
}

// ============================================================================
// AI
// ============================================================================

export async function listModels(): Promise<AIModel[]> {
  const response = await get<{ models: AIModel[] }>('/ai/models');
  return response.models || [];
}

export async function generateText(
  bucketSlug: string,
  request: AITextRequest
): Promise<AITextResponse> {
  const response = await post<AITextResponse>('/ai/chat', request, {
    bucketSlug,
  });
  return response;
}

export async function generateImage(
  bucketSlug: string,
  prompt: string,
  options: { folder?: string; alt_text?: string; metadata?: Record<string, unknown> } = {}
): Promise<Media> {
  const response = await post<{ media: Media }>(
    '/ai/generateImage',
    { prompt, ...options },
    { bucketSlug }
  );
  return response.media;
}

export default {
  // User
  getUser,
  // Workspaces
  listWorkspaces,
  getWorkspace,
  // Projects
  listProjects,
  getProject,
  // Buckets
  getBucket,
  // Objects
  listObjects,
  getObject,
  createObject,
  updateObject,
  deleteObjects,
  publishObjects,
  unpublishObjects,
  // Object Types
  listObjectTypes,
  getObjectType,
  // Media
  listMedia,
  getMedia,
  deleteMedia,
  // Workflows
  listWorkflows,
  getWorkflow,
  createWorkflow,
  updateWorkflow,
  deleteWorkflow,
  executeWorkflow,
  listExecutions,
  getExecution,
  cancelExecution,
  // Agents
  listAgents,
  getAgent,
  createAgent,
  updateAgent,
  deleteAgent,
  runAgent,
  listAgentExecutions,
  getAgentExecution,
  // AI
  listModels,
  generateText,
  generateImage,
};
