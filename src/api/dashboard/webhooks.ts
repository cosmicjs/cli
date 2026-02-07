/**
 * Dashboard API - Webhooks
 * Webhook CRUD operations
 */

import { get, post, patch, del } from '../client.js';

// ============================================================================
// Types
// ============================================================================

export interface WebhookHeader {
  key: string;
  value: string;
}

export interface Webhook {
  id: string;
  title: string;
  endpoint: string;
  resource: 'objects' | 'media' | 'merge_request';
  events: string[];
  payload?: boolean;
  props?: string;
  object_types?: string[];
  headers?: WebhookHeader[];
  created_at?: string;
  modified_at?: string;
}

export interface CreateWebhookData {
  title: string;
  endpoint: string;
  resource: 'objects' | 'media' | 'merge_request';
  events: string[];
  payload?: boolean;
  props?: string;
  object_types?: string[];
  headers?: WebhookHeader[];
}

export interface UpdateWebhookData {
  title?: string;
  endpoint?: string;
  resource?: 'objects' | 'media' | 'merge_request';
  events?: string[];
  payload?: boolean;
  props?: string;
  object_types?: string[];
  headers?: WebhookHeader[];
}

// ============================================================================
// API Functions
// ============================================================================

export async function listWebhooks(
  bucketSlug: string
): Promise<Webhook[]> {
  const response = await get<{ webhooks: Webhook[] }>(
    '/webhooks/list',
    { bucketSlug }
  );
  return response.webhooks || [];
}

export async function getWebhook(
  bucketSlug: string,
  webhookId: string
): Promise<Webhook> {
  const response = await get<{ webhook: Webhook }>(
    '/webhooks/get',
    { bucketSlug, params: { webhook_id: webhookId } }
  );
  return response.webhook;
}

export async function createWebhook(
  bucketSlug: string,
  data: CreateWebhookData
): Promise<Webhook> {
  const response = await post<{ webhook: Webhook }>('/webhooks/add', {
    slug: bucketSlug,
    data,
  });
  return response.webhook;
}

export async function updateWebhook(
  bucketSlug: string,
  webhookId: string,
  data: UpdateWebhookData
): Promise<Webhook> {
  const response = await patch<{ webhook: Webhook }>('/webhooks/update', {
    slug: bucketSlug,
    webhook_id: webhookId,
    data,
  });
  return response.webhook;
}

export async function deleteWebhook(
  bucketSlug: string,
  webhookId: string
): Promise<void> {
  await del('/webhooks/delete', {
    bucketSlug,
    params: { webhook_id: webhookId },
  });
}
