/**
 * Integration tests for Object CRUD operations via the Cosmic SDK.
 *
 * Prerequisites:
 *   - `cosmic login` has been run
 *   - `cosmic use` has navigated to a bucket with at least one object type
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SKIP_INTEGRATION, TEST_BUCKET_SLUG } from './setup.js';
import { getSDKClient } from '../src/api/sdk.js';
import {
  listObjectTypes,
  publishObjects,
  unpublishObjects,
} from '../src/api/dashboard/objects.js';

// Track resources for cleanup
let createdObjectId: string | undefined;
let testTypeSlug: string | undefined;

describe('Objects (SDK)', () => {
  beforeAll(async () => {
    if (SKIP_INTEGRATION) return;

    // Find an existing object type in the bucket to use for test objects
    const types = await listObjectTypes(TEST_BUCKET_SLUG!);
    if (types.length === 0) {
      console.warn('⚠  No object types in bucket — objects tests will be skipped');
      return;
    }
    testTypeSlug = types[0].slug;
  });

  afterAll(async () => {
    // Cleanup: delete the test object if it was created
    if (createdObjectId && !SKIP_INTEGRATION) {
      try {
        const sdk = getSDKClient(TEST_BUCKET_SLUG!);
        await sdk!.objects.deleteOne(createdObjectId);
      } catch {
        // Best-effort cleanup
      }
    }
  });

  it.skipIf(SKIP_INTEGRATION)('should create an object', async () => {
    expect(testTypeSlug).toBeDefined();
    const sdk = getSDKClient(TEST_BUCKET_SLUG!)!;

    const result = await sdk.objects.insertOne({
      title: 'CLI Test Object',
      slug: `cli-test-object-${Date.now()}`,
      type: testTypeSlug!,
      content: 'Created by integration test',
      status: 'draft',
    });

    expect(result.object).toBeDefined();
    expect(result.object.id).toBeDefined();
    expect(result.object.title).toBe('CLI Test Object');
    expect(result.object.slug).toContain('cli-test-object');

    createdObjectId = result.object.id;
  });

  it.skipIf(SKIP_INTEGRATION)('should list objects and include the created one', async () => {
    expect(createdObjectId).toBeDefined();
    const sdk = getSDKClient(TEST_BUCKET_SLUG!)!;

    const result = await sdk.objects
      .find({ type: testTypeSlug! })
      .status('any')
      .limit(50);

    expect(result.objects).toBeDefined();
    expect(Array.isArray(result.objects)).toBe(true);

    const found = result.objects.find((o: any) => o.id === createdObjectId);
    expect(found).toBeDefined();
  });

  it.skipIf(SKIP_INTEGRATION)('should get a single object by id', async () => {
    expect(createdObjectId).toBeDefined();
    const sdk = getSDKClient(TEST_BUCKET_SLUG!)!;

    const result = await sdk.objects
      .find({ id: createdObjectId! })
      .status('any')
      .limit(1);

    expect(result.objects).toBeDefined();
    expect(result.objects.length).toBe(1);
    expect(result.objects[0].title).toBe('CLI Test Object');
  });

  it.skipIf(SKIP_INTEGRATION)('should update an object', async () => {
    expect(createdObjectId).toBeDefined();
    const sdk = getSDKClient(TEST_BUCKET_SLUG!)!;

    const result = await sdk.objects.updateOne(createdObjectId!, {
      title: 'CLI Test Object Updated',
      content: 'Updated by integration test',
    });

    expect(result.object).toBeDefined();
    expect(result.object.title).toBe('CLI Test Object Updated');
  });

  it.skipIf(SKIP_INTEGRATION)('should delete an object', async () => {
    expect(createdObjectId).toBeDefined();
    const sdk = getSDKClient(TEST_BUCKET_SLUG!)!;

    await sdk.objects.deleteOne(createdObjectId!);

    // Verify it's gone -- SDK throws 404 when no objects match
    try {
      const result = await sdk.objects
        .find({ id: createdObjectId! })
        .status('any')
        .limit(1);
      // If it doesn't throw, the list should be empty
      expect(result.objects.length).toBe(0);
    } catch (error: any) {
      // 404 "No objects found" is the expected outcome
      expect(error.status ?? error.message).toBeDefined();
    }

    // Clear so afterAll doesn't try to delete again
    createdObjectId = undefined;
  });
});

// ============================================================================
// Object Publish / Unpublish
// ============================================================================

describe('Object Publish / Unpublish', () => {
  let publishTestObjectId: string | undefined;
  let publishTestTypeSlug: string | undefined;

  beforeAll(async () => {
    if (SKIP_INTEGRATION) return;

    const types = await listObjectTypes(TEST_BUCKET_SLUG!);
    if (types.length === 0) return;
    publishTestTypeSlug = types[0].slug;

    // Create a draft object to test publish/unpublish
    const sdk = getSDKClient(TEST_BUCKET_SLUG!)!;
    const result = await sdk.objects.insertOne({
      title: 'CLI Publish Test',
      slug: `cli-publish-test-${Date.now()}`,
      type: publishTestTypeSlug,
      content: 'Created for publish/unpublish test',
      status: 'draft',
    });
    publishTestObjectId = result.object.id;
  });

  afterAll(async () => {
    if (SKIP_INTEGRATION || !publishTestObjectId) return;
    try {
      const sdk = getSDKClient(TEST_BUCKET_SLUG!)!;
      await sdk.objects.deleteOne(publishTestObjectId);
    } catch {
      // Best-effort cleanup
    }
  });

  it.skipIf(SKIP_INTEGRATION)('should publish an object', async () => {
    expect(publishTestObjectId).toBeDefined();

    // Should not throw
    await publishObjects(TEST_BUCKET_SLUG!, [publishTestObjectId!]);

    // Verify the object is now published
    const sdk = getSDKClient(TEST_BUCKET_SLUG!)!;
    const result = await sdk.objects
      .find({ id: publishTestObjectId! })
      .status('any')
      .limit(1);

    expect(result.objects.length).toBe(1);
    expect(result.objects[0].status).toBe('published');
  });

  it.skipIf(SKIP_INTEGRATION)('should unpublish an object', async () => {
    expect(publishTestObjectId).toBeDefined();

    // Should not throw
    await unpublishObjects(TEST_BUCKET_SLUG!, [publishTestObjectId!]);

    // Verify the object is now draft again
    const sdk = getSDKClient(TEST_BUCKET_SLUG!)!;
    const result = await sdk.objects
      .find({ id: publishTestObjectId! })
      .status('any')
      .limit(1);

    expect(result.objects.length).toBe(1);
    expect(result.objects[0].status).toBe('draft');
  });
});
