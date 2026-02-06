/**
 * Base API Client
 * Handles HTTP requests to the Cosmic API with authentication
 */

import axios, { AxiosInstance, AxiosRequestConfig, AxiosError } from 'axios';
import { getApiUrl, getCurrentBucketSlug } from '../config/store.js';
import { getAuthHeaders, getReadQueryParams } from '../auth/manager.js';
import { CLI_VERSION } from '../version.js';
import type { APIResponse } from '../types.js';

// Create axios instance
let client: AxiosInstance | null = null;
let currentBaseUrl: string | null = null;

/**
 * Check if debug mode is enabled
 */
function isDebug(): boolean {
  return process.env.COSMIC_DEBUG === '1' || process.env.COSMIC_DEBUG === '2';
}

/**
 * Get or create the API client
 */
function getClient(): AxiosInstance {
  const apiUrl = getApiUrl();

  // Recreate client if URL changed
  if (!client || currentBaseUrl !== apiUrl) {
    if (isDebug()) {
      console.log(`[DEBUG] Creating DAPI client with baseURL: ${apiUrl}`);
    }

    client = axios.create({
      baseURL: apiUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        // Required: Dashboard API requires Origin header for CORS
        'Origin': 'https://app.cosmicjs.com',
        'User-Agent': `CosmicCLI/${CLI_VERSION}`,
        'X-Cosmic-Client': 'cli',
      },
    });
    currentBaseUrl = apiUrl;

    // Request interceptor to add auth headers and debug logging
    client.interceptors.request.use((config) => {
      const authHeaders = getAuthHeaders();
      Object.assign(config.headers, authHeaders);

      if (isDebug()) {
        console.log(`[DEBUG] DAPI Request: ${config.method?.toUpperCase()} ${config.baseURL}${config.url}`);
      }

      return config;
    });

    // Response interceptor for error handling
    client.interceptors.response.use(
      (response) => {
        if (isDebug()) {
          console.log(`[DEBUG] DAPI Response: ${response.status} ${response.statusText}`);
        }
        return response;
      },
      (error: AxiosError) => {
        if (isDebug()) {
          console.log(`[DEBUG] DAPI Error: ${error.response?.status} ${error.response?.statusText}`);
          console.log(`[DEBUG] DAPI Error data: ${JSON.stringify(error.response?.data)}`);
        }
        if (error.response) {
          const data = error.response.data as Record<string, unknown>;
          const message = (data?.message as string) || (data?.error as string) || error.message;
          throw new Error(message);
        }
        throw error;
      }
    );
  }

  return client;
}

/**
 * Reset the client (useful after auth changes)
 */
export function resetClient(): void {
  client = null;
}

/**
 * Add bucket slug to URL params
 */
function addBucketParam(url: string, bucketSlug: string): string {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}slug=${bucketSlug}`;
}

/**
 * Add read key to URL params for bucket API calls
 */
function addReadKeyParam(url: string): string {
  const params = getReadQueryParams();
  if (!params.read_key) return url;

  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}read_key=${params.read_key}`;
}

/**
 * GET request
 */
export async function get<T = unknown>(
  url: string,
  options: {
    bucketSlug?: string;
    useReadKey?: boolean;
    params?: Record<string, unknown>;
    headers?: Record<string, string>;
  } = {}
): Promise<T> {
  let endpoint = url;

  // Only add bucket slug if explicitly provided in options
  if (options.bucketSlug) {
    endpoint = addBucketParam(endpoint, options.bucketSlug);
  }

  if (options.useReadKey) {
    endpoint = addReadKeyParam(endpoint);
  }

  const response = await getClient().get<T>(endpoint, {
    params: options.params,
    headers: options.headers,
  });

  return response.data;
}

/**
 * POST request
 */
export async function post<T = unknown>(
  url: string,
  data?: unknown,
  options: {
    bucketSlug?: string;
    params?: Record<string, unknown>;
    config?: AxiosRequestConfig;
  } = {}
): Promise<T> {
  let endpoint = url;

  // Only add bucket slug if explicitly provided in options
  if (options.bucketSlug) {
    endpoint = addBucketParam(endpoint, options.bucketSlug);
  }

  const response = await getClient().post<T>(endpoint, data, {
    params: options.params,
    ...options.config,
  });

  return response.data;
}

/**
 * PATCH request
 */
export async function patch<T = unknown>(
  url: string,
  data?: unknown,
  options: {
    bucketSlug?: string;
    params?: Record<string, unknown>;
  } = {}
): Promise<T> {
  let endpoint = url;

  // Use provided bucketSlug or fall back to current bucket slug
  const bucketSlug = options.bucketSlug ?? getCurrentBucketSlug();
  if (bucketSlug) {
    endpoint = addBucketParam(endpoint, bucketSlug);
  }

  const response = await getClient().patch<T>(endpoint, data, {
    params: options.params,
  });

  return response.data;
}

/**
 * PUT request
 */
export async function put<T = unknown>(
  url: string,
  data?: unknown,
  options: {
    bucketSlug?: string;
    params?: Record<string, unknown>;
  } = {}
): Promise<T> {
  let endpoint = url;

  // Use provided bucketSlug or fall back to current bucket slug
  const bucketSlug = options.bucketSlug ?? getCurrentBucketSlug();
  if (bucketSlug) {
    endpoint = addBucketParam(endpoint, bucketSlug);
  }

  const response = await getClient().put<T>(endpoint, data, {
    params: options.params,
  });

  return response.data;
}

/**
 * DELETE request
 */
export async function del<T = unknown>(
  url: string,
  options: {
    bucketSlug?: string;
    params?: Record<string, unknown>;
    data?: unknown;
  } = {}
): Promise<T> {
  let endpoint = url;

  // Use provided bucketSlug or fall back to current bucket slug
  const bucketSlug = options.bucketSlug ?? getCurrentBucketSlug();
  if (bucketSlug) {
    endpoint = addBucketParam(endpoint, bucketSlug);
  }

  const response = await getClient().delete<T>(endpoint, {
    params: options.params,
    data: options.data,
  });

  return response.data;
}

/**
 * Upload file via multipart form
 */
export async function upload<T = unknown>(
  url: string,
  file: Buffer | Blob,
  filename: string,
  options: {
    bucketSlug?: string;
    metadata?: Record<string, unknown>;
  } = {}
): Promise<T> {
  let endpoint = url;

  if (options.bucketSlug !== undefined || getCurrentBucketSlug()) {
    endpoint = addBucketParam(endpoint, options.bucketSlug);
  }

  const formData = new FormData();
  formData.append('media', new Blob([file]), filename);

  if (options.metadata) {
    formData.append('metadata', JSON.stringify(options.metadata));
  }

  const response = await getClient().post<T>(endpoint, formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });

  return response.data;
}

export default {
  get,
  post,
  patch,
  put,
  del,
  upload,
  resetClient,
};
