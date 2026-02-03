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
let currentCacheKey: string | null = null;

// Default API URLs by environment
const API_URLS = {
  production: 'https://api.cosmicjs.com/v3',
  staging: 'https://api.cosmic-staging.com/v3',
};

const UPLOAD_URLS = {
  production: 'https://workers.cosmicjs.com/v3',
  staging: 'https://workers.cosmic-staging.com/v3',
};

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
 * If COSMIC_WORKERS_URL is set, uses it as the custom uploadUrl
 * See: https://www.cosmicjs.com/docs/api/object-types
 */
export function getSDKClient(bucketSlug?: string): BucketClient | null {
  const slug = bucketSlug || getCredentialValue('bucketSlug');
  const readKey = getCredentialValue('readKey');
  const writeKey = getCredentialValue('writeKey');

  if (!slug) {
    return null;
  }

  // Get API environment and custom workers URL
  const apiEnv = getApiEnvironment();
  const customWorkersUrl = process.env.COSMIC_WORKERS_URL;
  const cacheKey = `${apiEnv}:${customWorkersUrl || 'default'}`;

  // Return cached client if same bucket and same config
  if (sdkClient && currentBucketSlug === slug && currentCacheKey === cacheKey) {
    return sdkClient;
  }

  // Build SDK config
  const sdkConfig: Parameters<typeof createBucketClient>[0] = {
    bucketSlug: slug,
    readKey: readKey || '',
    writeKey: writeKey || '',
  };

  // If custom workers URL is set, use custom config
  if (customWorkersUrl) {
    sdkConfig.custom = {
      apiUrl: API_URLS[apiEnv],
      uploadUrl: customWorkersUrl,
    };
    if (process.env.COSMIC_DEBUG === '1') {
      console.log(`  [DEBUG] SDK using apiEnvironment: ${apiEnv}`);
      console.log(`  [DEBUG] SDK using custom uploadUrl: ${customWorkersUrl}`);
    }
  } else {
    sdkConfig.apiEnvironment = apiEnv;
    if (process.env.COSMIC_DEBUG === '1') {
      console.log(`  [DEBUG] SDK using apiEnvironment: ${apiEnv}`);
    }
  }

  // Create new client
  sdkClient = createBucketClient(sdkConfig);
  currentBucketSlug = slug;
  currentCacheKey = cacheKey;

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
  const customWorkersUrl = process.env.COSMIC_WORKERS_URL;
  const cacheKey = `${apiEnv}:${customWorkersUrl || 'default'}`;

  // Build SDK config
  const sdkConfig: Parameters<typeof createBucketClient>[0] = {
    bucketSlug,
    readKey,
    writeKey,
  };

  // If custom workers URL is set, use custom config
  if (customWorkersUrl) {
    sdkConfig.custom = {
      apiUrl: API_URLS[apiEnv],
      uploadUrl: customWorkersUrl,
    };
  } else {
    sdkConfig.apiEnvironment = apiEnv;
  }

  // Create and cache client
  sdkClient = createBucketClient(sdkConfig);
  currentBucketSlug = bucketSlug;
  currentCacheKey = cacheKey;

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
