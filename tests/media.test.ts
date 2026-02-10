/**
 * Integration tests for Media operations via the Dashboard API.
 *
 * Prerequisites:
 *   - `cosmic login` has been run
 *   - `cosmic use` has navigated to a bucket
 */

import { describe, it, expect, afterAll } from 'vitest';
import { SKIP_INTEGRATION, TEST_BUCKET_SLUG } from './setup.js';
import {
  listMedia,
  getMedia,
  uploadMedia,
  deleteMedia,
  listMediaFolders,
  createMediaFolder,
  updateMediaFolder,
  deleteMediaFolder,
} from '../src/api/dashboard/media.js';

// Track uploaded media IDs for cleanup
let uploadedMediaId: string | undefined;

// A minimal 1x1 red PNG (68 bytes)
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
  'base64'
);

describe('Media (Dashboard API)', () => {
  afterAll(async () => {
    if (SKIP_INTEGRATION || !uploadedMediaId) return;
    try {
      await deleteMedia(TEST_BUCKET_SLUG!, [uploadedMediaId]);
    } catch {
      // Best-effort cleanup
    }
  });

  it.skipIf(SKIP_INTEGRATION)('should list media', async () => {
    const result = await listMedia(TEST_BUCKET_SLUG!, { limit: 5 });

    expect(result).toBeDefined();
    expect(Array.isArray(result.media)).toBe(true);
    expect(typeof result.total).toBe('number');
  });

  it.skipIf(SKIP_INTEGRATION)('should upload a media file', async () => {
    const filename = `cli-test-${Date.now()}.png`;

    const media = await uploadMedia(TEST_BUCKET_SLUG!, {
      buffer: TINY_PNG,
      filename,
      contentType: 'image/png',
    });

    expect(media).toBeDefined();
    expect(media.id).toBeDefined();
    expect(media.url).toBeDefined();

    uploadedMediaId = media.id;
  });

  it.skipIf(SKIP_INTEGRATION)('should get media details', async () => {
    expect(uploadedMediaId).toBeDefined();

    const media = await getMedia(TEST_BUCKET_SLUG!, uploadedMediaId!);

    expect(media).toBeDefined();
    expect(media.id).toBe(uploadedMediaId);
    expect(media.name).toContain('cli-test-');
  });

  it.skipIf(SKIP_INTEGRATION)('should delete media', async () => {
    expect(uploadedMediaId).toBeDefined();

    // Should not throw
    await deleteMedia(TEST_BUCKET_SLUG!, [uploadedMediaId!]);

    // Clear so afterAll doesn't try again
    uploadedMediaId = undefined;
  });
});

// ============================================================================
// Media Folders
// ============================================================================

const testFolderSlug = `cli-test-folder-${Date.now()}`;
let folderCreated = false;

describe('Media Folders (Dashboard API)', () => {
  afterAll(async () => {
    if (SKIP_INTEGRATION || !folderCreated) return;
    try {
      await deleteMediaFolder(TEST_BUCKET_SLUG!, testFolderSlug);
    } catch {
      // Best-effort cleanup
    }
  });

  it.skipIf(SKIP_INTEGRATION)('should create a media folder', async () => {
    const result = await createMediaFolder(TEST_BUCKET_SLUG!, {
      title: 'CLI Test Folder',
      slug: testFolderSlug,
    });

    expect(result).toBeDefined();
    folderCreated = true;
  });

  it.skipIf(SKIP_INTEGRATION)('should list media folders and include the created one', async () => {
    expect(folderCreated).toBe(true);

    const folders = await listMediaFolders(TEST_BUCKET_SLUG!);

    expect(Array.isArray(folders)).toBe(true);
    const found = folders.find((f) => f.slug === testFolderSlug);
    expect(found).toBeDefined();
    expect(found!.title).toBe('CLI Test Folder');
  });

  it.skipIf(SKIP_INTEGRATION)('should update a media folder', async () => {
    expect(folderCreated).toBe(true);

    const result = await updateMediaFolder(TEST_BUCKET_SLUG!, testFolderSlug, {
      title: 'CLI Test Folder Updated',
    });

    expect(result).toBeDefined();
  });

  it.skipIf(SKIP_INTEGRATION)('should delete a media folder', async () => {
    expect(folderCreated).toBe(true);

    // Should not throw
    await deleteMediaFolder(TEST_BUCKET_SLUG!, testFolderSlug);

    // Verify it's gone
    const folders = await listMediaFolders(TEST_BUCKET_SLUG!);
    const found = folders.find((f) => f.slug === testFolderSlug);
    expect(found).toBeUndefined();

    // Clear so afterAll doesn't try again
    folderCreated = false;
  });
});
