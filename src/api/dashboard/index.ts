/**
 * Dashboard API
 * Re-exports all dashboard modules for backward compatibility
 */

// Core - User, Workspaces, Projects, Buckets
export {
  getUser,
  listWorkspaces,
  getWorkspace,
  listProjects,
  getProject,
  createProject,
  getBucket,
  type CreateProjectData,
} from './core.js';

// Objects & Object Types
export {
  listObjects,
  getObject,
  createObject,
  updateObject,
  deleteObjects,
  publishObjects,
  unpublishObjects,
  listObjectTypes,
  getObjectType,
  createObjectType,
  createObjectWithMetafields,
  updateObjectWithMetafields,
  getObjectTypesWithMetafields,
  searchObjects,
  type ListObjectsOptions,
  type CreateObjectData,
  type UpdateObjectData,
  updateObjectType,
  deleteObjectType,
  duplicateObjectType,
  type CreateObjectTypeData,
  type UpdateObjectTypeData,
} from './objects.js';

// Media
export {
  listMedia,
  getMedia,
  deleteMedia,
  uploadMedia,
  listMediaFolders,
  createMediaFolder,
  updateMediaFolder,
  deleteMediaFolder,
  addMediaToFolder,
  removeMediaFromFolder,
  type ListMediaOptions,
  type MediaFolder,
  type CreateMediaFolderData,
  type UpdateMediaFolderData,
} from './media.js';

// Workflows
export {
  listWorkflows,
  getWorkflow,
  createWorkflow,
  updateWorkflow,
  deleteWorkflow,
  executeWorkflow,
  listExecutions,
  getExecution,
  cancelExecution,
  type ListWorkflowsOptions,
  type CreateWorkflowData,
  type ExecuteWorkflowOptions,
} from './workflows.js';

// Agents
export {
  listAgents,
  getAgent,
  createAgent,
  updateAgent,
  deleteAgent,
  runAgent,
  listAgentExecutions,
  getAgentExecution,
  importAuthSession,
  deleteAuthSession,
  addAgentFollowUp,
  createAgentPR,
  getPendingOperations,
  executeOperations,
  markExecutionComplete,
  type CreateAgentData,
  type PreAuthSession,
  type ImportAuthData,
  type ImportAuthResponse,
  type PendingOperation,
  type PendingEnvVar,
  type PendingOperations,
} from './agents.js';

// Repositories
export {
  listRepositories,
  getRepository,
  createRepository,
  updateRepository,
  deleteRepository,
  listBranches,
  createBranch,
  deleteBranch,
  listPullRequests,
  getPullRequest,
  createPullRequest,
  mergePullRequest,
  updatePullRequest,
  closePullRequest,
  reopenPullRequest,
  getRepositoryEnvVars,
  addRepositoryEnvVar,
  updateRepositoryEnvVar,
  deleteRepositoryEnvVar,
  type Repository,
  type Branch,
  type CreateRepositoryData,
  type PullRequest,
  type CreatePullRequestData,
  type MergePullRequestData,
  type UpdatePullRequestData,
  type RepositoryEnvVar,
  type AddEnvVarData,
  type UpdateEnvVarData,
  listRepositoryDomains,
  addRepositoryDomain,
  updateRepositoryDomain,
  removeRepositoryDomain,
  type RepositoryDomain,
  type ListRepositoryDomainsResponse,
  type AddDomainData,
  type UpdateDomainData,
} from './repos.js';

// Deployments
export {
  deployRepository,
  listDeployments,
  getLatestDeployment,
  getDeploymentLogs,
  cancelDeployment,
  redeployProject,
  getLatestDeploymentStatus,
  deployAIApp,
  checkRepoAvailability,
  type Deployment,
  type DeploymentLog,
  type DeploymentStatusResponse,
  type DeploymentLogsResponse,
  type RedeployOptions,
  type DeployAIAppData,
  type DeployAIAppResponse,
  type RepoAvailabilityResponse,
} from './deployments.js';

// Domains
export {
  listDomains,
  getDomain,
  searchDomains,
  checkAvailability,
  getDomainPricing,
  importDomain,
  updateDomainSettings,
  deleteDomain,
  connectDomain,
  disconnectDomain,
  listDnsRecords,
  createDnsRecord,
  updateDnsRecord,
  deleteDnsRecord,
  type Domain,
  type DnsRecord,
  type DomainSuggestion,
  type ImportDomainData,
  type ConnectDomainData,
  type UpdateDomainSettingsData,
  type CreateDnsRecordData,
  type UpdateDnsRecordData,
} from './domains.js';

// Team
export {
  listProjectTeam,
  addProjectTeamMember,
  updateProjectTeamMember,
  removeProjectTeamMember,
  searchProjectTeamMember,
  type TeamMember,
  type AddTeamMemberData,
  type UpdateTeamMemberData,
} from './team.js';

// Webhooks
export {
  listWebhooks,
  getWebhook,
  createWebhook,
  updateWebhook,
  deleteWebhook,
  type Webhook,
  type CreateWebhookData,
  type UpdateWebhookData,
} from './webhooks.js';

// Billing
export {
  listProjectPlans,
  addProjectPlanSubscription,
  cancelProjectPlanSubscription,
  listProjectAddons,
  addProjectAddonSubscription,
  cancelProjectAddonSubscription,
  addProjectUserAddon,
  addProjectBucketAddon,
  addProjectAITokensAddon,
  getProjectBillingPortalUrl,
  getProjectUsage,
  type Plan,
  type Addon,
  type ProjectUsageResponse,
} from './billing.js';

// AI
export {
  listModels,
  generateText,
  generateImage,
  streamingChat,
  streamingRepositoryUpdate,
  commitPendingOperations,
  type ChatMessage,
  type StreamingChatOptions,
  type RepositoryUpdateOptions,
  type RepositoryUpdateResult,
  type RepositoryPendingOperations,
  type EnvVarFromBackend,
  type CommitPendingOptions,
  type CommitPendingResult,
} from './ai.js';

