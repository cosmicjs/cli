/**
 * Dashboard API - Media
 * Media file operations
 */

import { get, post, patch, del } from '../client.js';
import { getBucket } from './core.js';
import type { Media } from '../../types.js';

export interface ListMediaOptions {
  folder?: string;
  limit?: number;
  skip?: number;
}

export async function listMedia(
  bucketSlug: string,
  options: ListMediaOptions = {}
): Promise<{ media: Media[]; total: number }> {
  const params: Record<string, unknown> = {};

  if (options.folder) params.folder = options.folder;
  if (options.limit) params.limit = options.limit;
  if (options.skip) params.skip = options.skip;

  const response = await get<{ media: Media[]; total: number }>('/media/list', {
    bucketSlug,
    params,
  });

  return {
    media: response.media || [],
    total: response.total || 0,
  };
}

export async function getMedia(bucketSlug: string, mediaId: string): Promise<Media> {
  const response = await get<{ media: Media }>('/media/get', {
    bucketSlug,
    params: { media_id: mediaId },
  });
  return response.media;
}

export async function deleteMedia(bucketSlug: string, mediaIds: string[]): Promise<void> {
  await post('/media/deleteByIds', { slug: bucketSlug, media_ids: mediaIds });
}

export async function uploadMedia(
  bucketSlug: string,
  params: {
    buffer: Buffer;
    filename: string;
    contentType: string;
    folder?: string;
    metadata?: Record<string, unknown>;
    altText?: string;
  }
): Promise<Media> {
  const { getWorkersUrl } = await import('../../config/store.js');
  const { getAuthHeaders } = await import('../../auth/manager.js');

  const workersUrl = getWorkersUrl();
  const endpoint = `${workersUrl}/buckets/${bucketSlug}/media-upload`;
  const authHeaders = getAuthHeaders();

  const formData = new FormData();
  const blob = new Blob([params.buffer], { type: params.contentType });
  formData.append('files', blob, params.filename);
  if (params.folder) formData.append('folder', params.folder);
  if (params.metadata) formData.append('metadata', JSON.stringify(params.metadata));
  if (params.altText) formData.append('alt_text', params.altText);

  const headers: Record<string, string> = {
    ...authHeaders,
    'Origin': 'https://app.cosmicjs.com',
    'User-Agent': 'CosmicCLI/1.0.0',
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: formData,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error((errorData as { message?: string }).message || `Media upload failed: ${response.status}`);
  }

  const data = (await response.json()) as { media: Media };
  return data.media;
}

// ============================================================================
// Media Folders
// ============================================================================

export interface MediaFolder {
  title: string;
  slug: string;
  emoji?: string;
}

export async function listMediaFolders(
  bucketSlug: string
): Promise<MediaFolder[]> {
  const bucket = await getBucket(bucketSlug) as unknown as { media_folders?: MediaFolder[] };
  return bucket.media_folders || [];
}

export interface CreateMediaFolderData {
  title: string;
  slug?: string;
  emoji?: string;
}

export async function createMediaFolder(
  bucketSlug: string,
  data: CreateMediaFolderData
): Promise<{ message: string }> {
  const response = await post<{ message: string }>('/mediaFolders/add', {
    slug: bucketSlug,
    data,
  });
  return response;
}

export interface UpdateMediaFolderData {
  title?: string;
  slug?: string;
  emoji?: string;
}

export async function updateMediaFolder(
  bucketSlug: string,
  mediaFolderSlug: string,
  data: UpdateMediaFolderData
): Promise<{ message: string }> {
  const response = await patch<{ message: string }>('/mediaFolders/update', {
    slug: bucketSlug,
    media_folder_slug: mediaFolderSlug,
    data,
  });
  return response;
}

export async function deleteMediaFolder(
  bucketSlug: string,
  mediaFolderSlug: string
): Promise<void> {
  await del('/mediaFolders/delete', {
    bucketSlug,
    params: { media_folder_slug: mediaFolderSlug },
  });
}

export async function addMediaToFolder(
  bucketSlug: string,
  mediaIds: string[],
  folder: string
): Promise<void> {
  await post('/media/addFolderByIds', {
    slug: bucketSlug,
    media_ids: mediaIds,
    folder,
  });
}

export async function removeMediaFromFolder(
  bucketSlug: string,
  mediaIds: string[]
): Promise<void> {
  await post('/media/removeFolderByIds', {
    slug: bucketSlug,
    media_ids: mediaIds,
  });
}
