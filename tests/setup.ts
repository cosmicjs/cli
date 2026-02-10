/**
 * Global test setup
 * Loads .env, verifies auth + bucket context, and exports a skip flag
 * for test files to check before running integration tests.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Load .env from project root
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: resolve(__dirname, '..', '.env') });

// Import after .env is loaded so env vars are available
const { isAuthenticated, getCurrentBucketSlug } = await import(
  '../src/config/store.js'
);

// Check auth and bucket context
const authenticated = isAuthenticated();
const bucketSlug = getCurrentBucketSlug();

if (!authenticated) {
  console.warn(
    '\n⚠  Not authenticated. Run `cosmic login` first, then re-run tests.\n'
  );
} else if (!bucketSlug) {
  console.warn(
    '\n⚠  No bucket selected. Run `cosmic use` and navigate to a bucket, then re-run tests.\n'
  );
} else {
  const env = process.env.COSMIC_API_ENV || 'production';
  console.log(`\nRunning integration tests against bucket "${bucketSlug}" (${env})\n`);
}

/**
 * If true, integration tests should be skipped because
 * credentials or bucket context are not configured.
 */
export const SKIP_INTEGRATION = !authenticated || !bucketSlug;

/**
 * The bucket slug pulled from the current CLI context.
 * Undefined when SKIP_INTEGRATION is true.
 */
export const TEST_BUCKET_SLUG = bucketSlug;
