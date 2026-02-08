/**
 * Dashboard API - Billing
 * Plan, addon, and usage management for projects
 */

import { get, post, del } from '../client.js';

// ============================================================================
// Types
// ============================================================================

export interface PlanPricing {
  id: string;
  amount: number;
  is_subscribed: boolean;
}

export interface Plan {
  id: string;
  name: string;
  description?: string;
  pricing: Record<string, PlanPricing>; // keyed by interval: "month", "year"
  order?: string;
  buckets?: string;
  team?: string;
  object_types?: string;
  objects?: string;
  api_non_cached?: string;
  api_cached?: string;
  api_bandwidth?: string;
  media_files?: string;
  media_storage?: string;
  media_requests?: string;
  media_bandwidth?: string;
  ai_input_tokens?: string;
  ai_output_tokens?: string;
  agents?: string;
  is_subscribed: boolean;
}

export interface AddonPricing {
  id: string;
  amount: number;
  is_subscribed: boolean;
}

export interface Addon {
  id: string;
  name: string;
  description?: string;
  pricing: Record<string, AddonPricing>; // keyed by interval
  is_subscribed?: boolean;
  is_additional?: boolean; // true for quantity-based addons (additional_buckets, additional_team, etc.)
  extra_info?: string;
  best_value?: boolean;
  order?: string;
}

export interface ProjectUsageResponse {
  usage: {
    total_objects?: number;
    total_object_types?: number;
    api_requests?: {
      non_cached?: number;
      cached?: number;
      bandwidth?: number;
    };
    media?: {
      files?: number;
      storage?: number;
      requests?: number;
      bandwidth?: number;
    };
    ai?: {
      input_tokens?: number;
      output_tokens?: number;
    };
    agents?: {
      total_agents?: number;
    };
  };
  plan_info: {
    max_objects?: string;
    max_object_types?: string;
    api_requests?: {
      max_non_cached?: string;
      max_cached?: string;
      max_bandwidth?: string;
    };
    media?: {
      max_files?: string;
      max_storage?: string;
      max_requests?: string;
      max_bandwidth?: string;
    };
    ai_tokens?: {
      max_input?: string;
      max_output?: string;
    };
    max_agents?: number;
  };
}

// ============================================================================
// Project Billing API Functions
// ============================================================================

export async function listProjectPlans(
  projectId: string
): Promise<Plan[]> {
  const response = await get<{ plans: Plan[] }>(
    '/projects/listPlans',
    { params: { project_id: projectId } }
  );
  return response.plans || [];
}

export async function addProjectPlanSubscription(
  projectId: string,
  priceId: string
): Promise<{ message: string }> {
  const response = await post<{ message: string }>('/projects/addPlanSubscription', {
    project_id: projectId,
    price_id: priceId,
  });
  return response;
}

export async function cancelProjectPlanSubscription(
  projectId: string
): Promise<{ message: string }> {
  const response = await del<{ message: string }>('/projects/cancelPlanSubscription', {
    params: { project_id: projectId },
  });
  return response;
}

export async function listProjectAddons(
  projectId: string
): Promise<Addon[]> {
  const response = await get<{ addons: Addon[] }>(
    '/projects/listAddons',
    { params: { project_id: projectId } }
  );
  return response.addons || [];
}

export async function addProjectAddonSubscription(
  projectId: string,
  addonId: string,
  priceId: string,
  quantity?: number
): Promise<{ message: string }> {
  const body: Record<string, unknown> = {
    project_id: projectId,
    addon_id: addonId,
    price_id: priceId,
  };
  if (quantity !== undefined) {
    body.quantity = quantity;
  }
  const response = await post<{ message: string }>('/projects/addAddonSubscription', body);
  return response;
}

export async function cancelProjectAddonSubscription(
  projectId: string,
  addonId: string
): Promise<{ message: string }> {
  const response = await del<{ message: string }>('/projects/cancelAddonSubscription', {
    params: { project_id: projectId, addon_id: addonId },
  });
  return response;
}

export async function addProjectUserAddon(
  projectId: string,
  quantity: number
): Promise<{ message: string }> {
  const response = await post<{ message: string }>('/projects/addUserAddon', {
    project_id: projectId,
    quantity,
  });
  return response;
}

export async function addProjectBucketAddon(
  projectId: string,
  quantity: number
): Promise<{ message: string }> {
  const response = await post<{ message: string }>('/projects/addBucketAddon', {
    project_id: projectId,
    quantity,
  });
  return response;
}

export async function addProjectAITokensAddon(
  projectId: string,
  inputTokens: number,
  outputTokens: number
): Promise<{ message: string }> {
  const response = await post<{ message: string }>('/projects/addAITokensAddon', {
    project_id: projectId,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
  });
  return response;
}

export async function getProjectBillingPortalUrl(
  projectId: string
): Promise<{ url: string }> {
  const response = await post<{ url: string }>('/projects/billing-portal', {
    project_id: projectId,
  });
  return response;
}

export async function getProjectUsage(
  projectId: string
): Promise<ProjectUsageResponse> {
  const response = await get<ProjectUsageResponse>(
    '/projects/usage',
    { params: { project_id: projectId } }
  );
  return response;
}
