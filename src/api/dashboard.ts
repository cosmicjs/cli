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

export interface CreateProjectData {
  project_title: string;
  bucket_title: string;
  description?: string;
  workspace?: string;
  ai_prompt?: string;    // For AI-generated content model
  plan_id?: string;      // Default: 'free'
}

export async function createProject(
  data: CreateProjectData,
  workspaceId?: string
): Promise<{ project: Project; bucket: Bucket }> {
  const headers: Record<string, string> = {};
  if (workspaceId) {
    headers.workspace = workspaceId;
  }

  const response = await post<{ project: Project; bucket: Bucket }>(
    '/projects/addProjectWithBucket',
    data,
    { config: { headers } }
  );
  return response;
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

/**
 * Create a new object type using DAPI (like the dashboard does)
 * This is more reliable than the SDK for complex object types
 */
export async function createObjectType(
  bucketSlug: string,
  objectType: CreateObjectTypeData
): Promise<ObjectType> {
  const response = await post<{ object_type: ObjectType }>('/objectTypes/add', {
    slug: bucketSlug,
    data: objectType,
  });
  return response.object_type;
}

/**
 * Create a new object with full metafields support using DAPI (like the dashboard does)
 * This handles complex metafields with id, title, key, type, value, etc.
 */
export async function createObjectWithMetafields(
  bucketSlug: string,
  object: {
    title: string;
    slug?: string;
    type: string;
    content?: string;
    status?: string;
    thumbnail?: string;
    locale?: string;
    metafields?: Array<{
      id?: string;
      title?: string;
      key: string;
      type: string;
      value?: unknown;
      required?: boolean;
    }>;
  }
): Promise<CosmicObject> {
  const response = await post<{ object: CosmicObject }>('/objects/add', {
    slug: bucketSlug,
    data: object,
  });
  return response.object;
}

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

  // Handle various response formats:
  // - { execution: {...} }
  // - { data: {...} }
  // - { execution_id: "...", status: "..." }
  // - { id: "...", status: "..." }
  // - Direct AgentExecution object
  if (response.execution) {
    return response.execution;
  }
  if (response.data) {
    return response.data;
  }

  // Handle flat response with execution_id or id
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

// ============================================================================
// Repositories
// ============================================================================

export interface Repository {
  id: string;
  _id?: string;
  user: string;
  bucket: string;
  repository_name: string;
  repository_url: string;
  repository_owner?: string;
  branch?: string;
  default_branch?: string;
  platform: string;
  framework: string;
  created_at: string;
  updated_at?: string;
  vercel_project_id?: string;
  production_url?: string;
  screenshot_url?: string;
}

export interface Branch {
  name: string;
  sha: string;
  url?: string;
  protected?: boolean;
}

export async function listRepositories(
  bucketSlug: string,
  options: { limit?: number; skip?: number } = {}
): Promise<{ repositories: Repository[]; total: number }> {
  const params: Record<string, unknown> = {};
  if (options.limit) params.limit = options.limit;
  if (options.skip) params.skip = options.skip;

  const response = await get<{ repositories: Repository[]; total?: number }>(
    '/repositories',
    { bucketSlug, params }
  );

  return {
    repositories: response.repositories || [],
    total: response.total || response.repositories?.length || 0,
  };
}

export async function getRepository(
  bucketSlug: string,
  repositoryId: string
): Promise<Repository> {
  const response = await get<{ repository: Repository }>(
    `/repositories/${repositoryId}`,
    { bucketSlug }
  );
  return response.repository;
}

export interface CreateRepositoryData {
  repository_name: string;
  repository_url: string;
  platform?: string;
  framework?: string;
  repository_type?: 'reference' | 'clone_public' | 'connect_private';
}

export async function createRepository(
  bucketSlug: string,
  data: CreateRepositoryData
): Promise<Repository> {
  const response = await post<{ repository: Repository }>(
    '/repositories',
    data,
    { bucketSlug }
  );
  return response.repository;
}

export async function updateRepository(
  bucketSlug: string,
  repositoryId: string,
  data: { vercel_project_id?: string; production_url?: string }
): Promise<Repository> {
  const response = await patch<{ repository: Repository }>(
    `/repositories/${repositoryId}`,
    data,
    { bucketSlug }
  );
  return response.repository;
}

export async function deleteRepository(
  bucketSlug: string,
  repositoryId: string
): Promise<void> {
  await del(`/repositories/${repositoryId}`, { bucketSlug });
}

// Branch management
export async function listBranches(
  bucketSlug: string,
  repositoryId: string
): Promise<Branch[]> {
  const response = await get<{ branches: Branch[] }>(
    `/repositories/${repositoryId}/branches`,
    { bucketSlug }
  );
  return response.branches || [];
}

export async function createBranch(
  bucketSlug: string,
  repositoryId: string,
  data: { branch_name: string; source_branch: string }
): Promise<Branch> {
  const response = await post<{ branch: Branch }>(
    `/repositories/${repositoryId}/branches`,
    data,
    { bucketSlug }
  );
  return response.branch;
}

export async function deleteBranch(
  bucketSlug: string,
  repositoryId: string,
  branchName: string
): Promise<void> {
  await del(
    `/repositories/${repositoryId}/branches/${encodeURIComponent(branchName)}`,
    { bucketSlug }
  );
}

// ============================================================================
// Deployments
// ============================================================================

export interface Deployment {
  uid: string;
  name: string;
  url: string;
  state: 'BUILDING' | 'READY' | 'ERROR' | 'CANCELED' | 'QUEUED';
  created: number;
  source?: string;
  meta?: {
    githubCommitRef?: string;
    githubCommitSha?: string;
    githubCommitMessage?: string;
  };
}

export interface DeploymentLog {
  text: string;
  type: 'stdout' | 'stderr';
  timestamp: number;
}

export async function deployRepository(
  bucketSlug: string,
  repositoryId: string
): Promise<{ success: boolean; deployment_url?: string; vercel_project_id?: string }> {
  const response = await post<{ success: boolean; deployment_url?: string; vercel_project_id?: string }>(
    `/repositories/${repositoryId}/deploy`,
    {},
    { bucketSlug }
  );
  return response;
}

export async function listDeployments(
  bucketSlug: string,
  vercelProjectId: string,
  options: { limit?: number; since?: number; until?: number } = {}
): Promise<{ deployments: Deployment[]; total?: number }> {
  const params: Record<string, unknown> = {
    vercel_project_id: vercelProjectId,
  };
  if (options.limit) params.limit = options.limit;
  if (options.since) params.since = options.since;
  if (options.until) params.until = options.until;

  const response = await get<{ deployments: Deployment[]; total?: number }>(
    '/deployments',
    { bucketSlug, params }
  );

  return {
    deployments: response.deployments || [],
    total: response.total,
  };
}

export async function getLatestDeployment(
  bucketSlug: string,
  repositoryId: string
): Promise<Deployment | null> {
  try {
    const response = await get<{ deployment: Deployment }>(
      `/repositories/${repositoryId}/deployments/latest`,
      { bucketSlug }
    );
    return response.deployment;
  } catch {
    return null;
  }
}

export async function getDeploymentLogs(
  deploymentId: string
): Promise<DeploymentLogsResponse> {
  try {
    const response = await get<{ logs: DeploymentLog[]; success: boolean }>(
      `/deployments/${deploymentId}/logs`
    );
    return { success: true, logs: response.logs || [] };
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message || 'Failed to get deployment logs',
    };
  }
}

export async function cancelDeployment(
  bucketSlug: string,
  repositoryId: string,
  deploymentId: string
): Promise<{ success: boolean; message?: string }> {
  const response = await patch<{ success: boolean; message?: string }>(
    `/repositories/${repositoryId}/deployments/${deploymentId}/cancel`,
    {},
    { bucketSlug }
  );
  return response;
}

export interface DeploymentStatusResponse {
  success: boolean;
  deployment?: {
    deploymentId: string;
    name?: string;
    url: string;
    status: 'BUILDING' | 'READY' | 'ERROR' | 'CANCELED' | 'QUEUED' | 'INITIALIZING';
    createdAt?: number;
    meta?: {
      buildingAt?: number;
      readyAt?: number;
      error?: { message?: string; code?: string } | null;
    };
  };
  error?: string;
  message?: string;
}

export interface DeploymentLog {
  id: string;
  type: 'stdout' | 'stderr' | 'command' | 'exit';
  text: string;
  created: number;
  serial?: number;
}

export interface DeploymentLogsResponse {
  success: boolean;
  logs?: DeploymentLog[];
  error?: string;
}

/**
 * Get the latest deployment status for a project using its Vercel project ID
 * If vercelProjectId is not provided, the backend will look it up from the bucket's repository
 */
export async function getLatestDeploymentStatus(
  bucketSlug: string,
  vercelProjectId?: string
): Promise<DeploymentStatusResponse> {
  try {
    // The backend requires 'slug' as both a path param AND a query param
    const params: Record<string, string> = {
      slug: bucketSlug, // Required query param
    };
    if (vercelProjectId) {
      params.vercelProjectId = vercelProjectId;
    }

    const response = await get<DeploymentStatusResponse>(
      `/deployments/latest/${bucketSlug}`,
      { params }
    );
    return response;
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message || 'Failed to get deployment status',
    };
  }
}

// ============================================================================
// AI Deploy (Build App from Scratch)
// ============================================================================

export interface DeployAIAppData {
  platform: 'github';
  web_platform?: 'vercel';
  framework: string;
  name: string;
  ai_response: string;
  message_id?: string;
  private: boolean;
  slug: string;
  organization?: string;
}

export interface DeployAIAppResponse {
  success: boolean;
  data?: {
    repository_url?: string;
    repositoryUrl?: string;
    deployment_url?: string;
    deploymentUrl?: string;
    vercel_project_id?: string;
    production_url?: string;
    repository_id?: string;
  };
  error?: string;
  setupUrl?: string;
}

export async function deployAIApp(data: DeployAIAppData): Promise<DeployAIAppResponse> {
  // Generate a UUID for message_id if not provided (required by the backend schema)
  const message_id = data.message_id || crypto.randomUUID();
  const response = await post<DeployAIAppResponse>('/ai/deploy', { ...data, message_id }, {});
  return response;
}

export interface RepoAvailabilityResponse {
  success: boolean;
  github_repository: {
    available: boolean;
    message: string;
    suggestions?: string[];
  };
  vercel_project?: {
    available: boolean;
    message: string;
    project_name?: string;
  };
}

export async function checkRepoAvailability(
  repositoryName: string,
  organization?: string
): Promise<RepoAvailabilityResponse> {
  const response = await post<RepoAvailabilityResponse>(
    '/users/github/repository/availability',
    { repository_name: repositoryName, organization },
    {}
  );
  return response;
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
// AI Chat with Streaming (Dashboard API)
// ============================================================================

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: Array<{ type: 'text'; text: string }>;
}

export interface StreamingChatOptions {
  messages: ChatMessage[];
  bucketSlug: string;
  model?: string;
  maxTokens?: number;
  viewMode?: 'content-model' | 'build-app';
  selectedObjectTypes?: string[];
  links?: string[]; // URLs for the backend to crawl for context
  contextConfig?: {
    objects?: {
      enabled: boolean;
      object_types?: string[];
      include_models?: boolean;
      limit?: number;
      props?: string[];
    };
  };
  metadata?: {
    chat_mode?: string;
    [key: string]: unknown;
  };
  onChunk?: (chunk: string) => void;
  onProgress?: (progress: { stage: string; message?: string; percentage?: number }) => void;
  onComplete?: (fullText: string, messageId?: string) => void;
  onError?: (error: Error) => void;
}

/**
 * Stream AI chat response from Dashboard API
 * Uses the backend's build-app prompt when viewMode is 'build-app'
 */
export async function streamingChat(options: StreamingChatOptions): Promise<{ text: string; messageId?: string }> {
  const {
    messages,
    bucketSlug,
    model = 'claude-opus-4-5-20251101',
    maxTokens = 32000,
    viewMode = 'build-app',
    selectedObjectTypes = [],
    links,
    contextConfig,
    metadata: extraMetadata,
    onChunk,
    onProgress,
    onComplete,
    onError,
  } = options;

  const { getApiUrl } = await import('../config/store.js');
  const { getAuthHeaders } = await import('../auth/manager.js');
  const baseUrl = getApiUrl();
  const authHeaders = getAuthHeaders();

  const endpoint = `${baseUrl}/ai/chat?slug=${bucketSlug}`;

  // Dashboard API requires Origin header for CORS
  const headers: Record<string, string> = {
    ...authHeaders,
    'Content-Type': 'application/json',
    'Origin': 'https://app.cosmicjs.com',
    'User-Agent': 'CosmicCLI/1.0.0',
  };

  const requestPayload: Record<string, unknown> = {
    messages,
    model,
    stream: true,
    max_tokens: maxTokens,
    metadata: {
      view_mode: viewMode,
      chat_mode: extraMetadata?.chat_mode || 'agent',
      selected_object_types: selectedObjectTypes,
      ...extraMetadata,
    },
    // Context configuration - include object types so AI knows bucket structure
    context: contextConfig || {
      objects: {
        enabled: true,
        object_types: selectedObjectTypes.length > 0 ? selectedObjectTypes : undefined, // undefined = all types
        include_models: true, // Include content model definitions
        limit: 100,
      },
      // Include bucket info
      bucket: {
        enabled: true,
        include_object_types: true,
        include_media: false,
      },
    },
  };

  // Add links for URL crawling if provided
  if (links && links.length > 0) {
    requestPayload.links = links;
  }

  let fullText = '';
  let messageId: string | undefined;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestPayload),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `HTTP error: ${response.status}`);
    }

    if (!response.body) {
      throw new Error('No response body for streaming');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    // The Dashboard API sends raw text chunks mixed with JSON metadata lines
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });

      // Filter out metadata JSON lines (data: {...}) from the display content
      // These are sent by the backend for frontend processing but shouldn't be shown to users
      const lines = chunk.split('\n');
      let filteredChunk = '';

      for (const line of lines) {
        // Skip lines that are JSON metadata (data: {...})
        if (line.trim().startsWith('data: {')) {
          // Try to extract message_id from metadata
          try {
            const jsonStr = line.trim().replace(/^data:\s*/, '');
            const data = JSON.parse(jsonStr);
            if (data.metadata?.message_id && !messageId) {
              messageId = data.metadata.message_id;
            }
          } catch {
            // Ignore parsing errors
          }
          continue; // Don't add to filtered chunk
        }
        filteredChunk += line + '\n';
      }

      // Remove trailing newline if original chunk didn't have one
      if (!chunk.endsWith('\n') && filteredChunk.endsWith('\n')) {
        filteredChunk = filteredChunk.slice(0, -1);
      }

      fullText += filteredChunk;

      // Call onChunk callback with the filtered text chunk
      if (filteredChunk) {
        onChunk?.(filteredChunk);
      }

      // Try to extract message_id from the stream (it's embedded in HTML comments)
      const messageIdMatch = fullText.match(/<!--\s*MESSAGE_ID:\s*([a-f0-9-]+)\s*-->/i);
      if (messageIdMatch && !messageId) {
        messageId = messageIdMatch[1];
      }

      // Extract progress from PROGRESS markers embedded in the response
      const progressMatch = chunk.match(/<!--\s*PROGRESS:\s*(\{.*?\})\s*-->/);
      if (progressMatch) {
        try {
          const progressData = JSON.parse(progressMatch[1]);
          onProgress?.({
            stage: 'building',
            message: progressData.filename || `File ${progressData.current}/${progressData.total}`,
            percentage: progressData.total ? (progressData.current / progressData.total) * 100 : undefined,
          });
        } catch {
          // Ignore progress parsing errors
        }
      }
    }

    onComplete?.(fullText, messageId);
    return { text: fullText, messageId };
  } catch (error) {
    onError?.(error as Error);
    throw error;
  }
}

// ============================================================================
// AI Repository Update with Streaming (for fixing build errors)
// ============================================================================

export interface RepositoryUpdateOptions {
  repositoryOwner: string;
  repositoryName: string;
  repositoryId?: string;
  bucketSlug: string;
  messages: ChatMessage[];
  branch?: string;
  model?: string;
  maxTokens?: number;
  buildLogs?: string;
  chatMode?: 'agent' | 'ask';  // ask mode = read-only questions, agent mode = can make changes
  onChunk?: (chunk: string) => void;
  onProgress?: (progress: { stage: string; message?: string; percentage?: number }) => void;
  onComplete?: (fullText: string, requestId?: string) => void;
  onError?: (error: Error) => void;
}

/**
 * Stream AI repository update response
 * Used for fixing build errors by sending logs to the AI
 */
export async function streamingRepositoryUpdate(options: RepositoryUpdateOptions): Promise<{ text: string; requestId?: string }> {
  const {
    repositoryOwner,
    repositoryName,
    repositoryId,
    bucketSlug,
    messages,
    branch = 'main',
    model = 'claude-opus-4-5-20251101',
    maxTokens = 32000,
    chatMode = 'agent',  // Default to agent mode (can make changes)
    onChunk,
    onProgress,
    onComplete,
    onError,
  } = options;

  const { getApiUrl } = await import('../config/store.js');
  const { getAuthHeaders } = await import('../auth/manager.js');
  const baseUrl = getApiUrl();
  const authHeaders = getAuthHeaders();

  const endpoint = `${baseUrl}/ai/chat/update-repository?slug=${bucketSlug}`;

  const headers: Record<string, string> = {
    ...authHeaders,
    'Content-Type': 'application/json',
    'Origin': 'https://app.cosmicjs.com',
    'User-Agent': 'CosmicCLI/1.0.0',
  };

  // Transform messages to the format expected by the backend
  // Backend expects content as array of objects: [{ type: 'text', text: '...' }]
  const formattedMessages = messages.map((msg) => ({
    role: msg.role,
    content: [{ type: 'text', text: msg.content }],
  }));

  const requestPayload = {
    repository_owner: repositoryOwner,
    repository_name: repositoryName,
    repository_id: repositoryId,
    messages: formattedMessages,
    branch,
    model,
    max_tokens: maxTokens,
    stream: true,
    slug: bucketSlug,
    metadata: {
      chat_mode: chatMode,  // 'ask' for read-only questions, 'agent' for making changes
    },
  };

  let fullText = '';
  let requestId: string | undefined;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestPayload),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `HTTP error: ${response.status}`);
    }

    if (!response.body) {
      throw new Error('No response body for streaming');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      buffer += chunk;

      // Process complete SSE lines
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        const trimmedLine = line.trim();

        // Skip empty lines and SSE comments
        if (!trimmedLine || trimmedLine.startsWith(':')) {
          continue;
        }

        // Handle SSE data events
        if (trimmedLine.startsWith('data: ')) {
          const dataContent = trimmedLine.slice(6); // Remove 'data: ' prefix

          // Check if it's JSON
          if (dataContent.startsWith('{')) {
            try {
              const data = JSON.parse(dataContent);

              // Extract request_id from metadata
              if (data.metadata?.request_id && !requestId) {
                requestId = data.metadata.request_id;
              }

              // Extract text content - check common SSE text fields
              const textContent = data.text || data.content || data.delta?.content || data.choices?.[0]?.delta?.content || '';
              if (textContent) {
                fullText += textContent;
                onChunk?.(textContent);
              }

              // Handle progress updates
              if (data.progress || data.stage) {
                onProgress?.({
                  stage: data.stage || 'updating',
                  message: data.message || data.progress?.message,
                  percentage: data.progress?.percentage,
                });
              }
            } catch {
              // Not JSON, treat as plain text
              fullText += dataContent;
              onChunk?.(dataContent);
            }
          } else if (dataContent !== '[DONE]') {
            // Plain text data (not JSON, not [DONE])
            fullText += dataContent;
            onChunk?.(dataContent);
          }
        }
      }

      // Also check for HTML-comment style markers in raw chunk
      const progressMatch = chunk.match(/<!--\s*PROGRESS:\s*(\{.*?\})\s*-->/);
      if (progressMatch) {
        try {
          const progressData = JSON.parse(progressMatch[1]);
          onProgress?.({
            stage: 'updating',
            message: progressData.filename || `File ${progressData.current}/${progressData.total}`,
            percentage: progressData.total ? (progressData.current / progressData.total) * 100 : undefined,
          });
        } catch {
          // Ignore progress parsing errors
        }
      }

      // Extract request_id from HTML comments
      const requestIdMatch = chunk.match(/<!--\s*REQUEST_ID:\s*([a-f0-9-]+)\s*-->/i);
      if (requestIdMatch && !requestId) {
        requestId = requestIdMatch[1];
      }
    }

    onComplete?.(fullText, requestId);
    return { text: fullText, requestId };
  } catch (error) {
    onError?.(error as Error);
    throw error;
  }
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
  addAgentFollowUp,
  createAgentPR,
  // Repositories
  listRepositories,
  getRepository,
  createRepository,
  updateRepository,
  deleteRepository,
  listBranches,
  createBranch,
  deleteBranch,
  // Deployments
  deployRepository,
  listDeployments,
  getLatestDeployment,
  getLatestDeploymentStatus,
  getDeploymentLogs,
  cancelDeployment,
  // AI Deploy
  deployAIApp,
  checkRepoAvailability,
  // AI Chat (Dashboard API with streaming)
  streamingChat,
  streamingRepositoryUpdate,
  // AI
  listModels,
  generateText,
  generateImage,
};
