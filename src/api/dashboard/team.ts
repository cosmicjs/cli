/**
 * Dashboard API - Team
 * Project team member management
 */

import { get, post, patch, del } from '../client.js';

// ============================================================================
// Types
// ============================================================================

export interface BucketRole {
  bucket_id: string;
  role: 'admin' | 'developer' | 'editor' | 'contributor';
  publishing_restrictions?: 'draft_only';
  additional_permissions?: string[];
  object_types?: string[];
}

export interface TeamMember {
  id: string;
  user_id?: string;
  email: string;
  first_name?: string;
  last_name?: string;
  avatar_url?: string;
  project_role: 'admin' | 'manager' | 'user';
  bucket_roles?: BucketRole[];
  status?: string;
  created_at?: string;
}

export interface AddTeamMemberUser {
  email: string;
  project_role: 'admin' | 'manager' | 'user';
  bucket_roles?: BucketRole[];
}

export interface AddTeamMemberData {
  users: AddTeamMemberUser[];
}

export interface UpdateTeamMemberData {
  project_role: 'admin' | 'manager' | 'user';
  bucket_roles?: BucketRole[];
}

// ============================================================================
// API Functions
// ============================================================================

export async function listProjectTeam(
  projectId: string
): Promise<TeamMember[]> {
  const response = await get<{ team: TeamMember[] }>(
    '/projects/listTeam',
    { params: { project_id: projectId } }
  );
  return response.team || [];
}

export async function addProjectTeamMember(
  projectId: string,
  data: AddTeamMemberData
): Promise<{ message: string }> {
  const response = await post<{ message: string }>('/projects/addTeamMember', {
    project_id: projectId,
    data,
  });
  return response;
}

export async function updateProjectTeamMember(
  projectId: string,
  userId: string,
  data: UpdateTeamMemberData
): Promise<{ message: string }> {
  const response = await patch<{ message: string }>('/projects/updateTeamMember', {
    project_id: projectId,
    user_id: userId,
    data,
  });
  return response;
}

export async function removeProjectTeamMember(
  projectId: string,
  userId: string
): Promise<void> {
  await del('/projects/deleteTeamMember', {
    params: { project_id: projectId, user_id: userId },
  });
}

export async function searchProjectTeamMember(
  projectId: string,
  email: string
): Promise<TeamMember | null> {
  const response = await post<{ user: TeamMember | null }>('/projects/searchTeamMember', {
    project_id: projectId,
    email,
  });
  return response.user || null;
}
