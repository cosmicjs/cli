/**
 * Configuration Store
 * Manages persistent configuration stored in ~/.cosmic/
 */

import Conf from 'conf';
import { homedir } from 'os';
import { join } from 'path';
import type { CosmicConfig, CosmicCredentials } from '../types.js';

const CONFIG_DIR = join(homedir(), '.cosmic');

// Configuration store for app settings
const configStore = new Conf<CosmicConfig>({
  projectName: 'cosmic-cli',
  cwd: CONFIG_DIR,
  configName: 'config',
  defaults: {
    apiUrl: 'https://dapi.cosmicjs.com/v3',
    defaultModel: 'claude-opus-4-5-20251101',
  },
});

// Credentials store for auth tokens (separate file for security)
const credentialsStore = new Conf<CosmicCredentials>({
  projectName: 'cosmic-cli',
  cwd: CONFIG_DIR,
  configName: 'credentials',
  defaults: {},
});

/**
 * Get the full configuration
 */
export function getConfig(): CosmicConfig {
  return configStore.store;
}

/**
 * Get a specific config value
 */
export function getConfigValue<K extends keyof CosmicConfig>(key: K): CosmicConfig[K] {
  return configStore.get(key);
}

/**
 * Set a config value
 */
export function setConfigValue<K extends keyof CosmicConfig>(
  key: K,
  value: CosmicConfig[K]
): void {
  configStore.set(key, value);
}

/**
 * Set multiple config values
 */
export function setConfig(config: Partial<CosmicConfig>): void {
  for (const [key, value] of Object.entries(config)) {
    if (value !== undefined) {
      configStore.set(key as keyof CosmicConfig, value);
    }
  }
}

/**
 * Clear a config value
 */
export function clearConfigValue(key: keyof CosmicConfig): void {
  configStore.delete(key);
}

/**
 * Reset config to defaults
 */
export function resetConfig(): void {
  configStore.clear();
}

/**
 * Get credentials
 */
export function getCredentials(): CosmicCredentials {
  return credentialsStore.store;
}

/**
 * Get a specific credential value
 */
export function getCredentialValue<K extends keyof CosmicCredentials>(
  key: K
): CosmicCredentials[K] {
  return credentialsStore.get(key);
}

/**
 * Set credentials
 */
export function setCredentials(credentials: Partial<CosmicCredentials>): void {
  for (const [key, value] of Object.entries(credentials)) {
    if (value !== undefined) {
      credentialsStore.set(key as keyof CosmicCredentials, value);
    }
  }
}

/**
 * Clear all credentials (logout)
 */
export function clearCredentials(): void {
  credentialsStore.clear();
}

/**
 * Check if user is authenticated
 */
export function isAuthenticated(): boolean {
  const creds = getCredentials();

  // Check for user auth (JWT token)
  if (creds.accessToken) {
    // Check if token is expired
    if (creds.expiresAt && Date.now() >= creds.expiresAt) {
      return false;
    }
    return true;
  }

  // Check for bucket key auth
  if (creds.bucketSlug && creds.readKey) {
    return true;
  }

  return false;
}

/**
 * Get the API base URL
 */
export function getApiUrl(): string {
  return getConfigValue('apiUrl') || 'https://dapi.cosmicjs.com/v3';
}

/**
 * Get the current bucket slug from context or credentials
 */
export function getCurrentBucketSlug(): string | undefined {
  return getConfigValue('currentBucket') || getCredentialValue('bucketSlug');
}

/**
 * Get the current workspace slug
 */
export function getCurrentWorkspaceSlug(): string | undefined {
  return getConfigValue('currentWorkspace');
}

/**
 * Get the current workspace ID (MongoDB ObjectId)
 */
export function getCurrentWorkspaceId(): string | undefined {
  return getConfigValue('currentWorkspaceId');
}

/**
 * Get the current project slug
 */
export function getCurrentProjectSlug(): string | undefined {
  return getConfigValue('currentProject');
}

/**
 * Get the current project ID (MongoDB ObjectId)
 */
export function getCurrentProjectId(): string | undefined {
  return getConfigValue('currentProjectId');
}

/**
 * Get the default AI model
 */
export function getDefaultModel(): string {
  return getConfigValue('defaultModel') || 'claude-opus-4-5-20251101';
}

/**
 * Set the current context (workspace/project/bucket)
 */
export function setContext(
  workspace?: string,
  project?: string,
  bucket?: string,
  workspaceId?: string,
  projectId?: string
): void {
  if (workspace !== undefined) {
    if (workspace) {
      setConfigValue('currentWorkspace', workspace);
    } else {
      clearConfigValue('currentWorkspace');
    }
  }
  if (workspaceId !== undefined) {
    if (workspaceId) {
      setConfigValue('currentWorkspaceId', workspaceId);
    } else {
      clearConfigValue('currentWorkspaceId');
    }
  }
  if (project !== undefined) {
    if (project) {
      setConfigValue('currentProject', project);
    } else {
      clearConfigValue('currentProject');
    }
  }
  if (projectId !== undefined) {
    if (projectId) {
      setConfigValue('currentProjectId', projectId);
    } else {
      clearConfigValue('currentProjectId');
    }
  }
  if (bucket !== undefined) {
    if (bucket) {
      setConfigValue('currentBucket', bucket);
    } else {
      clearConfigValue('currentBucket');
    }
  }
}

/**
 * Get the config directory path
 */
export function getConfigDir(): string {
  return CONFIG_DIR;
}

export default {
  getConfig,
  getConfigValue,
  setConfigValue,
  setConfig,
  clearConfigValue,
  resetConfig,
  getCredentials,
  getCredentialValue,
  setCredentials,
  clearCredentials,
  isAuthenticated,
  getApiUrl,
  getCurrentBucketSlug,
  getCurrentWorkspaceSlug,
  getCurrentWorkspaceId,
  getCurrentProjectSlug,
  getCurrentProjectId,
  getDefaultModel,
  setContext,
  getConfigDir,
};
