/**
 * Cosmic CLI Type Definitions
 */

// Configuration types
export interface CosmicConfig {
  currentWorkspace?: string;
  currentWorkspaceId?: string;
  currentProject?: string;
  currentProjectId?: string;
  currentBucket?: string;
  currentObjectType?: string;
  defaultModel?: string;
  apiUrl?: string;
  sdkUrl?: string;  // Custom SDK URL for local development (e.g., http://localhost:8080/v3)
}

export interface CosmicCredentials {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  user?: CosmicUser;
  // Bucket key auth (alternative to user auth)
  bucketSlug?: string;
  readKey?: string;
  writeKey?: string;
}

// User types
export interface CosmicUser {
  id: string;
  email: string;
  first_name?: string;
  last_name?: string;
  avatar_url?: string;
  status?: number;
}

// Workspace types
export interface Workspace {
  id: string;
  title: string;
  slug: string;
  created_at: string;
  modified_at?: string;
}

// Project types
export interface Project {
  id: string;
  title: string;
  slug?: string;
  description?: string;
  workspace_id?: string;
  created_at: string;
  modified_at?: string;
  total_buckets?: number;
  total_users?: number;
  plan_buckets?: number;
  plan_users?: number;
  additional_buckets?: number;
  additional_users?: number;
  additional_ai_tokens?: {
    input_tokens?: number;
    output_tokens?: number;
  };
  buckets?: Bucket[];
}

// Bucket types
export interface Bucket {
  id: string;
  title: string;
  slug: string;
  project_id?: string;
  project?: string;
  created_at: string;
  modified_at?: string;
  api_access?: boolean;
  total_objects?: number;
  total_media?: number;
}

// Object types
export interface CosmicObject {
  id: string;
  title: string;
  slug: string;
  type: string;
  status: 'published' | 'draft';
  content?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
  modified_at?: string;
  published_at?: string;
  locale?: string;
}

export interface ObjectType {
  id: string;
  title: string;
  slug: string;
  singular?: string;
  emoji?: string;
  metafields?: Metafield[];
}

export interface Metafield {
  id?: string;
  key: string;
  title: string;
  type: string;
  value?: unknown;
  required?: boolean;
  options?: MetafieldOption[];
}

export interface MetafieldOption {
  value: string;
  label?: string;
}

// Webhook types
export interface Webhook {
  id: string;
  title: string;
  endpoint: string;
  resource: 'objects' | 'media' | 'merge_request';
  events: string[];
  payload?: boolean;
  props?: string;
  object_types?: string[];
  headers?: { key: string; value: string }[];
  created_at?: string;
  modified_at?: string;
}

// Team types
export interface TeamMember {
  id: string;
  user_id?: string;
  email: string;
  first_name?: string;
  last_name?: string;
  avatar_url?: string;
  project_role: 'admin' | 'manager' | 'user';
  bucket_roles?: {
    bucket_id: string;
    role: 'admin' | 'developer' | 'editor' | 'contributor';
    publishing_restrictions?: 'draft_only';
    additional_permissions?: string[];
    object_types?: string[];
  }[];
  status?: string;
  created_at?: string;
}

// Domain types
export interface Domain {
  id: string;
  domain_name: string;
  status?: string;
  auto_renew?: boolean;
  expires_at?: string;
  created_at?: string;
  updated_at?: string;
  nameservers?: string[];
  custom_nameservers?: string[];
  cdn_enabled?: boolean;
  description?: string;
  repository_id?: string;
  verified?: boolean;
}

export interface DnsRecord {
  id: string;
  type: 'A' | 'AAAA' | 'CNAME' | 'MX' | 'TXT' | 'SRV' | 'NS';
  name: string;
  value: string;
  ttl?: number;
  priority?: number;
  comment?: string;
  created_at?: string;
  updated_at?: string;
}

// Media types
export interface Media {
  id: string;
  name: string;
  original_name?: string;
  url: string;
  imgix_url?: string;
  type?: string;
  size?: number;
  width?: number;
  height?: number;
  alt_text?: string;
  folder?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
}

// Workflow types
export interface Workflow {
  id: string;
  workflow_name: string;
  description?: string;
  emoji?: string;
  status: 'active' | 'draft' | 'paused' | 'archived';
  schedule_type: 'manual' | 'scheduled' | 'event';
  schedule_config?: ScheduleConfig;
  event_trigger_config?: EventTriggerConfig;
  steps: WorkflowStep[];
  shared_context?: Record<string, unknown>;
  user_inputs?: UserInput[];
  created_at: string;
  modified_at?: string;
}

export interface ScheduleConfig {
  enabled: boolean;
  cron_expression?: string;
  timezone?: string;
}

export interface EventTriggerConfig {
  event_types: ('object.created' | 'object.edited' | 'object.deleted' | 'object.published' | 'object.unpublished')[];
  object_types?: string[];
  filter?: Record<string, unknown>;
  debounce_seconds?: number;
}

export interface WorkflowStep {
  agent_type: 'content' | 'repository' | 'computer_use';
  agent_name: string;
  emoji?: string;
  prompt: string;
  model?: string;
  repository_id?: string;
  base_branch?: string;
  start_url?: string;
  goal?: string;
  context?: Record<string, unknown>;
  email_notifications?: boolean;
  require_approval?: boolean;
  runParallel?: boolean;
}

export interface UserInput {
  key: string;
  label: string;
  type: 'text' | 'select' | 'number' | 'boolean';
  required?: boolean;
  default_value?: unknown;
  options?: string[];
}

export interface WorkflowExecution {
  id: string;
  workflow_id: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'waiting_approval' | 'paused';
  trigger_type: 'manual' | 'scheduled' | 'event';
  started_at?: string;
  completed_at?: string;
  current_step?: number;
  step_results?: StepResult[];
  error?: string;
}

export interface StepResult {
  step_index: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
  started_at?: string;
  completed_at?: string;
  output?: unknown;
  error?: string;
}

// Agent types
export interface AgentSchedule {
  enabled: boolean;
  type?: 'once' | 'recurring';
  frequency?: 'hourly' | 'daily' | 'weekly' | 'monthly';
  next_run_at?: string;
  timezone?: string;
}

export interface AgentAuthSession {
  session_id: string;
  auth_state?: unknown;
}

export interface Agent {
  id: string;
  agent_name: string;
  agent_type: 'content' | 'repository' | 'computer_use';
  prompt: string;
  model?: string;
  emoji?: string;
  repository_id?: string;
  base_branch?: string;
  start_url?: string;
  goal?: string;
  context?: Record<string, unknown>;
  schedule?: AgentSchedule;
  auth_sessions?: AgentAuthSession[];
  email_notifications?: boolean;
  require_approval?: boolean;
  created_at: string;
  modified_at?: string;
}

export interface AgentExecution {
  id?: string;
  execution_id?: string;
  _id?: string;
  agent_id: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  started_at?: string;
  completed_at?: string;
  output?: unknown;
  error?: string;
}

// AI types
export interface AIModel {
  id: string;
  name: string;
  provider: 'anthropic' | 'openai' | 'google';
  description?: string;
  category?: string;
  recommended?: boolean;
  contextWindow?: number;
  maxOutputTokens?: number;
  capabilities?: string[];
  pricingTier?: {
    tier: string;
    name: string;
    multiplier: number;
    icon?: string;
  };
}

export interface AITextRequest {
  prompt?: string;
  messages?: AIMessage[];
  model?: string;
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
}

export interface AIMessageContent {
  type: 'text';
  text: string;
}

export interface AIMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | AIMessageContent[];
}

export interface AITextResponse {
  text: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
  model?: string;
}

export interface AIImageRequest {
  prompt: string;
  folder?: string;
  alt_text?: string;
  metadata?: Record<string, unknown>;
}

export interface AIImageResponse {
  media: Media;
  revised_prompt?: string;
}

// API Response types
export interface APIResponse<T = unknown> {
  success?: boolean;
  data?: T;
  message?: string;
  error?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  limit: number;
  skip: number;
  has_more: boolean;
}

// CLI Context
export interface CLIContext {
  config: CosmicConfig;
  credentials: CosmicCredentials;
  isAuthenticated: boolean;
  currentBucketSlug?: string;
}

// Tool definitions for AI chat
export interface AITool {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, AIToolParameter>;
    required?: string[];
  };
}

export interface AIToolParameter {
  type: string;
  description?: string;
  enum?: string[];
  default?: unknown;
  items?: AIToolParameter;
}

export interface AIToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface AIToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}
