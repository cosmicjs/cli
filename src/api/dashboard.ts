/**
 * Dashboard API Methods
 * Re-exports from modular dashboard files for backward compatibility
 */

// Re-export everything from the dashboard modules
export * from './dashboard/index.js';

// Re-export types that were previously exported from this file
export type { Repository, Branch } from './dashboard/repos.js';
export type { Deployment, DeploymentLog } from './dashboard/deployments.js';
