/**
 * Shared mutable state for the chat REPL
 * All chat modules import this singleton to access/modify state.
 */

import * as readline from 'readline';
import type { ChatMessage, ChatContext } from './types.js';

class ChatState {
  /** Conversation history */
  conversationHistory: ChatMessage[] = [];

  /** Build mode flag - when true, uses higher max_tokens for app generation */
  isBuildMode = false;

  /** Content mode flag - when true, focused on content creation/updates */
  isContentMode = false;

  /** Automate mode flag - when true, focused on creating agents and workflows */
  isAutomateMode = false;

  /** Repo mode flag - when true, uses streamingRepositoryUpdate instead of regular chat */
  isRepoMode = false;

  /** Ask mode flag - when true (default), AI only answers questions without actions */
  isAskMode = true;

  /** Media IDs for the current message (set when user attaches images via @path or paste) */
  pendingMediaIds: string[] = [];

  /** Current chat context - object types, links, etc. */
  chatContext: ChatContext = {};

  /** Fetched context data - actual content from URLs and objects */
  fetchedContextData: {
    objects: Record<string, unknown>[];
    linkContents: { url: string; content: string }[];
  } = { objects: [], linkContents: [] };

  /** Current repository info for repo mode */
  currentRepo: {
    id: string;
    owner: string;
    name: string;
    branch: string;
  } | null = null;

  /** Last successful deployment URL (for "open" command) */
  lastDeploymentUrl: string | null = null;

  /** Main readline interface - shared across the module */
  mainRl: readline.Interface | null = null;

  /** Shared line input function - set by the main chat loop */
  sharedAskLine: ((prompt: string) => Promise<string>) | null = null;

  /** Flag to skip confirmations during auto-continue mode */
  skipConfirmations = false;

  /** Reset state for a new chat session */
  reset(): void {
    this.conversationHistory = [];
    this.pendingMediaIds = [];
    this.fetchedContextData = { objects: [], linkContents: [] };
  }
}

/** Singleton chat state instance */
export const state = new ChatState();
