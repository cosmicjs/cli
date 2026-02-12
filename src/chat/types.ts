/**
 * Shared types for the chat module
 */

export interface ExtractedContent {
  objectTypes: Record<string, unknown>[];
  demoObjects: Record<string, unknown>[];
  hasAddContent: boolean;
}

export interface BuildPreferences {
  description: string;
  technology: string;
  design: string;
  features: string[];
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Context for AI chat - object types, links, etc.
 */
export interface ChatContext {
  objectTypes?: string[];        // Object type slugs to include as context
  objectsLimit?: number;         // Max objects per type (default: 3)
  objectsDepth?: number;         // Object depth (default: 1)
  links?: string[];              // External URLs to crawl for context
}

export interface ChatOptions {
  model?: string;
  initialPrompt?: string;  // Pre-loaded prompt to start the conversation
  buildMode?: boolean;     // Whether we're in app building mode (uses higher token limit)
  contentMode?: boolean;   // Whether we're in content creation/update mode
  automateMode?: boolean;  // Whether we're in automation mode (create agents/workflows)
  repoMode?: boolean;      // Whether we're in repository update mode
  repoName?: string;       // Specific repository name to update
  repoBranch?: string;     // Branch to use in repo mode
  askMode?: boolean;       // Whether to run in ask/read-only mode (default: true)
  context?: ChatContext;   // Structured context (object types, links, etc.)
}

/**
 * Response from a mode's processMessage handler
 */
export interface ProcessMessageResponse {
  text: string;
  usage?: { input_tokens: number; output_tokens: number };
  messageId?: string;
  _alreadyStreamed?: boolean;
  _contentHandledViaMetadata?: boolean;
}
