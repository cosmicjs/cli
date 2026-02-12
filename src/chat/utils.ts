/**
 * Pure utility functions for the chat module
 */

import * as crypto from 'crypto';
import chalk from 'chalk';
import { state } from './state.js';

// Fallback images when Unsplash fails
export const FALLBACK_IMAGES = [
  'https://imgix.cosmicjs.com/6bcb64d0-cd77-11ec-bb72-e143ea7952eb-placeholder-1.jpg',
  'https://imgix.cosmicjs.com/6bcbba00-cd77-11ec-bb72-e143ea7952eb-placeholder-2.jpg',
  'https://imgix.cosmicjs.com/6bcc0820-cd77-11ec-bb72-e143ea7952eb-placeholder-3.jpg',
];

/**
 * Get a random fallback image
 */
export function getRandomFallbackImage(): string {
  return FALLBACK_IMAGES[Math.floor(Math.random() * FALLBACK_IMAGES.length)];
}

/**
 * Generate a UUID for metafield IDs
 */
export function generateUUID(): string {
  return crypto.randomUUID();
}

/**
 * Recursively add IDs to metafields
 */
export function addIdsToMetafields(metafields: Record<string, unknown>[]): Record<string, unknown>[] {
  return metafields.map((field) => {
    const fieldWithId = {
      ...field,
      id: generateUUID(),
    };

    // Handle repeater fields with children
    if (field.type === 'repeater' && Array.isArray(field.repeater_fields)) {
      fieldWithId.repeater_fields = addIdsToMetafields(field.repeater_fields as Record<string, unknown>[]);
    }

    // Handle children (for nested fields)
    if (Array.isArray(field.children)) {
      fieldWithId.children = addIdsToMetafields(field.children as Record<string, unknown>[]);
    }

    return fieldWithId;
  });
}

/**
 * Create a slug from a title
 */
export function createSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Format response text with simple markdown-like formatting
 */
export function formatResponse(text: string): string {
  let formatted = text;

  // Bold
  formatted = formatted.replace(/\*\*(.+?)\*\*/g, chalk.bold('$1'));

  // Code blocks
  formatted = formatted.replace(/`([^`]+)`/g, chalk.cyan('$1'));

  // Lists
  formatted = formatted.replace(/^- /gm, chalk.dim('• '));
  formatted = formatted.replace(/^\d+\. /gm, (match) => chalk.dim(match));

  return formatted;
}

/**
 * Get terminal width (with fallback)
 */
export function getTerminalWidth(): number {
  return process.stdout.columns || 80;
}

/**
 * Promisified readline question
 */
export function askQuestion(rl: import('readline').Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

/**
 * Ask for confirmation (defaults to Yes)
 * Uses the shared input function to avoid stdin conflicts
 */
export async function askConfirmation(): Promise<boolean> {
  // Skip confirmation if we're in auto-continue mode
  if (state.skipConfirmations) {
    return true;
  }

  if (state.sharedAskLine) {
    try {
      const answer = await state.sharedAskLine(chalk.dim('[Y/n] '));
      return answer.toLowerCase().trim() !== 'n';
    } catch (err) {
      console.error(chalk.red(`\n[DEBUG] askConfirmation error: ${(err as Error).message}`));
      // Default to no on error to be safe
      return false;
    }
  }
  // Fallback: default to yes if no readline
  return true;
}
