/**
 * Context Management
 * Handles the current workspace/project/bucket context
 */

import chalk from 'chalk';
import {
  getConfig,
  getCredentials,
  setContext,
  isAuthenticated,
  getCurrentBucketSlug,
  getCurrentWorkspaceSlug,
  getCurrentProjectSlug,
} from './store.js';
import type { CLIContext, CosmicConfig, CosmicCredentials } from '../types.js';

/**
 * Get the full CLI context
 */
export function getCLIContext(): CLIContext {
  const config = getConfig();
  const credentials = getCredentials();

  return {
    config,
    credentials,
    isAuthenticated: isAuthenticated(),
    currentBucketSlug: getCurrentBucketSlug(),
  };
}

/**
 * Parse a context string like "workspace/project/bucket"
 */
export function parseContextString(contextStr: string): {
  workspace?: string;
  project?: string;
  bucket?: string;
} {
  const parts = contextStr.split('/').filter(Boolean);

  return {
    workspace: parts[0],
    project: parts[1],
    bucket: parts[2],
  };
}

/**
 * Set context from a string like "workspace/project/bucket"
 */
export function setContextFromString(contextStr: string): void {
  const { workspace, project, bucket } = parseContextString(contextStr);
  setContext(workspace, project, bucket);
}

/**
 * Format the current context for display
 */
export function formatContext(): string {
  const workspace = getCurrentWorkspaceSlug();
  const project = getCurrentProjectSlug();
  const bucket = getCurrentBucketSlug();

  if (!workspace && !project && !bucket) {
    return chalk.dim('No context set');
  }

  const parts: string[] = [];

  if (workspace) {
    parts.push(chalk.cyan(workspace));
  } else {
    parts.push(chalk.dim('*'));
  }

  if (project) {
    parts.push(chalk.green(project));
  } else if (bucket) {
    parts.push(chalk.dim('*'));
  }

  if (bucket) {
    parts.push(chalk.yellow(bucket));
  }

  return parts.join(chalk.dim(' / '));
}

/**
 * Get context display info
 */
export function getContextInfo(): {
  workspace?: string;
  project?: string;
  bucket?: string;
  formatted: string;
  hasContext: boolean;
} {
  const workspace = getCurrentWorkspaceSlug();
  const project = getCurrentProjectSlug();
  const bucket = getCurrentBucketSlug();

  return {
    workspace,
    project,
    bucket,
    formatted: formatContext(),
    hasContext: !!(workspace || project || bucket),
  };
}

/**
 * Validate that we have the required context for an operation
 */
export function requireContext(requirements: {
  workspace?: boolean;
  project?: boolean;
  bucket?: boolean;
}): { valid: boolean; missing: string[] } {
  const missing: string[] = [];

  if (requirements.workspace && !getCurrentWorkspaceSlug()) {
    missing.push('workspace');
  }

  if (requirements.project && !getCurrentProjectSlug()) {
    missing.push('project');
  }

  if (requirements.bucket && !getCurrentBucketSlug()) {
    missing.push('bucket');
  }

  return {
    valid: missing.length === 0,
    missing,
  };
}

/**
 * Check if authenticated and throw a helpful error if not
 */
export function requireAuth(): void {
  if (!isAuthenticated()) {
    throw new Error(
      'Not authenticated. Run `cosmic login` to authenticate or use `cosmic use --bucket=<slug> --read-key=<key>` for bucket access.'
    );
  }
}

/**
 * Check if we have bucket context and throw if not
 */
export function requireBucket(): string {
  const bucket = getCurrentBucketSlug();
  if (!bucket) {
    throw new Error(
      'No bucket selected. Run `cosmic use <workspace>/<project>/<bucket>` to set context.'
    );
  }
  return bucket;
}

export default {
  getCLIContext,
  parseContextString,
  setContextFromString,
  formatContext,
  getContextInfo,
  requireContext,
  requireAuth,
  requireBucket,
};
