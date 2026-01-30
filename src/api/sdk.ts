/**
 * Cosmic SDK Client
 * Wrapper for the @cosmicjs/sdk package
 */

import { createBucketClient } from '@cosmicjs/sdk';
import { getCredentialValue, setCredentials, getConfigValue } from '../config/store.js';

// Type for the SDK client
type BucketClient = ReturnType<typeof createBucketClient>;

// Cached SDK client instance
let sdkClient: BucketClient | null = null;
let currentBucketSlug: string | null = null;
let currentSdkUrl: string | null = null;

/**
 * Get the API environment (production or staging)
 * Priority: COSMIC_API_ENV env var > default "production"
 */
function getApiEnvironment(): 'production' | 'staging' {
  const env = process.env.COSMIC_API_ENV?.toLowerCase();
  if (env === 'staging') {
    return 'staging';
  }
  return 'production';
}

/**
 * Initialize or get the SDK client for a bucket
 * Uses apiEnvironment to determine the API endpoint (production or staging)
 * See: https://www.cosmicjs.com/docs/api/object-types
 */
export function getSDKClient(bucketSlug?: string): BucketClient | null {
  const slug = bucketSlug || getCredentialValue('bucketSlug');
  const readKey = getCredentialValue('readKey');
  const writeKey = getCredentialValue('writeKey');

  if (!slug) {
    return null;
  }

  // Get API environment
  const apiEnv = getApiEnvironment();

  // Return cached client if same bucket and same environment
  if (sdkClient && currentBucketSlug === slug && currentSdkUrl === apiEnv) {
    return sdkClient;
  }

  // Build SDK config - uses apiEnvironment to determine endpoint
  const sdkConfig: Parameters<typeof createBucketClient>[0] = {
    bucketSlug: slug,
    readKey: readKey || '',
    writeKey: writeKey || '',
    apiEnvironment: apiEnv,
  };

  if (process.env.COSMIC_DEBUG === '1') {
    console.log(`  [DEBUG] SDK using apiEnvironment: ${apiEnv}`);
  }

  // Create new client
  sdkClient = createBucketClient(sdkConfig);
  currentBucketSlug = slug;
  currentSdkUrl = apiEnv;
  
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

  const apiEnv = getApiEnvironment();

  // Build SDK config - uses apiEnvironment to determine endpoint
  const sdkConfig: Parameters<typeof createBucketClient>[0] = {
    bucketSlug,
    readKey,
    writeKey,
    apiEnvironment: apiEnv,
  };

  // Create and cache client
  sdkClient = createBucketClient(sdkConfig);
  currentBucketSlug = bucketSlug;
  currentSdkUrl = apiEnv;
  
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
  currentSdkUrl = null;
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

/**
 * Get the current API environment being used
 */
export function getApiEnv(): 'production' | 'staging' {
  return getApiEnvironment();
}

export default {
  getSDKClient,
  initSDKClient,
  hasSDKClient,
  clearSDKClient,
  getBucketKeys,
  getApiEnv,
};
