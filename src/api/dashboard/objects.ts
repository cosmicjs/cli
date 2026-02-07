/**
 * Dashboard API - Objects
 * Objects and Object Types
 */

import { get, post, patch, del } from '../client.js';
import { getSDKClient } from '../sdk.js';
import { getBucket } from './core.js';
import type { CosmicObject, ObjectType } from '../../types.js';

// ============================================================================
// Objects
// ============================================================================

export interface ListObjectsOptions {
  type?: string;
  status?: 'published' | 'draft' | 'any';
  limit?: number;
  skip?: number;
  sort?: string;
  query?: Record<string, unknown>;
  props?: string[];
}

export async function listObjects(
  bucketSlug: string,
  options: ListObjectsOptions = {}
): Promise<{ objects: CosmicObject[]; total: number }> {
  const params: Record<string, unknown> = {};

  const queryObj: Record<string, unknown> = options.query || {};
  if (options.type) queryObj.type = options.type;
  if (options.status) queryObj.status = options.status;
  if (options.limit) queryObj.limit = options.limit;
  if (options.skip) queryObj.skip = options.skip;
  if (options.sort) queryObj.sort = options.sort;

  if (Object.keys(queryObj).length > 0) {
    params.query = JSON.stringify(queryObj);
  }
  if (options.props) params.props = options.props.join(',');

  const response = await get<{ objects: CosmicObject[]; total: number }>(
    '/objects/list',
    { bucketSlug, params }
  );

  return {
    objects: response.objects || [],
    total: response.total || 0,
  };
}

export async function getObject(
  bucketSlug: string,
  objectId: string,
  options: { status?: 'published' | 'draft' | 'any' } = {}
): Promise<CosmicObject> {
  const params: Record<string, unknown> = { id: objectId };
  const queryObj: Record<string, unknown> = { status: options.status || 'any' };
  params.query = JSON.stringify(queryObj);

  const response = await get<{ object: CosmicObject }>('/objects/get', {
    bucketSlug,
    params,
  });
  return response.object;
}

export interface CreateObjectData {
  title: string;
  type: string;
  slug?: string;
  content?: string;
  status?: 'published' | 'draft';
  metadata?: Record<string, unknown>;
  locale?: string;
}

export async function createObject(
  bucketSlug: string,
  objectData: CreateObjectData
): Promise<CosmicObject> {
  const body = {
    slug: bucketSlug,
    data: {
      title: objectData.title,
      slug: objectData.slug,
      type: objectData.type,
      content: objectData.content || '',
      status: objectData.status || 'draft',
      metafields: objectData.metadata ? Object.entries(objectData.metadata).map(([key, value]) => ({
        key,
        value,
      })) : [],
    },
  };

  const response = await post<{ object: CosmicObject }>('/objects/add', body, {});
  return response.object;
}

export interface UpdateObjectData {
  title?: string;
  slug?: string;
  content?: string;
  status?: 'published' | 'draft';
  metadata?: Record<string, unknown>;
}

export async function updateObject(
  bucketSlug: string,
  objectId: string,
  data: UpdateObjectData
): Promise<CosmicObject> {
  const response = await patch<{ object: CosmicObject }>(
    '/objects/update',
    { id: objectId, ...data },
    { bucketSlug }
  );
  return response.object;
}

export async function deleteObjects(
  bucketSlug: string,
  objectIds: string[]
): Promise<void> {
  await post('/objects/deleteByIds', { ids: objectIds }, { bucketSlug });
}

export async function publishObjects(
  bucketSlug: string,
  objectIds: string[]
): Promise<void> {
  await post('/objects/publishByIds', { ids: objectIds }, { bucketSlug });
}

export async function unpublishObjects(
  bucketSlug: string,
  objectIds: string[]
): Promise<void> {
  await post('/objects/unpublishByIds', { ids: objectIds }, { bucketSlug });
}

// ============================================================================
// Object Types
// ============================================================================

export async function listObjectTypes(bucketSlug: string): Promise<ObjectType[]> {
  const sdk = getSDKClient(bucketSlug);
  if (!sdk) {
    throw new Error('SDK client not available');
  }
  const response = await sdk.objectTypes.find();
  return response.object_types || [];
}

export async function getObjectType(
  bucketSlug: string,
  typeSlug: string
): Promise<ObjectType> {
  const sdk = getSDKClient(bucketSlug);
  if (!sdk) {
    throw new Error('SDK client not available');
  }
  const response = await sdk.objectTypes.findOne(typeSlug);
  return response.object_type;
}

export interface CreateObjectTypeData {
  title: string;
  slug?: string;
  singular?: string;
  emoji?: string;
  metafields?: Array<{
    title: string;
    key: string;
    type: string;
    required?: boolean;
    options?: unknown;
  }>;
  options?: {
    slug_field?: boolean;
    content_editor?: boolean;
  };
  singleton?: boolean;
}

export async function createObjectType(
  bucketSlug: string,
  objectType: CreateObjectTypeData
): Promise<ObjectType> {
  const response = await post<{ object_type: ObjectType }>('/objectTypes/add', {
    slug: bucketSlug,
    data: objectType,
  });
  return response.object_type;
}

export interface UpdateObjectTypeData {
  title?: string;
  slug?: string;
  singular?: string;
  emoji?: string;
  metafields?: Array<{
    title?: string;
    key: string;
    type: string;
    required?: boolean;
    options?: unknown;
  }>;
  options?: {
    slug_field?: boolean;
    content_editor?: boolean;
  };
  singleton?: boolean;
  localization?: boolean;
  locales?: string[];
  priority_locale?: string;
  preview_link?: string;
  folder?: string;
}

export async function updateObjectType(
  bucketSlug: string,
  typeSlug: string,
  data: UpdateObjectTypeData
): Promise<ObjectType> {
  const response = await patch<{ object_type: ObjectType }>('/objectTypes/update', {
    slug: bucketSlug,
    type_slug: typeSlug,
    data,
  });
  return response.object_type;
}

export async function deleteObjectType(
  bucketSlug: string,
  typeSlug: string
): Promise<void> {
  await del('/objectTypes/delete', {
    bucketSlug,
    params: { type_slug: typeSlug },
  });
}

export async function duplicateObjectType(
  bucketSlug: string,
  typeSlug: string
): Promise<ObjectType> {
  const response = await post<{ object_type: ObjectType }>('/objectTypes/duplicate', {
    slug: bucketSlug,
    type_slug: typeSlug,
  });
  return response.object_type;
}

export async function createObjectWithMetafields(
  bucketSlug: string,
  object: {
    title: string;
    slug?: string;
    type: string;
    content?: string;
    status?: string;
    thumbnail?: string;
    locale?: string;
    metafields?: Array<{
      id?: string;
      title?: string;
      key: string;
      type: string;
      value?: unknown;
      required?: boolean;
    }>;
  }
): Promise<CosmicObject> {
  const response = await post<{ object: CosmicObject }>('/objects/add', {
    slug: bucketSlug,
    data: object,
  });
  return response.object;
}

export async function updateObjectWithMetafields(
  bucketSlug: string,
  objectId: string,
  object: {
    title?: string;
    slug?: string;
    content?: string;
    status?: string;
    thumbnail?: string;
    metafields?: Array<{
      id?: string;
      title?: string;
      key: string;
      type: string;
      value?: unknown;
      required?: boolean;
      options?: unknown;
      object_type?: string;
    }>;
  }
): Promise<CosmicObject> {
  const response = await patch<{ object: CosmicObject }>(
    '/objects/update',
    {
      slug: bucketSlug,
      object_id: objectId,
      data: object,
    }
  );
  return response.object;
}

export async function getObjectTypesWithMetafields(bucketSlug: string): Promise<ObjectType[]> {
  const bucket = await getBucket(bucketSlug) as unknown as { object_types?: ObjectType[]; objectTypes?: ObjectType[] };
  return bucket.object_types || bucket.objectTypes || [];
}

export async function searchObjects(
  bucketSlug: string,
  query: Record<string, unknown>,
  options: { limit?: number; props?: string[] } = {}
): Promise<{ objects: CosmicObject[]; total: number }> {
  const fullQuery = {
    type: { $exists: true },
    ...query,
  };

  const params: Record<string, unknown> = {
    query: JSON.stringify(fullQuery),
  };
  if (options.limit) params.limit = options.limit;
  if (options.props) params.props = options.props.join(',');

  const response = await get<{
    objects: Array<{ main_object_status?: string; object: CosmicObject }>;
    total: number
  }>(
    '/objects/list',
    { bucketSlug, params }
  );

  const objects = (response.objects || []).map(item => item.object);

  return {
    objects,
    total: response.total || 0,
  };
}
