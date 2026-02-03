/**
 * Dashboard API - Core
 * User, Workspaces, Projects, Buckets
 */

import { get, post } from '../client.js';
import type { Workspace, Project, Bucket, CosmicUser } from '../../types.js';

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
  const headers: Record<string, string> = {};
  if (workspaceId) {
    headers.workspace = workspaceId;
  }
  const response = await get<{ projects: Project[] }>('/projects/list', {
    headers,
  });

  const projects = response.projects || [];

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
  ai_prompt?: string;
  plan_id?: string;
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
