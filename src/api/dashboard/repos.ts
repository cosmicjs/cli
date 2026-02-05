/**
 * Dashboard API - Repositories
 * Repository operations and branch management
 */

import { get, post, patch, put, del } from '../client.js';

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

// ============================================================================
// Branch Management
// ============================================================================

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
// Pull Request Management
// ============================================================================

export interface PullRequest {
  number: number;
  title: string;
  body?: string;
  state: 'open' | 'closed';
  head: {
    ref: string;
    sha: string;
  };
  base: {
    ref: string;
    sha: string;
  };
  user: {
    login: string;
    avatar_url?: string;
  };
  html_url: string;
  created_at: string;
  updated_at: string;
  merged_at?: string;
  draft?: boolean;
  mergeable?: boolean;
  mergeable_state?: string;
}

export async function listPullRequests(
  bucketSlug: string,
  repositoryId: string,
  options: {
    state?: 'open' | 'closed' | 'all';
    head?: string;
    base?: string;
    sort?: 'created' | 'updated' | 'popularity' | 'long-running';
    direction?: 'asc' | 'desc';
    per_page?: number;
    page?: number;
  } = {}
): Promise<PullRequest[]> {
  const params: Record<string, unknown> = {};
  if (options.state) params.state = options.state;
  if (options.head) params.head = options.head;
  if (options.base) params.base = options.base;
  if (options.sort) params.sort = options.sort;
  if (options.direction) params.direction = options.direction;
  if (options.per_page) params.per_page = options.per_page;
  if (options.page) params.page = options.page;

  const response = await get<{ pull_requests: PullRequest[] }>(
    `/repositories/${repositoryId}/pull-requests`,
    { bucketSlug, params }
  );
  return response.pull_requests || [];
}

export async function getPullRequest(
  bucketSlug: string,
  repositoryId: string,
  pullNumber: number
): Promise<PullRequest> {
  const response = await get<{ pull_request: PullRequest }>(
    `/repositories/${repositoryId}/pull-requests/${pullNumber}`,
    { bucketSlug }
  );
  return response.pull_request;
}

export interface CreatePullRequestData {
  title: string;
  body?: string;
  head: string;
  base: string;
  draft?: boolean;
  maintainer_can_modify?: boolean;
}

export async function createPullRequest(
  bucketSlug: string,
  repositoryId: string,
  data: CreatePullRequestData
): Promise<PullRequest> {
  const response = await post<{ pull_request: PullRequest }>(
    `/repositories/${repositoryId}/pull-requests`,
    data,
    { bucketSlug }
  );
  return response.pull_request;
}

export interface MergePullRequestData {
  commit_title?: string;
  commit_message?: string;
  merge_method?: 'merge' | 'squash' | 'rebase';
}

export async function mergePullRequest(
  bucketSlug: string,
  repositoryId: string,
  pullNumber: number,
  data: MergePullRequestData = {}
): Promise<{ merged: boolean; message: string; sha?: string }> {
  const response = await put<{ merge_result: { merged: boolean; message: string; sha?: string } }>(
    `/repositories/${repositoryId}/pull-requests/${pullNumber}/merge`,
    data,
    { bucketSlug }
  );
  return response.merge_result;
}

export interface UpdatePullRequestData {
  title?: string;
  body?: string;
  base?: string;
  maintainer_can_modify?: boolean;
}

export async function updatePullRequest(
  bucketSlug: string,
  repositoryId: string,
  pullNumber: number,
  data: UpdatePullRequestData
): Promise<PullRequest> {
  const response = await patch<{ pull_request: PullRequest }>(
    `/repositories/${repositoryId}/pull-requests/${pullNumber}`,
    data,
    { bucketSlug }
  );
  return response.pull_request;
}

export async function closePullRequest(
  bucketSlug: string,
  repositoryId: string,
  pullNumber: number
): Promise<PullRequest> {
  const response = await put<{ pull_request: PullRequest }>(
    `/repositories/${repositoryId}/pull-requests/${pullNumber}/close`,
    {},
    { bucketSlug }
  );
  return response.pull_request;
}

export async function reopenPullRequest(
  bucketSlug: string,
  repositoryId: string,
  pullNumber: number
): Promise<PullRequest> {
  const response = await put<{ pull_request: PullRequest }>(
    `/repositories/${repositoryId}/pull-requests/${pullNumber}/reopen`,
    {},
    { bucketSlug }
  );
  return response.pull_request;
}

// ============================================================================
// Environment Variables
// ============================================================================

export interface RepositoryEnvVar {
  key: string;
  value?: string;
  type: 'encrypted' | 'plain';
  target: string[];
}

export interface AddEnvVarData {
  key: string;
  value: string;
  target: string[]; // ['production', 'preview', 'development']
  type: 'encrypted' | 'plain';
}

export interface UpdateEnvVarData {
  value?: string;
  target?: string[];
  type?: 'encrypted' | 'plain';
}

/**
 * Get environment variables for a repository
 */
export async function getRepositoryEnvVars(
  bucketSlug: string,
  repositoryId: string
): Promise<RepositoryEnvVar[]> {
  const response = await get<{
    envs?: RepositoryEnvVar[];
    env?: RepositoryEnvVar[];
    environment_variables?: RepositoryEnvVar[];
  }>(`/repositories/${repositoryId}/env`, { bucketSlug });
  return (
    response.environment_variables ||
    response.envs ||
    response.env ||
    []
  );
}

/**
 * Add environment variable to a repository
 */
export async function addRepositoryEnvVar(
  bucketSlug: string,
  repositoryId: string,
  data: AddEnvVarData
): Promise<{ created: boolean }> {
  const response = await post<{ created: boolean }>(
    `/repositories/${repositoryId}/env`,
    data,
    { bucketSlug }
  );
  return response;
}

/**
 * Update environment variable for a repository
 */
export async function updateRepositoryEnvVar(
  bucketSlug: string,
  repositoryId: string,
  key: string,
  data: UpdateEnvVarData
): Promise<void> {
  await patch(
    `/repositories/${repositoryId}/env/${encodeURIComponent(key)}`,
    data,
    { bucketSlug }
  );
}

/**
 * Delete environment variable from a repository
 */
export async function deleteRepositoryEnvVar(
  bucketSlug: string,
  repositoryId: string,
  key: string
): Promise<void> {
  await del(
    `/repositories/${repositoryId}/env/${encodeURIComponent(key)}`,
    { bucketSlug }
  );
}

// ============================================================================
// Domain Management (Vercel custom domains for repository deployments)
// ============================================================================

export interface RepositoryDomain {
  name: string;
  verified?: boolean;
  apexName?: string;
  verification?: {
    verified: boolean;
    misconfigured?: boolean;
    verification?: Array<{ type: string; domain: string; value: string }>;
    requirements?: {
      txtVerification?: Record<string, string>;
      verificationRecord?: { type: string; name: string; value: string };
    };
  };
  configuration?: {
    configured: boolean;
    misconfigured?: boolean;
    nameservers?: string[];
    txtVerification?: Record<string, string>;
    cnames?: string[];
    aRecords?: string[];
    aaaaRecords?: string[];
  };
  redirect?: string | null;
  gitBranch?: string | null;
}

export interface ListRepositoryDomainsResponse {
  repository_id: string;
  vercel_project_id: string;
  domains: RepositoryDomain[];
}

export async function listRepositoryDomains(
  bucketSlug: string,
  repositoryId: string
): Promise<ListRepositoryDomainsResponse> {
  const response = await get<ListRepositoryDomainsResponse>(
    `/repositories/${repositoryId}/domains`,
    { bucketSlug }
  );
  return response;
}

export interface AddDomainData {
  domain: string;
  redirect?: string;
  redirectStatusCode?: 301 | 302 | 307 | 308;
}

export async function addRepositoryDomain(
  bucketSlug: string,
  repositoryId: string,
  data: AddDomainData
): Promise<{ repository_id: string; vercel_project_id: string; domain: RepositoryDomain }> {
  const response = await post<{
    repository_id: string;
    vercel_project_id: string;
    domain: RepositoryDomain;
  }>(`/repositories/${repositoryId}/domains`, data, { bucketSlug });
  return response;
}

export interface UpdateDomainData {
  redirect?: string | null;
  redirectStatusCode?: 301 | 302 | 307 | 308;
}

export async function updateRepositoryDomain(
  bucketSlug: string,
  repositoryId: string,
  domain: string,
  data: UpdateDomainData
): Promise<{ repository_id: string; vercel_project_id: string; domain: RepositoryDomain }> {
  const response = await patch<{
    repository_id: string;
    vercel_project_id: string;
    domain: RepositoryDomain;
  }>(`/repositories/${repositoryId}/domains/${encodeURIComponent(domain)}`, data, {
    bucketSlug,
  });
  return response;
}

export async function removeRepositoryDomain(
  bucketSlug: string,
  repositoryId: string,
  domain: string
): Promise<{ repository_id: string; vercel_project_id: string; message: string }> {
  const response = await del<{
    repository_id: string;
    vercel_project_id: string;
    message: string;
  }>(`/repositories/${repositoryId}/domains/${encodeURIComponent(domain)}`, {
    bucketSlug,
  });
  return response;
}
