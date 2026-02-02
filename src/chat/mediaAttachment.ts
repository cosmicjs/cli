/**
 * Media attachment utilities for chat
 * Supports @path syntax and detecting file paths in user input (e.g. from drag-drop paste)
 */

import { existsSync } from 'fs';
import { resolve, isAbsolute } from 'path';
import { getSDKClient } from '../api/sdk.js';

// Image extensions supported for AI vision
const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tiff', '.tif', '.heic', '.avif',
]);

// MIME types for image extensions
const IMAGE_MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.tiff': 'image/tiff',
  '.tif': 'image/tiff',
  '.heic': 'image/heic',
  '.avif': 'image/avif',
};

// Max file size for upload (10MB)
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

function getContentTypeFromPath(filePath: string): string {
  const ext = filePath.toLowerCase().slice(filePath.lastIndexOf('.'));
  return IMAGE_MIME_TYPES[ext] || 'image/jpeg';
}

/**
 * Check if a path looks like an image file
 */
export function isImagePath(path: string): boolean {
  const ext = path.toLowerCase().slice(path.lastIndexOf('.'));
  return IMAGE_EXTENSIONS.has(ext);
}

/**
 * Extract @path references from user input
 * Supports: @./image.png, @/absolute/path.jpg, @image.png
 */
export function extractAtPaths(input: string): string[] {
  const paths: string[] = [];
  // Match @ followed by path (handles spaces in path with quotes, or simple paths)
  const atPattern = /@([^\s@]+|"[^"]+")/g;
  let match;
  while ((match = atPattern.exec(input)) !== null) {
    let path = match[1].replace(/^["']|["']$/g, '').trim();
    if (path && isImagePath(path)) {
      paths.push(path);
    }
  }
  return paths;
}

/**
 * Detect file paths in input that might have been pasted (e.g. from drag-drop)
 * Returns { resolvedPath, originalSegment } for each found path
 */
export function detectPastedPaths(input: string, cwd: string): Array<{ resolved: string; original: string }> {
  const result: Array<{ resolved: string; original: string }> = [];
  // Match potential file paths: /path/to/file or ./path or path with extension
  const pathPattern = /(\/[\w.-]+\/[\w./-]+\.(?:png|jpg|jpeg|gif|webp|heic|avif))|(\.\/[\w./-]+\.(?:png|jpg|jpeg|gif|webp|heic|avif))/gi;
  let match;
  while ((match = pathPattern.exec(input)) !== null) {
    const original = (match[1] || match[2] || '').trim();
    if (original) {
      const resolved = isAbsolute(original) ? original : resolve(cwd, original);
      if (existsSync(resolved) && isImagePath(resolved)) {
        result.push({ resolved, original });
      }
    }
  }
  return result;
}

export interface ExtractedMedia {
  /** Resolved absolute paths to upload */
  paths: string[];
  /** Original text segments to strip from message (for clean prompt) */
  segmentsToStrip: string[];
}

/**
 * Get unique image paths from user input (combines @paths and detected paths)
 */
export function extractImagePathsFromInput(input: string, cwd: string): ExtractedMedia {
  const atPaths = extractAtPaths(input);
  const pastedPaths = detectPastedPaths(input, cwd);

  const seen = new Set<string>();
  const paths: string[] = [];
  const segmentsToStrip: string[] = [];

  for (const p of atPaths) {
    const resolved = isAbsolute(p) ? p : resolve(cwd, p);
    if (existsSync(resolved) && !seen.has(resolved)) {
      seen.add(resolved);
      paths.push(resolved);
      segmentsToStrip.push(`@${p}`);
    }
  }

  for (const { resolved, original } of pastedPaths) {
    if (!seen.has(resolved)) {
      seen.add(resolved);
      paths.push(resolved);
      segmentsToStrip.push(original);
    }
  }

  return { paths, segmentsToStrip };
}

/**
 * Remove @path references from input for the actual message text
 */
export function stripAtPathsFromInput(input: string): string {
  return input
    .replace(/@([^\s@]+|"[^"]+")/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Remove extracted image path segments from message text (for clean prompt)
 */
export function stripPathsFromMessage(text: string, segmentsToStrip: string[]): string {
  let result = text;
  for (const segment of segmentsToStrip) {
    result = result.replace(segment, '');
  }
  return result.replace(/\s{2,}/g, ' ').trim();
}

/**
 * Upload a local file to Cosmic media and return the media ID
 * Uses SDK media.insertOne() which hits the correct REST API endpoint
 */
export async function uploadFileToMedia(
  filePath: string,
  bucketSlug: string
): Promise<{ id: string; name: string }> {
  const { readFileSync } = await import('fs');
  const { basename } = await import('path');

  const buffer = readFileSync(filePath);
  if (buffer.length > MAX_FILE_SIZE_BYTES) {
    throw new Error(`File too large (max ${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB): ${filePath}`);
  }

  const filename = basename(filePath);
  const contentType = getContentTypeFromPath(filePath);

  const sdk = getSDKClient(bucketSlug);
  if (!sdk) {
    throw new Error('SDK client not available. Ensure bucket credentials (read key, write key) are configured.');
  }

  const result = await sdk.media.insertOne({
    media: buffer,
    filename,
    contentType,
  });

  const media = (result as { media?: { id: string; name: string } }).media;
  if (!media?.id) {
    throw new Error('Media upload succeeded but no media ID returned');
  }

  return {
    id: media.id,
    name: media.name,
  };
}

/**
 * Upload multiple image paths and return media IDs for the chat API
 */
export async function uploadImagesForChat(
  paths: string[],
  bucketSlug: string
): Promise<string[]> {
  const ids: string[] = [];
  for (const path of paths) {
    const { id } = await uploadFileToMedia(path, bucketSlug);
    ids.push(id);
  }
  return ids;
}
