/**
 * Dashboard API - Deployments
 * Deployment operations and AI deploy
 */

import { get, post, patch } from '../client.js';

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
  id: string;
  type: 'stdout' | 'stderr' | 'command' | 'exit';
  text: string;
  created: number;
  serial?: number;
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

export interface DeploymentLogsResponse {
  success: boolean;
  logs?: DeploymentLog[];
  error?: string;
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

export async function getLatestDeploymentStatus(
  bucketSlug: string,
  vercelProjectId?: string
): Promise<DeploymentStatusResponse> {
  try {
    const params: Record<string, string> = {
      slug: bucketSlug,
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
