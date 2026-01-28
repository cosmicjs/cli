/**
 * Cosmic SDK Client
 * Wrapper for the @cosmicjs/sdk package
 */

import { createBucketClient } from '@cosmicjs/sdk';
import { getCredentialValue, setCredentials } from '../config/store.js';

// Type for the SDK client
type BucketClient = ReturnType<typeof createBucketClient>;

// Cached SDK client instance
let sdkClient: BucketClient | null = null;
let currentBucketSlug: string | null = null;

/**
 * Initialize or get the SDK client for a bucket
 */
export function getSDKClient(bucketSlug?: string): BucketClient | null {
  const slug = bucketSlug || getCredentialValue('bucketSlug');
  const readKey = getCredentialValue('readKey');
  const writeKey = getCredentialValue('writeKey');

  if (!slug) {
    return null;
  }

  // Return cached client if same bucket
  if (sdkClient && currentBucketSlug === slug) {
    return sdkClient;
  }

  // Create new client
  sdkClient = createBucketClient({
    bucketSlug: slug,
    readKey: readKey || '',
    writeKey: writeKey || '',
  });

  currentBucketSlug = slug;
  return sdkClient;
}

/**
 * Initialize SDK client with specific credentials
 */
export function initSDKClient(
  bucketSlug: string,
  readKey: string,
  writeKey: string
): BucketClient {
  // Store credentials
  setCredentials({
    bucketSlug,
    readKey,
    writeKey,
  });

  // Create and cache client
  sdkClient = createBucketClient({
    bucketSlug,
    readKey,
    writeKey,
  });

  currentBucketSlug = bucketSlug;
  return sdkClient;
}

/**
 * Check if SDK client is available
 */
export function hasSDKClient(): boolean {
  const slug = getCredentialValue('bucketSlug');
  const readKey = getCredentialValue('readKey');
  return !!(slug && readKey);
}

/**
 * Clear the SDK client cache
 */
export function clearSDKClient(): void {
  sdkClient = null;
  currentBucketSlug = null;
}

/**
 * Get bucket keys from the current credentials
 */
export function getBucketKeys(): {
  bucketSlug?: string;
  readKey?: string;
  writeKey?: string;
} {
  return {
    bucketSlug: getCredentialValue('bucketSlug'),
    readKey: getCredentialValue('readKey'),
    writeKey: getCredentialValue('writeKey'),
  };
}

export default {
  getSDKClient,
  initSDKClient,
  hasSDKClient,
  clearSDKClient,
  getBucketKeys,
};
