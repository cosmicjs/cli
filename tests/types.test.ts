/**
 * Integration tests for Object Type CRUD operations via the Dashboard API.
 *
 * Prerequisites:
 *   - `cosmic login` has been run
 *   - `cosmic use` has navigated to a bucket
 */

import { describe, it, expect, afterAll } from 'vitest';
import { SKIP_INTEGRATION, TEST_BUCKET_SLUG } from './setup.js';
import {
  createObjectType,
  listObjectTypes,
  getObjectType,
  updateObjectType,
  duplicateObjectType,
  deleteObjectType,
} from '../src/api/dashboard/objects.js';

// Track slugs for cleanup
const slugsToCleanup: string[] = [];
const uniqueSuffix = Date.now();
const testSlug = `cli-test-type-${uniqueSuffix}`;

describe('Object Types (Dashboard API)', () => {
  afterAll(async () => {
    if (SKIP_INTEGRATION) return;
    // Cleanup: delete all types we created (in reverse order)
    for (const slug of [...slugsToCleanup].reverse()) {
      try {
        await deleteObjectType(TEST_BUCKET_SLUG!, slug);
      } catch {
        // Best-effort cleanup
      }
    }
  });

  it.skipIf(SKIP_INTEGRATION)('should create an object type', async () => {
    const type = await createObjectType(TEST_BUCKET_SLUG!, {
      title: 'CLI Test Type',
      slug: testSlug,
      singular: 'CLI Test Item',
      emoji: '🧪',
    });

    expect(type).toBeDefined();
    expect(type.slug).toBe(testSlug);
    expect(type.title).toBe('CLI Test Type');
    slugsToCleanup.push(testSlug);
  });

  it.skipIf(SKIP_INTEGRATION)('should list object types and include the created one', async () => {
    // Brief pause to allow the API to propagate the new type
    await new Promise((r) => setTimeout(r, 2000));

    const types = await listObjectTypes(TEST_BUCKET_SLUG!);

    expect(Array.isArray(types)).toBe(true);
    const found = types.find((t) => t.slug === testSlug);
    expect(found).toBeDefined();
    expect(found!.title).toBe('CLI Test Type');
  });

  it.skipIf(SKIP_INTEGRATION)('should get a single object type by slug', async () => {
    const type = await getObjectType(TEST_BUCKET_SLUG!, testSlug);

    expect(type).toBeDefined();
    expect(type.slug).toBe(testSlug);
    expect(type.title).toBe('CLI Test Type');
  });

  it.skipIf(SKIP_INTEGRATION)('should update an object type', async () => {
    const type = await updateObjectType(TEST_BUCKET_SLUG!, testSlug, {
      emoji: '✅',
    });

    expect(type).toBeDefined();
    expect(type.title).toBe('CLI Test Type');
  });

  it.skipIf(SKIP_INTEGRATION)('should duplicate an object type', async () => {
    const duplicated = await duplicateObjectType(TEST_BUCKET_SLUG!, testSlug);

    expect(duplicated).toBeDefined();
    expect(duplicated.slug).toBeDefined();
    expect(duplicated.slug).not.toBe(testSlug);
    slugsToCleanup.push(duplicated.slug);
  });

  it.skipIf(SKIP_INTEGRATION)('should delete an object type', async () => {
    // Delete the original (the duplicate is cleaned up in afterAll)
    await deleteObjectType(TEST_BUCKET_SLUG!, testSlug);

    // Verify it's gone by checking the list
    const types = await listObjectTypes(TEST_BUCKET_SLUG!);
    const found = types.find((t) => t.slug === testSlug);
    expect(found).toBeUndefined();

    // Remove from cleanup list since we already deleted it
    const idx = slugsToCleanup.indexOf(testSlug);
    if (idx !== -1) slugsToCleanup.splice(idx, 1);
  });
});
