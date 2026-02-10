/**
 * Integration tests for Webhook CRUD operations via the Dashboard API.
 *
 * Prerequisites:
 *   - `cosmic login` has been run
 *   - `cosmic use` has navigated to a bucket
 */

import { describe, it, expect, afterAll } from 'vitest';
import { SKIP_INTEGRATION, TEST_BUCKET_SLUG } from './setup.js';
import {
  listWebhooks,
  getWebhook,
  createWebhook,
  updateWebhook,
  deleteWebhook,
} from '../src/api/dashboard/webhooks.js';

// Track created webhook ID for cleanup
let createdWebhookId: string | undefined;

describe('Webhooks (Dashboard API)', () => {
  afterAll(async () => {
    if (SKIP_INTEGRATION || !createdWebhookId) return;
    try {
      await deleteWebhook(TEST_BUCKET_SLUG!, createdWebhookId);
    } catch {
      // Best-effort cleanup
    }
  });

  it.skipIf(SKIP_INTEGRATION)('should create a webhook', async () => {
    const webhook = await createWebhook(TEST_BUCKET_SLUG!, {
      title: 'CLI Test Webhook',
      endpoint: 'https://httpbin.org/post',
      resource: 'objects',
      events: ['created', 'edited'],
      props: 'id,title,slug',
    });

    expect(webhook).toBeDefined();
    expect(webhook.id).toBeDefined();
    expect(webhook.title).toBe('CLI Test Webhook');
    expect(webhook.endpoint).toBe('https://httpbin.org/post');

    createdWebhookId = webhook.id;
  });

  it.skipIf(SKIP_INTEGRATION)('should list webhooks and include the created one', async () => {
    expect(createdWebhookId).toBeDefined();

    const webhooks = await listWebhooks(TEST_BUCKET_SLUG!);

    expect(Array.isArray(webhooks)).toBe(true);
    const found = webhooks.find((w) => w.id === createdWebhookId);
    expect(found).toBeDefined();
    expect(found!.title).toBe('CLI Test Webhook');
  });

  it.skipIf(SKIP_INTEGRATION)('should get a single webhook by id', async () => {
    expect(createdWebhookId).toBeDefined();

    const webhook = await getWebhook(TEST_BUCKET_SLUG!, createdWebhookId!);

    expect(webhook).toBeDefined();
    expect(webhook.id).toBe(createdWebhookId);
    expect(webhook.title).toBe('CLI Test Webhook');
  });

  it.skipIf(SKIP_INTEGRATION)('should update a webhook', async () => {
    expect(createdWebhookId).toBeDefined();

    const webhook = await updateWebhook(
      TEST_BUCKET_SLUG!,
      createdWebhookId!,
      {
        title: 'CLI Test Webhook Updated',
        props: 'id,title,slug',
      }
    );

    expect(webhook).toBeDefined();
    expect(webhook.title).toBe('CLI Test Webhook Updated');
  });

  it.skipIf(SKIP_INTEGRATION)('should delete a webhook', async () => {
    expect(createdWebhookId).toBeDefined();

    // Should not throw
    await deleteWebhook(TEST_BUCKET_SLUG!, createdWebhookId!);

    // Verify it's gone
    const webhooks = await listWebhooks(TEST_BUCKET_SLUG!);
    const found = webhooks.find((w) => w.id === createdWebhookId);
    expect(found).toBeUndefined();

    // Clear so afterAll doesn't try again
    createdWebhookId = undefined;
  });
});
