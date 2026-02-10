/**
 * Dashboard API - AI
 * AI generation, chat streaming, and repository updates
 */

import axios from 'axios';
import { get, post } from '../client.js';
import { getWorkersUrl } from '../../config/store.js';
import { CLI_VERSION } from '../../version.js';
import type { AIModel, AITextRequest, AITextResponse, Media } from '../../types.js';

// ============================================================================
// AI Models & Generation
// ============================================================================

export async function listModels(bucketSlug: string): Promise<AIModel[]> {
  const response = await get<{ models: AIModel[] }>('/ai/models', { bucketSlug });
  return response.models || [];
}

export async function generateText(
  bucketSlug: string,
  request: AITextRequest
): Promise<AITextResponse> {
  const response = await post<AITextResponse>('/ai/chat', request, {
    bucketSlug,
  });
  return response;
}

export async function generateImage(
  bucketSlug: string,
  prompt: string,
  options: { folder?: string; alt_text?: string; metadata?: Record<string, unknown> } = {}
): Promise<Media> {
  const workersUrl = getWorkersUrl();
  const { getBucketKeys } = await import('../../auth/manager.js');
  const { writeKey } = getBucketKeys();

  if (process.env.COSMIC_DEBUG === '1') {
    console.log(`  [DEBUG] generateImage:`);
    console.log(`    Workers URL: ${workersUrl}`);
    console.log(`    Bucket: ${bucketSlug}`);
    console.log(`    Write Key: ${writeKey ? writeKey.substring(0, 8) + '...' : 'NOT SET'}`);
  }

  if (!writeKey) {
    throw new Error('Write key required for image generation. Run "cosmic use" to configure bucket keys.');
  }

  const response = await axios.post<{ media: Media }>(
    `${workersUrl}/buckets/${bucketSlug}/ai/image`,
    { prompt, write_key: writeKey, ...options },
    {
      headers: {
        'Content-Type': 'application/json',
      },
    }
  );

  return response.data.media;
}

// ============================================================================
// AI Chat with Streaming (Dashboard API)
// ============================================================================

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: Array<{ type: 'text'; text: string }>;
}

export interface StreamingChatOptions {
  messages: ChatMessage[];
  bucketSlug: string;
  model?: string;
  maxTokens?: number;
  viewMode?: 'content-model' | 'build-app' | 'agent' | 'ask';
  selectedObjectTypes?: string[];
  links?: string[];
  media?: string[];
  contextConfig?: {
    objects?: {
      enabled: boolean;
      object_types?: string[];
      include_models?: boolean;
      limit?: number;
      depth?: number;
      props?: string[];
    };
  };
  metadata?: {
    chat_mode?: string;
    [key: string]: unknown;
  };
  onChunk?: (chunk: string) => void;
  onProgress?: (progress: { stage: string; message?: string; percentage?: number }) => void;
  onComplete?: (fullText: string, messageId?: string) => void;
  onError?: (error: Error) => void;
}

export async function streamingChat(options: StreamingChatOptions): Promise<{ text: string; messageId?: string }> {
  const {
    messages,
    bucketSlug,
    model = 'claude-opus-4-5-20251101',
    maxTokens = 32000,
    viewMode = 'build-app',
    selectedObjectTypes = [],
    links,
    media,
    contextConfig,
    metadata: extraMetadata,
    onChunk,
    onProgress,
    onComplete,
    onError,
  } = options;

  const { getApiUrl } = await import('../../config/store.js');
  const { getAuthHeaders } = await import('../../auth/manager.js');
  const baseUrl = getApiUrl();
  const authHeaders = getAuthHeaders();

  const endpoint = `${baseUrl}/ai/chat?slug=${bucketSlug}`;

  const headers: Record<string, string> = {
    ...authHeaders,
    'Content-Type': 'application/json',
    'Origin': 'https://app.cosmicjs.com',
    'User-Agent': `CosmicCLI/${CLI_VERSION}`,
  };

  const requestPayload: Record<string, unknown> = {
    messages,
    model,
    stream: true,
    max_tokens: maxTokens,
    metadata: {
      view_mode: viewMode,
      chat_mode: extraMetadata?.chat_mode || 'agent',
      selected_object_types: selectedObjectTypes,
      ...extraMetadata,
    },
    context: contextConfig || {
      objects: {
        enabled: true,
        object_types: selectedObjectTypes.length > 0 ? selectedObjectTypes : undefined,
        include_models: true,
        limit: 100,
      },
      bucket: {
        enabled: true,
        include_object_types: true,
        include_media: false,
      },
    },
  };

  if (links && links.length > 0) {
    requestPayload.links = links;
  }

  if (media && media.length > 0) {
    requestPayload.media = media;
  }

  let fullText = '';
  let messageId: string | undefined;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestPayload),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errMessage = (errorData as { message?: string }).message || `HTTP error: ${response.status}`;
      const err = new Error(errMessage) as Error & { status?: number; errorCode?: string };
      err.status = response.status;
      if ((errorData as { error?: string }).error) {
        err.errorCode = (errorData as { error?: string }).error;
      }
      throw err;
    }

    if (!response.body) {
      throw new Error('No response body for streaming');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });

      const lines = chunk.split('\n');
      let filteredChunk = '';

      for (const line of lines) {
        if (line.trim().startsWith('data: {')) {
          try {
            const jsonStr = line.trim().replace(/^data:\s*/, '');
            const data = JSON.parse(jsonStr);
            if (data.metadata?.message_id && !messageId) {
              messageId = data.metadata.message_id;
            }
          } catch {
            // Ignore parsing errors
          }
          continue;
        }
        filteredChunk += line + '\n';
      }

      if (!chunk.endsWith('\n') && filteredChunk.endsWith('\n')) {
        filteredChunk = filteredChunk.slice(0, -1);
      }

      fullText += filteredChunk;

      if (filteredChunk) {
        onChunk?.(filteredChunk);
      }

      const messageIdMatch = fullText.match(/<!--\s*MESSAGE_ID:\s*([a-f0-9-]+)\s*-->/i);
      if (messageIdMatch && !messageId) {
        messageId = messageIdMatch[1];
      }

      const progressMatch = chunk.match(/<!--\s*PROGRESS:\s*(\{.*?\})\s*-->/);
      if (progressMatch) {
        try {
          const progressData = JSON.parse(progressMatch[1]);
          onProgress?.({
            stage: 'building',
            message: progressData.filename || `File ${progressData.current}/${progressData.total}`,
            percentage: progressData.total ? (progressData.current / progressData.total) * 100 : undefined,
          });
        } catch {
          // Ignore progress parsing errors
        }
      }
    }

    onComplete?.(fullText, messageId);
    return { text: fullText, messageId };
  } catch (error) {
    onError?.(error as Error);
    throw error;
  }
}

// ============================================================================
// AI Repository Update with Streaming
// ============================================================================

export interface EnvVarFromBackend {
  key: string;
  description: string;
  required: boolean;
  detected_in?: string;
}

export interface PendingOperation {
  path: string;
  operation: string;
  content?: string;
}

export interface RepositoryPendingOperations {
  operations: PendingOperation[];
  commit_message: string;
  branch: string;
  repo_full_name: string;
}

export interface RepositoryUpdateProgress {
  stage: string;
  message?: string;
  percentage?: number;
  env_vars?: EnvVarFromBackend[];
  repository_id?: string;
  required_before_deploy?: boolean;
  env_vars_pending?: boolean;
  pending_operations?: RepositoryPendingOperations;
}

export interface RepositoryUpdateOptions {
  repositoryOwner: string;
  repositoryName: string;
  repositoryId?: string;
  bucketSlug: string;
  messages: ChatMessage[];
  branch?: string;
  model?: string;
  maxTokens?: number;
  buildLogs?: string;
  chatMode?: 'agent' | 'ask';
  onChunk?: (chunk: string) => void;
  onProgress?: (progress: RepositoryUpdateProgress) => void;
  onComplete?: (fullText: string, requestId?: string) => void;
  onError?: (error: Error) => void;
}

export interface RepositoryUpdateResult {
  text: string;
  requestId?: string;
  envVarsPending?: boolean;
  envVars?: EnvVarFromBackend[];
  pendingOperations?: RepositoryPendingOperations;
}

export async function streamingRepositoryUpdate(options: RepositoryUpdateOptions): Promise<RepositoryUpdateResult> {
  const {
    repositoryOwner,
    repositoryName,
    repositoryId,
    bucketSlug,
    messages,
    branch = 'main',
    model = 'claude-opus-4-5-20251101',
    maxTokens = 32000,
    chatMode = 'agent',
    onChunk,
    onProgress,
    onComplete,
    onError,
  } = options;

  const { getApiUrl } = await import('../../config/store.js');
  const { getAuthHeaders } = await import('../../auth/manager.js');
  const baseUrl = getApiUrl();
  const authHeaders = getAuthHeaders();

  const endpoint = `${baseUrl}/ai/chat/update-repository?slug=${bucketSlug}`;

  const headers: Record<string, string> = {
    ...authHeaders,
    'Content-Type': 'application/json',
    'Origin': 'https://app.cosmicjs.com',
    'User-Agent': `CosmicCLI/${CLI_VERSION}`,
  };

  const formattedMessages = messages.map((msg) => ({
    role: msg.role,
    content: [{ type: 'text', text: msg.content }],
  }));

  const requestPayload = {
    repository_owner: repositoryOwner,
    repository_name: repositoryName,
    repository_id: repositoryId,
    messages: formattedMessages,
    branch,
    model,
    max_tokens: maxTokens,
    stream: true,
    slug: bucketSlug,
    metadata: {
      chat_mode: chatMode,
    },
  };

  let fullText = '';
  let requestId: string | undefined;
  // Track pending operations and env vars for two-phase deployment
  let envVarsPending = false;
  let detectedEnvVars: EnvVarFromBackend[] | undefined;
  let pendingOperations: RepositoryPendingOperations | undefined;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestPayload),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errMessage = (errorData as { message?: string }).message || `HTTP error: ${response.status}`;
      const err = new Error(errMessage) as Error & { status?: number; errorCode?: string };
      err.status = response.status;
      if ((errorData as { error?: string }).error) {
        err.errorCode = (errorData as { error?: string }).error;
      }
      throw err;
    }

    if (!response.body) {
      throw new Error('No response body for streaming');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      buffer += chunk;

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmedLine = line.trim();

        if (!trimmedLine || trimmedLine.startsWith(':')) {
          continue;
        }

        if (trimmedLine.startsWith('data: ')) {
          const dataContent = trimmedLine.slice(6);

          if (dataContent.startsWith('{')) {
            try {
              const data = JSON.parse(dataContent);

              if (data.metadata?.request_id && !requestId) {
                requestId = data.metadata.request_id;
              }

              const textContent = data.text || data.content || data.delta?.content || data.choices?.[0]?.delta?.content || '';
              if (textContent) {
                fullText += textContent;
                onChunk?.(textContent);
              }

              // Track env_vars_pending and pending_operations from backend
              if (data.env_vars_pending || data.details?.env_vars_pending) {
                envVarsPending = true;
              }
              if (data.env_vars || data.details?.env_vars) {
                detectedEnvVars = data.env_vars || data.details?.env_vars;
              }
              if (data.pending_operations || data.details?.pending_operations) {
                pendingOperations = data.pending_operations || data.details?.pending_operations;
              }

              if (data.progress || data.stage) {
                const progressData: RepositoryUpdateProgress = {
                  stage: data.stage || 'updating',
                  message: data.message || data.progress?.message,
                  percentage: data.progress?.percentage,
                  // Pass env vars data for env_vars_required events
                  env_vars: data.env_vars || data.progress?.env_vars || data.details?.env_vars,
                  repository_id: data.repository_id || data.progress?.repository_id,
                  required_before_deploy: data.required_before_deploy || data.progress?.required_before_deploy,
                  env_vars_pending: data.env_vars_pending || data.details?.env_vars_pending,
                  pending_operations: data.pending_operations || data.details?.pending_operations,
                };
                onProgress?.(progressData);

                // Also capture from progress data
                if (progressData.env_vars_pending) {
                  envVarsPending = true;
                }
                if (progressData.env_vars && progressData.env_vars.length > 0) {
                  detectedEnvVars = progressData.env_vars;
                }
                if (progressData.pending_operations) {
                  pendingOperations = progressData.pending_operations;
                }
              }
            } catch {
              fullText += dataContent;
              onChunk?.(dataContent);
            }
          } else if (dataContent !== '[DONE]') {
            fullText += dataContent;
            onChunk?.(dataContent);
          }
        }
      }

      const progressMatch = chunk.match(/<!--\s*PROGRESS:\s*(\{.*?\})\s*-->/);
      if (progressMatch) {
        try {
          const progressData = JSON.parse(progressMatch[1]);
          onProgress?.({
            stage: 'updating',
            message: progressData.filename || `File ${progressData.current}/${progressData.total}`,
            percentage: progressData.total ? (progressData.current / progressData.total) * 100 : undefined,
          });
        } catch {
          // Ignore progress parsing errors
        }
      }

      const requestIdMatch = chunk.match(/<!--\s*REQUEST_ID:\s*([a-f0-9-]+)\s*-->/i);
      if (requestIdMatch && !requestId) {
        requestId = requestIdMatch[1];
      }
    }

    onComplete?.(fullText, requestId);
    return {
      text: fullText,
      requestId,
      envVarsPending,
      envVars: detectedEnvVars,
      pendingOperations,
    };
  } catch (error) {
    onError?.(error as Error);
    throw error;
  }
}

// ============================================================================
// Commit Pending Operations (after env vars are configured)
// ============================================================================

export interface CommitPendingOptions {
  bucketSlug: string;
  operations: PendingOperation[];
  commitMessage: string;
  branch: string;
  repoFullName: string;
  repositoryId?: string;
}

export interface CommitPendingResult {
  success: boolean;
  commit_sha?: string;
  commit_url?: string;
  error?: string;
  message?: string;
}

/**
 * Commit pending operations after environment variables have been configured.
 * This is called after the initial repository update was blocked due to missing env vars.
 */
export async function commitPendingOperations(options: CommitPendingOptions): Promise<CommitPendingResult> {
  const {
    bucketSlug,
    operations,
    commitMessage,
    branch,
    repoFullName,
    repositoryId,
  } = options;

  const { getApiUrl } = await import('../../config/store.js');
  const { getAuthHeaders } = await import('../../auth/manager.js');
  const baseUrl = getApiUrl();
  const authHeaders = getAuthHeaders();

  const endpoint = `${baseUrl}/ai/repository-update/commit-pending?slug=${bucketSlug}`;

  const headers: Record<string, string> = {
    ...authHeaders,
    'Content-Type': 'application/json',
    'Origin': 'https://app.cosmicjs.com',
    'User-Agent': `CosmicCLI/${CLI_VERSION}`,
  };

  const requestPayload = {
    operations,
    commit_message: commitMessage,
    branch,
    repo_full_name: repoFullName,
    repository_id: repositoryId,
    skip_env_var_check: true, // We've already verified env vars are configured
  };

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestPayload),
    });

    const result = await response.json() as CommitPendingResult;

    if (!response.ok) {
      return {
        success: false,
        error: result.error || 'COMMIT_FAILED',
        message: result.message || `HTTP error: ${response.status}`,
      };
    }

    return result;
  } catch (error) {
    return {
      success: false,
      error: 'NETWORK_ERROR',
      message: (error as Error).message,
    };
  }
}
