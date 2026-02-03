/**
 * Dashboard API - Repositories
 * Repository operations and branch management
 */

import { get, post, patch, del } from '../client.js';

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
