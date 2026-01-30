/**
 * Authentication Manager
 * Handles user authentication, token storage, and refresh
 */

import {
  getCredentials,
  setCredentials,
  clearCredentials,
  isAuthenticated,
  getApiUrl,
} from '../config/store.js';
import type { CosmicUser, CosmicCredentials } from '../types.js';

// Token expiration buffer (refresh 5 minutes before expiry)
const TOKEN_EXPIRY_BUFFER = 5 * 60 * 1000;

// Default Dashboard API URL (can be overridden by COSMIC_DAPI_URL env var)
const DEFAULT_DASHBOARD_API_URL = 'https://dapi.cosmicjs.com/v3';

/**
 * Get the Dashboard API URL (respects COSMIC_DAPI_URL env var)
 */
function getDashboardApiUrl(): string {
  return process.env.COSMIC_DAPI_URL || DEFAULT_DASHBOARD_API_URL;
}

// Common headers for Dashboard API requests
const getCommonHeaders = (): Record<string, string> => ({
  'Content-Type': 'application/json',
  'Origin': 'https://app.cosmicjs.com',
  'User-Agent': 'CosmicCLI/1.0.0',
});

/**
 * Verify email with verification code
 */
export async function verifyEmail(
  verificationCode: string
): Promise<{ user: CosmicUser; accessToken: string }> {
  const response = await fetch(`${getDashboardApiUrl()}/users/verifyEmail`, {
    method: 'POST',
    headers: getCommonHeaders(),
    body: JSON.stringify({ verification_code: verificationCode }),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    if (process.env.DEBUG) {
      console.error('Verify email response status:', response.status);
      console.error('Verify email response data:', JSON.stringify(data, null, 2));
    }
    const message = data?.message || data?.error || `Email verification failed (${response.status})`;
    throw new Error(message);
  }

  if (!data || !data.user || !data.token) {
    throw new Error('Invalid verification response');
  }

  // Store credentials after successful verification
  const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
  setCredentials({
    accessToken: data.token,
    expiresAt,
    user: data.user,
  });

  return {
    user: data.user,
    accessToken: data.token,
  };
}

/**
 * Resend verification email
 */
export async function resendVerificationEmail(email: string): Promise<void> {
  const response = await fetch(`${getDashboardApiUrl()}/users/resendVerificationEmail`, {
    method: 'POST',
    headers: getCommonHeaders(),
    body: JSON.stringify({ email }),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    if (process.env.DEBUG) {
      console.error('Resend verification response status:', response.status);
      console.error('Resend verification response data:', JSON.stringify(data, null, 2));
    }
    const message = data?.message || data?.error || `Failed to resend verification email (${response.status})`;
    throw new Error(message);
  }
}

/**
 * Authenticate with email and password
 */
export async function authenticateWithPassword(
  email: string,
  password: string,
  otp?: string
): Promise<{ user: CosmicUser; accessToken: string; requires2FA?: boolean }> {
  const headers: Record<string, string> = getCommonHeaders();

  // Add OTP header if provided (for 2FA)
  if (otp) {
    headers['x-cosmic-otp'] = otp;
  }

  const response = await fetch(`${getDashboardApiUrl()}/users/authenticate`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email, password }),
  });

  const data = await response.json().catch(() => null);

  // Check for 2FA requirement - API returns 206 with X-Cosmic-OTP header
  if (response.status === 206) {
    return {
      user: {} as CosmicUser,
      accessToken: '',
      requires2FA: true,
    };
  }

  if (!response.ok) {
    // Debug: show what we got back
    if (process.env.DEBUG) {
      console.error('Auth response status:', response.status);
      console.error('Auth response data:', JSON.stringify(data, null, 2));
    }
    const message = data?.message || data?.error || `Authentication failed (${response.status})`;
    throw new Error(message);
  }

  if (!data || !data.user || !data.token) {
    console.error('Unexpected response:', JSON.stringify(data, null, 2));
    throw new Error('Invalid authentication response');
  }

  // Store credentials
  const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days default

  setCredentials({
    accessToken: data.token,
    expiresAt,
    user: data.user,
  });

  return {
    user: data.user,
    accessToken: data.token,
  };
}

/**
 * Authenticate with bucket keys (alternative to user auth)
 */
export function authenticateWithBucketKeys(
  bucketSlug: string,
  readKey: string,
  writeKey?: string
): void {
  setCredentials({
    bucketSlug,
    readKey,
    writeKey,
    // Clear user auth when using bucket keys
    accessToken: undefined,
    user: undefined,
    expiresAt: undefined,
  });
}

/**
 * Get the current access token, refreshing if needed
 */
export async function getAccessToken(): Promise<string | undefined> {
  const creds = getCredentials();

  if (!creds.accessToken) {
    return undefined;
  }

  // Check if token needs refresh
  if (creds.expiresAt && Date.now() >= creds.expiresAt - TOKEN_EXPIRY_BUFFER) {
    // Token is expired or about to expire
    // For now, we just return undefined and require re-login
    // In the future, we could implement refresh token logic here
    return undefined;
  }

  return creds.accessToken;
}

/**
 * Get the current user
 */
export function getCurrentUser(): CosmicUser | undefined {
  return getCredentials().user;
}

/**
 * Get bucket keys for API access
 */
export function getBucketKeys(): { readKey?: string; writeKey?: string } {
  const creds = getCredentials();
  return {
    readKey: creds.readKey,
    writeKey: creds.writeKey,
  };
}

/**
 * Logout - clear all credentials
 */
export function logout(): void {
  clearCredentials();
}

/**
 * Check if the current auth is user-based (JWT) or bucket-key based
 */
export function getAuthType(): 'user' | 'bucket' | 'none' {
  const creds = getCredentials();

  if (creds.accessToken) {
    return 'user';
  }

  if (creds.bucketSlug && creds.readKey) {
    return 'bucket';
  }

  return 'none';
}

/**
 * Validate the current authentication by making a test API call
 */
export async function validateAuth(): Promise<boolean> {
  const creds = getCredentials();

  if (creds.accessToken) {
    try {
      const response = await fetch(`${getDashboardApiUrl()}/users/get`, {
        headers: {
          Authorization: `Bearer ${creds.accessToken}`,
          'Origin': 'https://app.cosmicjs.com',
          'User-Agent': 'CosmicCLI/1.0.0',
        },
      });

      if (response.ok) {
        const data = await response.json();
        if (data.user) {
          // Update stored user info
          setCredentials({ user: data.user });
          return true;
        }
      }
      return false;
    } catch {
      return false;
    }
  }

  // For bucket key auth, we assume it's valid if keys are present
  // The actual validation will happen when making API calls
  if (creds.bucketSlug && creds.readKey) {
    return true;
  }

  return false;
}

/**
 * Get auth headers for API requests
 */
export function getAuthHeaders(): Record<string, string> {
  const creds = getCredentials();
  const headers: Record<string, string> = {};

  if (creds.accessToken) {
    headers['Authorization'] = `Bearer ${creds.accessToken}`;
  } else if (creds.writeKey) {
    headers['Authorization'] = creds.writeKey;
  }

  return headers;
}

/**
 * Get query params for read-only API requests (bucket key auth)
 */
export function getReadQueryParams(): Record<string, string> {
  const creds = getCredentials();
  const params: Record<string, string> = {};

  if (creds.readKey) {
    params['read_key'] = creds.readKey;
  }

  return params;
}

export default {
  verifyEmail,
  resendVerificationEmail,
  authenticateWithPassword,
  authenticateWithBucketKeys,
  getAccessToken,
  getCurrentUser,
  getBucketKeys,
  logout,
  getAuthType,
  validateAuth,
  getAuthHeaders,
  getReadQueryParams,
  isAuthenticated,
};
