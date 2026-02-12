/**
 * Response parsing utilities for the chat module
 */

import type { ExtractedContent } from './types.js';

/**
 * Clean response text for display - removes METADATA markers, ACTION: commands, and JSON code blocks
 */
export function cleanResponseForDisplay(text: string): string {
  // Remove METADATA markers and everything after them (including JSON blocks)
  // Pattern matches: <!-- METADATA: {...} --> followed by optional whitespace and ```json...```
  let cleaned = text;

  // Find the first METADATA marker and truncate there
  const metadataIndex = cleaned.indexOf('<!-- METADATA');
  if (metadataIndex !== -1) {
    cleaned = cleaned.substring(0, metadataIndex);
  }

  // Also handle partial METADATA (when streaming cuts off)
  const partialMetadata = cleaned.indexOf('<!-- META');
  if (partialMetadata !== -1) {
    cleaned = cleaned.substring(0, partialMetadata);
  }

  // Find ACTION: and truncate there (including partial ACTION during streaming)
  const actionIndex = cleaned.indexOf('ACTION:');
  if (actionIndex !== -1) {
    cleaned = cleaned.substring(0, actionIndex);
  }

  // Handle partial ACTION (when streaming cuts off mid-word)
  const partialActionPatterns = ['ACTIO', 'ACTI', 'ACT'];
  for (const pattern of partialActionPatterns) {
    // Only match at the end of the string (streaming partial)
    if (cleaned.endsWith(pattern) || cleaned.endsWith('\n' + pattern) || cleaned.endsWith(' ' + pattern)) {
      const patternIndex = cleaned.lastIndexOf(pattern);
      if (patternIndex !== -1) {
        cleaned = cleaned.substring(0, patternIndex);
        break;
      }
    }
  }

  // Clean up trailing whitespace and newlines
  cleaned = cleaned.trimEnd();

  // Remove excessive newlines (more than 2 consecutive)
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

  // Also remove leading excessive whitespace/newlines (keep at most 1 leading newline)
  cleaned = cleaned.replace(/^\n+/, '');

  return cleaned;
}

/**
 * Check if text chunk contains start of METADATA marker
 */
export function containsMetadataMarker(text: string): boolean {
  return text.includes('<!-- METADATA') || text.includes('<!-- META');
}

/**
 * Extract JSON from a code block following a specific metadata marker
 */
export function extractJsonFromCodeBlock(content: string, metadataType: string): unknown | null {
  try {
    // Find the metadata marker
    const metadataPattern = new RegExp(
      `<!--\\s*METADATA:\\s*\\{"type":"${metadataType}"\\}\\s*-->`,
      'i'
    );
    const metadataMatch = metadataPattern.exec(content);

    if (!metadataMatch) {
      return null;
    }

    // Find the next JSON block after this metadata
    const metadataPos = metadataMatch.index;
    const afterMetadata = content.substring(metadataPos + metadataMatch[0].length);

    // Look for the JSON code block
    const jsonStartPattern = /```json\s*\n/;
    const jsonStartMatch = jsonStartPattern.exec(afterMetadata);

    if (!jsonStartMatch) {
      return null;
    }

    // Start position of actual JSON content
    const jsonStartPos = jsonStartMatch.index + jsonStartMatch[0].length;
    const remainingContent = afterMetadata.substring(jsonStartPos);

    // Use bracket/brace matching to find the end of JSON
    let braceCount = 0;
    let bracketCount = 0;
    let inString = false;
    let escapeNext = false;
    let jsonEndPos = -1;

    for (let i = 0; i < remainingContent.length; i++) {
      const char = remainingContent[i];

      if (escapeNext) {
        escapeNext = false;
        continue;
      }

      if (char === '\\' && inString) {
        escapeNext = true;
        continue;
      }

      if (char === '"') {
        inString = !inString;
        continue;
      }

      if (!inString) {
        if (char === '{') braceCount++;
        if (char === '}') braceCount--;
        if (char === '[') bracketCount++;
        if (char === ']') bracketCount--;

        if (braceCount === 0 && bracketCount === 0 && (char === '}' || char === ']')) {
          jsonEndPos = i + 1;
          break;
        }
      }
    }

    if (jsonEndPos === -1) {
      // Fallback: look for closing ```
      const fallbackPattern = /```(?:\s*\n|$)/;
      const fallbackMatch = fallbackPattern.exec(remainingContent);
      if (fallbackMatch) {
        jsonEndPos = fallbackMatch.index;
      } else {
        return null;
      }
    }

    const jsonContent = remainingContent.substring(0, jsonEndPos).trim();

    try {
      const parsedJson = JSON.parse(jsonContent);

      // For objectType and demoObjects, arrays are valid
      if (Array.isArray(parsedJson) && parsedJson.length > 0 &&
        metadataType !== 'objectType' && metadataType !== 'demoObjects') {
        return parsedJson[0];
      }

      return parsedJson;
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

/**
 * Extract object types and demo objects from AI response content
 */
export function extractContentFromResponse(content: string): ExtractedContent {
  const hasAddContent = content.includes('<!-- METADATA: {"type":"addContent"} -->');

  // Extract object types
  const directObjectTypes = extractJsonFromCodeBlock(content, 'objectType');
  let objectTypes: Record<string, unknown>[] = [];
  if (directObjectTypes) {
    objectTypes = Array.isArray(directObjectTypes) ? directObjectTypes : [directObjectTypes];
  }

  // Extract demo objects
  const directDemoObjects = extractJsonFromCodeBlock(content, 'demoObjects');
  let demoObjects: Record<string, unknown>[] = [];
  if (directDemoObjects) {
    demoObjects = Array.isArray(directDemoObjects) ? directDemoObjects : [directDemoObjects];
  }

  return {
    objectTypes,
    demoObjects,
    hasAddContent,
  };
}

/**
 * Extract JSON blocks tagged with a specific type from AI response text
 * Looks for ```json:type ... ``` patterns
 */
export function extractJsonBlocks(text: string, type: string): string[] {
  const blocks: string[] = [];
  const regex = new RegExp('```json:' + type + '\\s*\\n([\\s\\S]*?)```', 'g');
  let match;
  while ((match = regex.exec(text)) !== null) {
    blocks.push(match[1].trim());
  }
  return blocks;
}

/**
 * Parse code blocks from AI response to extract files
 * Matches the backend's parseCodeBlocks logic from githubDeployment.service.js
 */
export function parseCodeBlocks(aiResponse: string): Record<string, string> {
  const files: Record<string, string> = {};

  // Regex to match code blocks with file path comments
  // Format: ```language\n// path/to/file.ext\n[content]\n```
  const regex = /```(?:\w+)?\n\/\/\s*([^\n]+)\n([\s\S]*?)```/g;

  let match;
  while ((match = regex.exec(aiResponse)) !== null) {
    const filePath = match[1].trim();
    const content = match[2].trim();

    // Skip empty files or invalid paths
    if (!filePath || !content || filePath.length < 2) {
      continue;
    }

    // Clean the file path (remove any leading/trailing whitespace or slashes)
    const cleanPath = filePath.replace(/^\/+/, '').trim();

    if (cleanPath && content) {
      files[cleanPath] = content;
    }
  }

  return files;
}

/**
 * Extract app metadata from AI response (FRAMEWORK and APP_NAME markers)
 */
export function extractAppMetadata(aiResponse: string): { framework: string | null; appName: string | null } {
  const frameworkMatch = aiResponse.match(/<!--\s*FRAMEWORK:\s*(\w+)\s*-->/i);
  // APP_NAME can have spaces, so match anything until the closing -->
  const appNameMatch = aiResponse.match(/<!--\s*APP_NAME:\s*([^>]+?)\s*-->/i);

  return {
    framework: frameworkMatch ? frameworkMatch[1].toLowerCase() : null,
    appName: appNameMatch ? appNameMatch[1].trim() : null,
  };
}
