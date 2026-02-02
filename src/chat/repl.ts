/**
 * Chat REPL
 * Interactive AI chat mode using Cosmic SDK
 */

import * as readline from 'readline';
import * as crypto from 'crypto';
import chalk from 'chalk';
import { isAuthenticated, getDefaultModel, getCurrentBucketSlug, setCredentials } from '../config/store.js';
import { formatContext } from '../config/context.js';
import { getSDKClient, hasSDKClient, clearSDKClient, getBucketKeys, getApiEnv } from '../api/sdk.js';
import {
  getBucket,
  listAgents,
  getAgent,
  runAgent,
  createAgent,
  updateAgent,
  deleteAgent,
  listWorkflows,
  getWorkflow,
  executeWorkflow,
  createWorkflow,
  updateWorkflow,
  deleteWorkflow,
  listObjectTypes,
  listRepositories,
  deployRepository,
  deployAIApp,
  getLatestDeploymentStatus,
  getDeploymentLogs,
  streamingRepositoryUpdate,
  createObjectType,
  createObjectWithMetafields,
  type DeploymentLog,
} from '../api/dashboard.js';
import * as api from '../api/dashboard.js';
import * as display from '../utils/display.js';
import * as spinner from '../utils/spinner.js';
import { select } from '../utils/prompts.js';

// Fallback images when Unsplash fails
const FALLBACK_IMAGES = [
  'https://imgix.cosmicjs.com/6bcb64d0-cd77-11ec-bb72-e143ea7952eb-placeholder-1.jpg',
  'https://imgix.cosmicjs.com/6bcbba00-cd77-11ec-bb72-e143ea7952eb-placeholder-2.jpg',
  'https://imgix.cosmicjs.com/6bcc0820-cd77-11ec-bb72-e143ea7952eb-placeholder-3.jpg',
];

/**
 * Get a random fallback image
 */
function getRandomFallbackImage(): string {
  return FALLBACK_IMAGES[Math.floor(Math.random() * FALLBACK_IMAGES.length)];
}

/**
 * Generate a UUID for metafield IDs
 */
function generateUUID(): string {
  return crypto.randomUUID();
}

/**
 * Recursively add IDs to metafields
 */
function addIdsToMetafields(metafields: Record<string, unknown>[]): Record<string, unknown>[] {
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
 * Clean response text for display - removes METADATA markers and JSON code blocks
 */
function cleanResponseForDisplay(text: string): string {
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

  // Clean up trailing whitespace and newlines
  cleaned = cleaned.trimEnd();

  // Remove excessive newlines (more than 2 consecutive)
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

  return cleaned;
}

/**
 * Check if text chunk contains start of METADATA marker
 */
function containsMetadataMarker(text: string): boolean {
  return text.includes('<!-- METADATA') || text.includes('<!-- META');
}

// ============================================================================
// Content Extraction from AI Response (for "Add Content" feature)
// ============================================================================

interface ExtractedContent {
  objectTypes: Record<string, unknown>[];
  demoObjects: Record<string, unknown>[];
  hasAddContent: boolean;
}

/**
 * Extract JSON from a code block following a specific metadata marker
 */
function extractJsonFromCodeBlock(content: string, metadataType: string): unknown | null {
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
function extractContentFromResponse(content: string): ExtractedContent {
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
 * Create a slug from a title
 */
function createSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Install content (object types and demo objects) to Cosmic
 */
async function installContentToCosmic(
  sdk: ReturnType<typeof getSDKClient>,
  extractedContent: ExtractedContent,
  rl: readline.Interface
): Promise<{ added: boolean; nextAction: 'build' | 'content' | 'exit' | null }> {
  if (!sdk) return { added: false, nextAction: null };

  const { objectTypes, demoObjects } = extractedContent;
  const totalTypes = objectTypes.length;
  const totalObjects = demoObjects.length;

  if (totalTypes === 0 && totalObjects === 0) {
    return { added: false, nextAction: null };
  }

  console.log();
  console.log(chalk.cyan('  📦 Content detected in AI response:'));
  if (totalTypes > 0) {
    console.log(chalk.dim(`     ${totalTypes} object type${totalTypes !== 1 ? 's' : ''}`));
    for (const type of objectTypes) {
      console.log(chalk.dim(`       • ${(type as { title?: string }).title || (type as { slug?: string }).slug || 'Unnamed'}`));
    }
  }
  if (totalObjects > 0) {
    console.log(chalk.dim(`     ${totalObjects} content object${totalObjects !== 1 ? 's' : ''}`));
    for (const obj of demoObjects) {
      console.log(chalk.dim(`       • ${(obj as { title?: string }).title || 'Unnamed'}`));
    }
  }
  console.log();

  // Prompt user (default to yes on Enter)
  const answer = await new Promise<string>((resolve) => {
    rl.question(chalk.yellow('  Would you like to add this content to Cosmic? (Y/n) '), resolve);
  });

  if (answer.toLowerCase() === 'n' || answer.toLowerCase() === 'no') {
    console.log(chalk.dim('  Skipped content installation.'));
    return { added: false, nextAction: null };
  }

  console.log();
  spinner.start('Adding content to Cosmic...');

  // Get bucket slug for DAPI calls
  const bucketSlug = getCurrentBucketSlug();
  if (!bucketSlug) {
    console.log(chalk.red('  ✗ No bucket selected'));
    return { added: false, nextAction: null };
  }

  try {
    // Add object types first using DAPI (like the dashboard does)
    let typesAdded = 0;
    let typesSkipped = 0;
    const typeErrors: string[] = [];

    for (const type of objectTypes) {
      try {
        // Add IDs to metafields
        const typeWithIds = { ...type } as Record<string, unknown>;
        if (Array.isArray(typeWithIds.metafields)) {
          typeWithIds.metafields = addIdsToMetafields(
            typeWithIds.metafields as Record<string, unknown>[]
          );
        }

        spinner.update(`Adding object type "${(type as { title?: string }).title}"...`);

        // Use DAPI endpoint like the dashboard
        await createObjectType(bucketSlug, typeWithIds as Parameters<typeof createObjectType>[1]);
        typesAdded++;
      } catch (err) {
        const errorMsg = (err as Error).message;
        // Check if type already exists
        if (errorMsg.includes('already exists') || errorMsg.includes('duplicate') || errorMsg.includes('Object Type slug is already used')) {
          typesSkipped++;
        } else {
          typeErrors.push(`${(type as { title?: string }).title || 'unknown'}: ${errorMsg}`);
        }
      }
    }

    // Add demo objects using DAPI (like the dashboard does)
    let objectsAdded = 0;
    let objectsSkipped = 0;
    const objectErrors: string[] = [];

    for (const obj of demoObjects) {
      try {
        const objTyped = obj as {
          title?: string;
          slug?: string;
          type?: string;
          content?: string;
          status?: string;
          thumbnail?: string;
          locale?: string;
          metafields?: Record<string, unknown>[];
          metadata?: Record<string, unknown>;
        };

        // Format object for DAPI (matching dashboard format)
        const insertPayload: {
          title: string;
          slug: string;
          type: string;
          content?: string;
          status?: string;
          thumbnail?: string;
          locale?: string;
          metafields?: Array<{
            id?: string;
            title?: string;
            key: string;
            type: string;
            value?: unknown;
            required?: boolean;
          }>;
        } = {
          title: objTyped.title || 'Untitled',
          slug: objTyped.slug || createSlug(objTyped.title || 'untitled'),
          type: objTyped.type || 'objects',
          content: objTyped.content || '',
          status: objTyped.status || 'published',
          locale: objTyped.locale || '',
        };

        if (objTyped.thumbnail) {
          // Handle Unsplash URLs
          if (objTyped.thumbnail.includes('images.unsplash.com')) {
            spinner.update(`Uploading image for "${objTyped.title}"...`);
            const uploaded = await uploadUnsplashImage(objTyped.thumbnail, sdk);
            if (uploaded) {
              insertPayload.thumbnail = uploaded;
            }
          } else if (objTyped.thumbnail.includes('imgix.cosmicjs.com')) {
            insertPayload.thumbnail = objTyped.thumbnail.replace('https://imgix.cosmicjs.com/', '');
          } else {
            insertPayload.thumbnail = objTyped.thumbnail;
          }
        }

        if (Array.isArray(objTyped.metafields)) {
          // Add IDs to metafields
          const metafieldsWithIds = addIdsToMetafields(objTyped.metafields);

          // Process metafield images (upload Unsplash/external images to Cosmic)
          const processedMetafields = await processMetafieldImages(metafieldsWithIds, sdk);

          // Format for API
          insertPayload.metafields = processedMetafields.map(mf => {
            const metafield = mf as Record<string, unknown>;
            return {
              id: metafield.id as string,
              title: metafield.title as string || (metafield.key as string).charAt(0).toUpperCase() + (metafield.key as string).slice(1).replace(/_/g, ' '),
              key: metafield.key as string,
              type: metafield.type as string,
              value: metafield.value,
              required: metafield.required as boolean,
            };
          });
        } else if (objTyped.metadata && typeof objTyped.metadata === 'object') {
          // Handle metadata object format (convert to metafields array)
          const metafieldsFromMetadata: Record<string, unknown>[] = [];

          for (const [key, value] of Object.entries(objTyped.metadata as Record<string, unknown>)) {
            // Determine field type based on key name and value
            let fieldType = 'text';
            if (key.includes('image') || key.includes('photo') || key.includes('thumbnail') || key.includes('featured')) {
              fieldType = 'file';
            } else if (key.includes('content') || key.includes('body') || key.includes('description')) {
              fieldType = 'html-textarea';
            } else if (key.includes('date')) {
              fieldType = 'date';
            } else if (typeof value === 'boolean') {
              fieldType = 'switch';
            }

            metafieldsFromMetadata.push({
              key,
              type: fieldType,
              title: key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' '),
              value,
              required: false,
            });
          }

          // Add IDs and process images
          const metafieldsWithIds = addIdsToMetafields(metafieldsFromMetadata);
          const processedMetafields = await processMetafieldImages(metafieldsWithIds, sdk);

          // Format for API
          insertPayload.metafields = processedMetafields.map(mf => {
            const metafield = mf as Record<string, unknown>;
            return {
              id: metafield.id as string,
              title: metafield.title as string || (metafield.key as string).charAt(0).toUpperCase() + (metafield.key as string).slice(1).replace(/_/g, ' '),
              key: metafield.key as string,
              type: metafield.type as string,
              value: metafield.value,
              required: metafield.required as boolean,
            };
          });
        }

        spinner.update(`Adding "${objTyped.title}"...`);

        // Use DAPI endpoint like the dashboard
        await createObjectWithMetafields(bucketSlug, insertPayload);
        objectsAdded++;
      } catch (err) {
        const errorMsg = (err as Error).message;
        // Check if object already exists
        if (errorMsg.includes('already exists') || errorMsg.includes('duplicate')) {
          objectsSkipped++;
        } else {
          objectErrors.push(`${(obj as { title?: string }).title || 'unknown'}: ${errorMsg}`);
        }
      }
    }

    spinner.stop();

    // Show results
    if (typesAdded > 0 || objectsAdded > 0) {
      console.log(chalk.green(`  ✓ Added ${typesAdded} object type${typesAdded !== 1 ? 's' : ''} and ${objectsAdded} content object${objectsAdded !== 1 ? 's' : ''}`));
    }

    if (typesSkipped > 0 || objectsSkipped > 0) {
      console.log(chalk.dim(`  ℹ Skipped ${typesSkipped} existing type${typesSkipped !== 1 ? 's' : ''} and ${objectsSkipped} existing object${objectsSkipped !== 1 ? 's' : ''}`));
    }

    // Show errors if any
    if (typeErrors.length > 0) {
      console.log(chalk.yellow(`  ⚠ Failed to add ${typeErrors.length} object type${typeErrors.length !== 1 ? 's' : ''}:`));
      for (const err of typeErrors) {
        console.log(chalk.dim(`     • ${err}`));
      }
    }

    if (objectErrors.length > 0) {
      console.log(chalk.yellow(`  ⚠ Failed to add ${objectErrors.length} content object${objectErrors.length !== 1 ? 's' : ''}:`));
      for (const err of objectErrors) {
        console.log(chalk.dim(`     • ${err}`));
      }
    }

    if (typesAdded === 0 && objectsAdded === 0 && typeErrors.length === 0 && objectErrors.length === 0) {
      console.log(chalk.dim('  ℹ All content already exists in Cosmic.'));
    }

    // Show next steps prompt if content was added
    if (typesAdded > 0 || objectsAdded > 0) {
      console.log();

      const nextAction = await select<'build' | 'content' | 'exit'>({
        message: 'What would you like to do next?',
        choices: [
          { name: 'build', message: 'Build and deploy an app' },
          { name: 'content', message: 'Add more content' },
          { name: 'exit', message: 'Exit' },
        ],
      });

      return { added: true, nextAction };
    }

    return { added: typesAdded > 0 || objectsAdded > 0, nextAction: null };
  } catch (err) {
    spinner.stop();
    console.log(chalk.red(`  ✗ Failed to add content: ${(err as Error).message}`));
    return { added: false, nextAction: null };
  }
}

/**
 * Upload an image from URL (Unsplash) to Cosmic media library
 */
async function uploadUnsplashImage(
  imageUrl: string,
  sdk: ReturnType<typeof getSDKClient>
): Promise<string | null> {
  if (!sdk) return null;

  try {
    // Fetch the image
    const response = await fetch(imageUrl);
    if (!response.ok) {
      console.log(chalk.dim(`  Failed to fetch image: ${imageUrl}`));
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Generate filename from URL
    const urlObj = new URL(imageUrl);
    const pathParts = urlObj.pathname.split('/');
    const filenameBase = pathParts[pathParts.length - 1] || `image-${Date.now()}`;
    const filename = `${filenameBase}-${Date.now()}.jpg`;

    // Upload to Cosmic
    const result = await sdk.media.insertOne({
      media: buffer,
      filename,
      contentType: 'image/jpeg',
    });

    const mediaResult = result as { media?: { name?: string } };
    return mediaResult.media?.name || null;
  } catch (error) {
    console.log(chalk.dim(`  Error uploading image: ${(error as Error).message}`));
    return null;
  }
}

/**
 * Extract image URL from metafield value (handles various formats)
 */
function extractImageUrl(value: unknown): string | null {
  if (!value) return null;

  // Direct URL string
  if (typeof value === 'string') {
    if (value.includes('images.unsplash.com') ||
      value.includes('imgix.cosmicjs.com') ||
      value.includes('cdn.cosmicjs.com')) {
      return value;
    }
    return null;
  }

  // Object with url or imgix_url property
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const url = obj.url || obj.imgix_url;
    if (typeof url === 'string') {
      return url;
    }
  }

  return null;
}

/**
 * Process metafield values and upload any images to Cosmic
 */
async function processMetafieldImages(
  metafields: Record<string, unknown>[],
  sdk: ReturnType<typeof getSDKClient>
): Promise<Record<string, unknown>[]> {
  if (!sdk) return metafields;

  const processedMetafields = [];

  for (const mf of metafields) {
    const metafield = { ...mf };
    const fieldType = metafield.type as string;
    const fieldKey = metafield.key as string;

    // Handle 'file' type metafields (single image)
    if (fieldType === 'file' ||
      fieldKey?.includes('image') ||
      fieldKey?.includes('photo') ||
      fieldKey?.includes('thumbnail') ||
      fieldKey?.includes('featured')) {
      const imageUrl = extractImageUrl(metafield.value);

      if (imageUrl) {
        // Check if it's an external URL that needs uploading
        if (imageUrl.includes('images.unsplash.com')) {
          spinner.update(`Uploading image for "${fieldKey}"...`);
          const uploadedName = await uploadUnsplashImage(imageUrl, sdk);
          if (uploadedName) {
            metafield.value = uploadedName;
          } else {
            // Clear the value if upload failed
            metafield.value = '';
          }
        } else if (imageUrl.includes('imgix.cosmicjs.com')) {
          // Extract just the filename from imgix URL
          metafield.value = imageUrl.replace('https://imgix.cosmicjs.com/', '');
        } else if (imageUrl.includes('cdn.cosmicjs.com')) {
          // Handle cdn URLs - they might have double URLs
          // e.g., "https://cdn.cosmicjs.com/https://images.unsplash.com/..."
          const match = imageUrl.match(/https:\/\/cdn\.cosmicjs\.com\/(.+)/);
          if (match) {
            const innerUrl = match[1];
            if (innerUrl.startsWith('https://images.unsplash.com')) {
              spinner.update(`Uploading image for "${fieldKey}"...`);
              const uploadedName = await uploadUnsplashImage(innerUrl, sdk);
              if (uploadedName) {
                metafield.value = uploadedName;
              } else {
                metafield.value = '';
              }
            } else {
              metafield.value = innerUrl;
            }
          }
        }
      }
    }

    // Handle 'files' type metafields (multiple images)
    else if (fieldType === 'files' && Array.isArray(metafield.value)) {
      const processedValues: string[] = [];

      for (const item of metafield.value as unknown[]) {
        const imageUrl = extractImageUrl(item);

        if (imageUrl) {
          if (imageUrl.includes('images.unsplash.com')) {
            spinner.update(`Uploading image for "${fieldKey}"...`);
            const uploadedName = await uploadUnsplashImage(imageUrl, sdk);
            if (uploadedName) {
              processedValues.push(uploadedName);
            }
          } else if (imageUrl.includes('imgix.cosmicjs.com')) {
            processedValues.push(imageUrl.replace('https://imgix.cosmicjs.com/', ''));
          } else if (typeof item === 'string') {
            processedValues.push(item);
          }
        } else if (typeof item === 'string') {
          processedValues.push(item);
        }
      }

      metafield.value = processedValues;
    }

    processedMetafields.push(metafield);
  }

  return processedMetafields;
}

/**
 * Detect if AI response mentions Cosmic content that needs to be created
 * (without including the metadata markers)
 */
function detectCosmicContentMention(content: string): boolean {
  // Check if already has metadata markers - if so, return false since it will be handled elsewhere
  if (content.includes('<!-- METADATA: {"type":"addContent"} -->') ||
    content.includes('<!-- METADATA: {"type":"objectType"} -->') ||
    content.includes('<!-- METADATA: {"type":"demoObjects"} -->')) {
    return false;
  }

  // Patterns that indicate the AI is talking about creating Cosmic content
  const cosmicContentPatterns = [
    /create\s+(?:an?\s+)?(?:object\s+type|content\s+type)/i,
    /add\s+(?:an?\s+)?(?:object\s+type|content\s+type)/i,
    /cosmic\s+(?:cms|dashboard)\s+(?:object|content)/i,
    /\bobject\s+type\s+(?:called|named|for)/i,
    /fetch(?:es|ing)?\s+(?:from\s+)?cosmic/i,
    /get[A-Z][a-zA-Z]+Page\s*\(\)/i, // getAboutPage(), getHomePage(), etc.
    /\bmetafields?\s+(?:for|with|including)/i,
    /content\s+from\s+cosmic/i,
    /powered\s+by\s+cosmic/i,
    /\bcms\s+content\b/i,
    /create\s+this\s+object\s+type/i,
    /need\s+to\s+create\s+(?:the\s+)?(?:object|content)/i,
  ];

  // Check if content matches any pattern
  return cosmicContentPatterns.some(pattern => pattern.test(content));
}

/**
 * Offer to generate and add content to Cosmic after a repo update
 */
async function offerContentGeneration(
  sdk: ReturnType<typeof getSDKClient>,
  aiResponse: string,
  conversationHistory: Array<{ role: string; content: string }>,
  model: string,
  bucketSlug: string,
  rl: readline.Interface
): Promise<boolean> {
  console.log();
  console.log(chalk.cyan('  💡 It looks like this code expects content from Cosmic CMS.'));

  // Prompt user (default to yes on Enter)
  const answer = await new Promise<string>((resolve) => {
    rl.question(chalk.yellow('  Would you like to generate and add the content? (Y/n) '), resolve);
  });

  if (answer.toLowerCase() === 'n' || answer.toLowerCase() === 'no') {
    console.log(chalk.dim('  Skipped content generation.'));
    console.log(chalk.dim('  Tip: Type "add content" anytime to generate content for your code.'));
    return false;
  }

  console.log();
  spinner.start('Generating content for Cosmic CMS...');

  try {
    // Build context from conversation history
    const contextMessages = conversationHistory.slice(-4).map((msg) => ({
      role: msg.role as 'user' | 'assistant',
      content: [{ type: 'text' as const, text: msg.content }],
    }));

    // Add the content generation request
    contextMessages.push({
      role: 'user',
      content: [{
        type: 'text', text: `Based on the code changes you just made, generate the Cosmic CMS object types and demo content that the code expects.

IMPORTANT: Generate the content using these EXACT metadata markers:

<!-- METADATA: {"type":"addContent"} -->
<!-- METADATA: {"type":"objectType"} -->
\`\`\`json
[{ "title": "...", "slug": "...", "emoji": "...", "singleton": true/false, "metafields": [{ "title": "...", "key": "...", "type": "...", "required": true/false }] }]
\`\`\`

<!-- METADATA: {"type":"demoObjects"} -->
\`\`\`json
[{ "type": "slug-of-object-type", "title": "...", "status": "published", "thumbnail": "https://images.unsplash.com/...", "metafields": [{ "key": "...", "type": "...", "value": "..." }] }]
\`\`\`

Generate complete, realistic content that matches what the code expects. Include:
1. All object types referenced in the code
2. Sample demo content with real values
3. Appropriate Unsplash images for thumbnails` }],
    });

    // Use the streaming chat API
    let fullResponse = '';
    await api.streamingChat({
      messages: contextMessages,
      bucketSlug,
      model,
      maxTokens: 16000,
      viewMode: 'content-model',
      onChunk: (chunk) => {
        fullResponse += chunk;
      },
    });

    spinner.stop();

    // Extract and install the content
    const extractedContent = extractContentFromResponse(fullResponse);
    if (extractedContent.objectTypes.length > 0 || extractedContent.demoObjects.length > 0) {
      // Override hasAddContent since we know we want to add
      extractedContent.hasAddContent = true;
      const result = await installContentToCosmic(sdk, extractedContent, rl);
      return result.added;
    } else {
      console.log(chalk.yellow('  Could not generate content metadata.'));
      console.log(chalk.dim('  Tip: Try "add content: [description]" to be more specific.'));
      return false;
    }
  } catch (err) {
    spinner.stop();
    console.log(chalk.red(`  Error generating content: ${(err as Error).message}`));
    return false;
  }
}

/**
 * Format elapsed time in human-readable format
 */
function formatElapsedTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

/**
 * Poll for deployment status until ready, error, or timeout
 */
async function pollDeploymentStatus(
  bucketSlug: string,
  vercelProjectId: string,
  repositoryUrl?: string
): Promise<{ success: boolean; url?: string; error?: string; deploymentId?: string; logs?: DeploymentLog[] }> {
  const POLL_INTERVAL = 5000; // 5 seconds
  const TIMEOUT = 300000; // 5 minutes
  const startTime = Date.now();

  console.log();
  console.log(chalk.yellow('  Waiting for Vercel deployment...'));

  let lastStatus = '';
  let dotCount = 0;

  const verbose = process.env.COSMIC_DEBUG === '1' || process.env.COSMIC_DEBUG === '2';

  while (Date.now() - startTime < TIMEOUT) {
    try {
      const response = await getLatestDeploymentStatus(bucketSlug, vercelProjectId);

      if (verbose) {
        console.log(`\n[DEBUG] Deployment response: ${JSON.stringify(response, null, 2)}`);
      }

      if (!response.success || !response.deployment) {
        // No deployment found yet, keep waiting
        const elapsed = formatElapsedTime(Date.now() - startTime);
        dotCount = (dotCount + 1) % 4;
        const dots = '.'.repeat(dotCount + 1);
        process.stdout.write(`\r  ${chalk.cyan('Waiting')}${dots.padEnd(4)} ${chalk.dim(`(${elapsed})`)}`);
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
        continue;
      }

      // Handle different possible status field names from the API
      const deployment = response.deployment;
      const status = deployment.status || (deployment as Record<string, unknown>).readyState || (deployment as Record<string, unknown>).state;
      const url = deployment.url;
      const elapsed = formatElapsedTime(Date.now() - startTime);

      // Clear the previous line and show new status
      if (status !== lastStatus) {
        lastStatus = status;
        dotCount = 0;
      }

      // Normalize status to uppercase for comparison
      const normalizedStatus = String(status || '').toUpperCase();

      // Show status based on deployment status
      if (normalizedStatus === 'READY') {
        // Clear the line first
        process.stdout.write('\r' + ' '.repeat(50) + '\r');
        console.log(chalk.green(`  ✓ Deployment complete!`));
        console.log();
        const liveUrl = url?.startsWith('http') ? url : `https://${url}`;
        console.log(chalk.bold.green(`  🌐 Live at: ${liveUrl}`));

        // Save for "open" command
        lastDeploymentUrl = liveUrl;

        console.log();
        console.log(chalk.dim('  Type "open" to view in browser, or continue chatting.'));
        console.log();

        return { success: true, url: liveUrl };
      }

      if (normalizedStatus === 'ERROR') {
        process.stdout.write('\r' + ' '.repeat(50) + '\r');
        const errorMsg = response.deployment.meta?.error?.message || 'Build failed';
        console.log(chalk.red(`  ✗ Deployment failed: ${errorMsg}`));
        console.log();

        // Fetch and display build logs
        const deploymentId = response.deployment.deploymentId;
        let fetchedLogs: DeploymentLog[] = [];

        if (deploymentId) {
          console.log(chalk.dim('  Fetching build logs...'));
          const logsResponse = await getDeploymentLogs(deploymentId);

          if (logsResponse.success && logsResponse.logs && logsResponse.logs.length > 0) {
            fetchedLogs = logsResponse.logs;
            console.log();
            console.log(chalk.bold.red('  Build Logs:'));
            console.log(chalk.dim('  ' + '─'.repeat(60)));

            // Filter to show only errors and important messages (last 30 lines)
            const relevantLogs = logsResponse.logs
              .filter(log => log.type === 'stderr' || log.text.toLowerCase().includes('error'))
              .slice(-30);

            if (relevantLogs.length > 0) {
              for (const log of relevantLogs) {
                const logText = log.text.trim();
                if (logText) {
                  // Color code based on log type
                  const color = log.type === 'stderr' ? chalk.red : chalk.yellow;
                  // Indent and wrap long lines
                  const lines = logText.split('\n');
                  for (const line of lines) {
                    console.log(color(`  ${line}`));
                  }
                }
              }
            } else {
              // If no error logs found, show the last few logs
              const lastLogs = logsResponse.logs.slice(-15);
              for (const log of lastLogs) {
                const logText = log.text.trim();
                if (logText) {
                  console.log(chalk.dim(`  ${logText}`));
                }
              }
            }

            console.log(chalk.dim('  ' + '─'.repeat(60)));
            console.log();
          }
        }

        return { success: false, error: errorMsg, deploymentId, logs: fetchedLogs };
      }

      if (normalizedStatus === 'CANCELED') {
        process.stdout.write('\r' + ' '.repeat(50) + '\r');
        console.log(chalk.yellow(`  ✗ Deployment was canceled`));
        console.log();
        return { success: false, error: 'Deployment canceled' };
      }

      // Still building, queued, or initializing
      dotCount = (dotCount + 1) % 4;
      const dots = '.'.repeat(dotCount + 1);
      let statusDisplay = status || 'Building';
      if (normalizedStatus === 'QUEUED') statusDisplay = 'Queued';
      else if (normalizedStatus === 'INITIALIZING') statusDisplay = 'Initializing';
      else if (normalizedStatus === 'BUILDING') statusDisplay = 'Building';

      process.stdout.write(`\r  ${chalk.cyan(statusDisplay)}${dots.padEnd(4)} ${chalk.dim(`(${elapsed})`)}`);

      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
    } catch (error) {
      // On error, continue polling (might be temporary)
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
    }
  }

  // Timeout reached
  process.stdout.write('\r' + ' '.repeat(50) + '\r');
  console.log(chalk.yellow(`  ⏱ Deployment is taking longer than expected.`));
  console.log(chalk.dim(`  Check status at: https://vercel.com/dashboard`));
  console.log();
  return { success: false, error: 'Timeout waiting for deployment' };
}

/**
 * Process Unsplash URLs in an object's metadata and thumbnail
 */
async function processUnsplashUrls(
  obj: Record<string, unknown>,
  sdk: ReturnType<typeof getSDKClient>,
  objectTypeMetafields: Record<string, unknown>[]
): Promise<void> {
  // Process thumbnail
  if (typeof obj.thumbnail === 'string' && obj.thumbnail.includes('images.unsplash.com')) {
    console.log(chalk.dim(`  Uploading thumbnail image...`));
    const mediaName = await uploadUnsplashImage(obj.thumbnail, sdk);
    if (mediaName) {
      obj.thumbnail = mediaName;
    } else {
      // Use fallback
      const fallback = getRandomFallbackImage();
      obj.thumbnail = fallback.replace('https://imgix.cosmicjs.com/', '');
    }
  }

  // Process metadata
  if (obj.metadata && typeof obj.metadata === 'object') {
    const metadata = obj.metadata as Record<string, unknown>;

    for (const [key, value] of Object.entries(metadata)) {
      // Find the metafield definition to check type
      const metafieldDef = objectTypeMetafields.find((m) => m.key === key);

      // Handle file type with Unsplash URL
      if (
        metafieldDef?.type === 'file' &&
        typeof value === 'string' &&
        value.includes('images.unsplash.com')
      ) {
        console.log(chalk.dim(`  Uploading ${key} image...`));
        const mediaName = await uploadUnsplashImage(value, sdk);
        if (mediaName) {
          metadata[key] = mediaName;
        } else {
          const fallback = getRandomFallbackImage();
          metadata[key] = fallback.replace('https://imgix.cosmicjs.com/', '');
        }
      }

      // Handle files type (array) with Unsplash URLs
      if (
        metafieldDef?.type === 'files' &&
        Array.isArray(value)
      ) {
        const processedFiles: string[] = [];
        for (const fileUrl of value) {
          if (typeof fileUrl === 'string' && fileUrl.includes('images.unsplash.com')) {
            console.log(chalk.dim(`  Uploading ${key} image...`));
            const mediaName = await uploadUnsplashImage(fileUrl, sdk);
            if (mediaName) {
              processedFiles.push(mediaName);
            } else {
              const fallback = getRandomFallbackImage();
              processedFiles.push(fallback.replace('https://imgix.cosmicjs.com/', ''));
            }
          } else {
            processedFiles.push(fileUrl as string);
          }
        }
        metadata[key] = processedFiles;
      }
    }
  }
}

/**
 * Parse code blocks from AI response to extract files
 * Matches the backend's parseCodeBlocks logic from githubDeployment.service.js
 */
function parseCodeBlocks(aiResponse: string): Record<string, string> {
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
function extractAppMetadata(aiResponse: string): { framework: string | null; appName: string | null } {
  const frameworkMatch = aiResponse.match(/<!--\s*FRAMEWORK:\s*(\w+)\s*-->/i);
  // APP_NAME can have spaces, so match anything until the closing -->
  const appNameMatch = aiResponse.match(/<!--\s*APP_NAME:\s*([^>]+?)\s*-->/i);

  return {
    framework: frameworkMatch ? frameworkMatch[1].toLowerCase() : null,
    appName: appNameMatch ? appNameMatch[1].trim() : null,
  };
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Context for AI chat - object types, links, etc.
 */
interface ChatContext {
  objectTypes?: string[];        // Object type slugs to include as context
  objectsLimit?: number;         // Max objects per type (default: 3)
  objectsDepth?: number;         // Object depth (default: 1)
  links?: string[];              // External URLs to crawl for context
}

interface ChatOptions {
  model?: string;
  initialPrompt?: string;  // Pre-loaded prompt to start the conversation
  buildMode?: boolean;     // Whether we're in app building mode (uses higher token limit)
  contentMode?: boolean;   // Whether we're in content creation/update mode
  repoMode?: boolean;      // Whether we're in repository update mode
  repoName?: string;       // Specific repository name to update
  repoBranch?: string;     // Branch to use in repo mode
  askMode?: boolean;       // Whether to run in ask/read-only mode (default: true)
  context?: ChatContext;   // Structured context (object types, links, etc.)
}

// Conversation history
let conversationHistory: ChatMessage[] = [];

// Build mode flag - when true, uses higher max_tokens for app generation
let isBuildMode = false;

// Content mode flag - when true, focused on content creation/updates
let isContentMode = false;

// Repo mode flag - when true, uses streamingRepositoryUpdate instead of regular chat
let isRepoMode = false;

// Ask mode flag - when true (default), AI only answers questions without actions
let isAskMode = true;

// Current chat context - object types, links, etc.
let chatContext: ChatContext = {};

// Fetched context data - actual content from URLs and objects
let fetchedContextData: {
  objects: Record<string, unknown>[];
  linkContents: { url: string; content: string }[];
} = { objects: [], linkContents: [] };

// Current repository info for repo mode
let currentRepo: {
  id: string;
  owner: string;
  name: string;
  branch: string;
} | null = null;

// Last successful deployment URL (for "open" command)
let lastDeploymentUrl: string | null = null;

/**
 * Fetch text content from a URL
 */
async function fetchUrlContent(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; CosmicCLI/1.0)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    if (!response.ok) {
      return null;
    }

    const html = await response.text();

    // Extract text content from HTML (simple extraction)
    // Remove script and style tags
    let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    // Remove HTML tags
    text = text.replace(/<[^>]+>/g, ' ');
    // Decode HTML entities
    text = text.replace(/&nbsp;/g, ' ');
    text = text.replace(/&amp;/g, '&');
    text = text.replace(/&lt;/g, '<');
    text = text.replace(/&gt;/g, '>');
    text = text.replace(/&quot;/g, '"');
    // Clean up whitespace
    text = text.replace(/\s+/g, ' ').trim();

    // Truncate if too long (max ~8000 chars per URL)
    if (text.length > 8000) {
      text = text.substring(0, 8000) + '...';
    }

    return text;
  } catch (error) {
    console.error(chalk.dim(`  Failed to fetch ${url}: ${(error as Error).message}`));
    return null;
  }
}

/**
 * Fetch context data (objects and URL contents)
 */
async function fetchContextData(bucketSlug: string): Promise<void> {
  fetchedContextData = { objects: [], linkContents: [] };

  const isDebug = process.env.COSMIC_DEBUG === '1' || process.env.COSMIC_DEBUG === '2';

  const hasContext = (chatContext.objectTypes && chatContext.objectTypes.length > 0) ||
    (chatContext.links && chatContext.links.length > 0);

  if (!hasContext) {
    if (isDebug) {
      console.log(chalk.dim('[DEBUG] fetchContextData: No context to fetch'));
    }
    return;
  }

  spinner.start('Fetching context data...');

  try {
    // Fetch objects for specified types
    if (chatContext.objectTypes && chatContext.objectTypes.length > 0) {
      const limit = chatContext.objectsLimit || 5;

      for (const typeSlug of chatContext.objectTypes) {
        try {
          if (isDebug) {
            console.log(chalk.dim(`\n[DEBUG] Fetching objects for type: ${typeSlug}, bucket: ${bucketSlug}`));
          }

          const { objects } = await api.listObjects(bucketSlug, {
            type: typeSlug,
            status: 'any',
            limit,
          });

          if (isDebug) {
            console.log(chalk.dim(`[DEBUG] Got ${objects.length} objects for type: ${typeSlug}`));
          }

          fetchedContextData.objects.push(...objects.map(obj => ({
            id: obj.id,
            title: obj.title,
            slug: obj.slug,
            type: obj.type,
            status: obj.status,
            content: obj.content,
            metadata: obj.metadata,
          })));
        } catch (err) {
          // Type might not exist
          if (isDebug) {
            console.log(chalk.dim(`[DEBUG] Failed to fetch type ${typeSlug}: ${(err as Error).message}`));
          }
        }
      }
    }

    // Fetch content from URLs
    if (chatContext.links && chatContext.links.length > 0) {
      for (const url of chatContext.links) {
        if (isDebug) {
          console.log(chalk.dim(`\n[DEBUG] Fetching URL: ${url}`));
        }

        const content = await fetchUrlContent(url);

        if (content) {
          if (isDebug) {
            console.log(chalk.dim(`[DEBUG] Got ${content.length} chars from URL`));
            console.log(chalk.dim(`[DEBUG] Content preview: ${content.substring(0, 200)}...`));
          }
          fetchedContextData.linkContents.push({ url, content });
        } else if (isDebug) {
          console.log(chalk.dim('[DEBUG] No content returned from URL'));
        }
      }
    }

    const objectCount = fetchedContextData.objects.length;
    const linkCount = fetchedContextData.linkContents.length;

    if (objectCount > 0 || linkCount > 0) {
      spinner.succeed(`Loaded ${objectCount} objects and ${linkCount} URLs`);
    } else {
      spinner.stop();
    }
  } catch (error) {
    spinner.fail('Failed to fetch context data');
    if (isDebug) {
      console.log(chalk.dim(`[DEBUG] fetchContextData error: ${(error as Error).message}`));
    }
  }
}

/**
 * Try to fetch and store bucket keys from the Dashboard API
 */
async function tryFetchBucketKeys(bucketSlug: string): Promise<boolean> {
  try {
    spinner.start('Fetching bucket API keys...');
    const bucket = await getBucket(bucketSlug);
    const bucketAny = bucket as Record<string, unknown>;
    const apiAccess = bucketAny.api_access as Record<string, string> | undefined;

    if (apiAccess && apiAccess.read_key && apiAccess.write_key) {
      setCredentials({
        bucketSlug,
        readKey: apiAccess.read_key,
        writeKey: apiAccess.write_key,
      });
      clearSDKClient();
      spinner.succeed('API keys configured');
      return true;
    }
    spinner.fail('Bucket API keys not available');
    return false;
  } catch (error) {
    spinner.fail('Could not fetch bucket keys');
    return false;
  }
}

/**
 * Start the interactive chat
 */
export async function startChat(options: ChatOptions): Promise<void> {
  // Set build mode flag if provided (affects max_tokens)
  isBuildMode = options.buildMode || false;

  // Set repo mode flag if provided
  isRepoMode = options.repoMode || false;
  currentRepo = null;

  // Set content mode flag if provided
  isContentMode = options.contentMode || false;

  // Set ask mode flag - defaults to true (read-only mode)
  // Agent mode is enabled with --agent flag or when using --build/--content
  // For repo mode: defaults to agent mode unless --ask flag is explicitly provided
  if (options.askMode === true) {
    // Explicit ask mode (e.g., cosmic update --ask)
    isAskMode = true;
  } else if (isBuildMode || isContentMode || isRepoMode) {
    // Build, content, and repo modes default to agent mode
    isAskMode = false;
  } else {
    // Default chat mode is ask mode (read-only)
    isAskMode = options.askMode !== false;
  }

  // Set chat context from options
  chatContext = options.context || {};

  // Add global error handlers for debugging
  process.on('uncaughtException', (err) => {
    console.error(chalk.red(`\n[CRASH] Uncaught exception: ${err.message}`));
    console.error(chalk.dim(err.stack || ''));
    process.exit(1);
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error(chalk.red(`\n[CRASH] Unhandled rejection:`));
    console.error(chalk.dim(String(reason)));
    process.exit(1);
  });

  // Check authentication
  if (!isAuthenticated()) {
    display.error('Not authenticated. Run `cosmic login` first.');
    process.exit(1);
  }

  const bucketSlug = getCurrentBucketSlug();
  if (!bucketSlug) {
    display.error('No bucket selected. Run `cosmic cd <project>/<bucket>` first.');
    process.exit(1);
  }

  // Check if SDK client is available (has bucket keys)
  if (!hasSDKClient()) {
    // Try to fetch keys from Dashboard API
    display.info('Bucket keys not found. Attempting to fetch from API...');
    const success = await tryFetchBucketKeys(bucketSlug);
    if (!success) {
      display.error('Could not configure bucket keys.');
      display.info('Run `cosmic keys set` to configure bucket keys manually.');
      process.exit(1);
    }
  }

  const model = options.model || getDefaultModel();

  // Fetch context data (objects and URLs) if specified
  await fetchContextData(bucketSlug);

  // If repo mode, select a repository first
  if (isRepoMode) {
    spinner.start('Loading repositories...');
    try {
      const { repositories } = await listRepositories(bucketSlug);
      spinner.succeed();

      if (repositories.length === 0) {
        display.error('No repositories connected to this bucket.');
        display.info(`Build an app first with: ${chalk.cyan('cosmic chat --build')}`);
        process.exit(1);
      }

      // If a specific repo name was provided, find it
      if (options.repoName) {
        const repo = repositories.find(r =>
          r.repository_name?.toLowerCase() === options.repoName?.toLowerCase() ||
          r.repository_name?.toLowerCase().includes(options.repoName?.toLowerCase() || '')
        );
        if (!repo) {
          display.error(`Repository "${options.repoName}" not found.`);
          display.info('Available repositories:');
          for (const r of repositories) {
            console.log(chalk.dim(`  - ${r.repository_name}`));
          }
          process.exit(1);
        }
        currentRepo = {
          id: repo.id,
          owner: repo.repository_owner || 'cosmic-community',
          name: repo.repository_name || '',
          branch: options.repoBranch || repo.default_branch || 'main',
        };
      } else if (repositories.length === 1) {
        // Auto-select if only one repo
        const repo = repositories[0];
        currentRepo = {
          id: repo.id,
          owner: repo.repository_owner || 'cosmic-community',
          name: repo.repository_name || '',
          branch: options.repoBranch || repo.default_branch || 'main',
        };
      } else {
        // Show selection menu
        console.log();
        console.log(chalk.bold('Select a repository to update:'));
        console.log();
        repositories.forEach((repo, index) => {
          console.log(chalk.dim(`  ${index + 1}. `) + chalk.cyan(repo.repository_name) + chalk.dim(` (${repo.framework || 'other'})`));
        });
        console.log();

        // Simple number selection
        const answer = await new Promise<string>((resolve) => {
          const tempRl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
          });
          tempRl.question(chalk.yellow('  Enter number (1-' + repositories.length + '): '), (input) => {
            tempRl.close();
            resolve(input);
          });
        });

        const selection = parseInt(answer, 10);
        if (isNaN(selection) || selection < 1 || selection > repositories.length) {
          display.error('Invalid selection.');
          process.exit(1);
        }

        const repo = repositories[selection - 1];
        currentRepo = {
          id: repo.id,
          owner: repo.repository_owner || 'cosmic-community',
          name: repo.repository_name || '',
          branch: options.repoBranch || repo.default_branch || 'main',
        };
      }

      console.log(chalk.green(`  ✓ Selected: ${currentRepo.owner}/${currentRepo.name} (${currentRepo.branch})`));
    } catch (error) {
      spinner.fail('Failed to load repositories');
      display.error((error as Error).message);
      process.exit(1);
    }
  }

  // Print header
  printHeader(model);

  // Initialize conversation
  conversationHistory = [];

  // Keep stdin open and prevent automatic close
  process.stdin.resume();

  // Create readline interface
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  mainRl = rl;


  // Queue-based input system - single persistent 'line' handler
  let pendingResolve: ((line: string) => void) | null = null;
  let pendingReject: ((err: Error) => void) | null = null;

  // Set up persistent line handler (this is key - only set up ONCE)
  rl.on('line', (line) => {
    const verbose = process.env.COSMIC_DEBUG === '2';
    if (verbose) {
      console.log(chalk.dim(`\n[DEBUG] Line received: "${line}", pendingResolve: ${!!pendingResolve}`));
    }
    if (pendingResolve) {
      const resolve = pendingResolve;
      pendingResolve = null;
      pendingReject = null;
      resolve(line);
    } else if (verbose) {
      console.log(chalk.dim('[DEBUG] No pending resolve, line ignored'));
    }
  });

  // Handle readline close
  rl.on('close', () => {
    console.error(chalk.red('\n[DEBUG] Readline closed unexpectedly'));
    mainRl = null;
    sharedAskLine = null;
    if (pendingReject) {
      pendingReject(new Error('readline closed'));
      pendingResolve = null;
      pendingReject = null;
    }
  });

  // Listen for stdin end/close events
  process.stdin.on('end', () => {
    console.error(chalk.red('\n[DEBUG] stdin end event'));
  });

  process.stdin.on('close', () => {
    console.error(chalk.red('\n[DEBUG] stdin close event'));
  });

  // Listen for process exit
  process.on('exit', (code) => {
    console.error(chalk.dim(`\n[DEBUG] Process exit with code: ${code}`));
  });

  process.on('beforeExit', (code) => {
    console.error(chalk.dim(`\n[DEBUG] Process beforeExit with code: ${code}`));
  });

  // Handle SIGINT (Ctrl+C)
  process.on('SIGINT', () => {
    console.log(chalk.dim('\nGoodbye!'));
    rl.close();
    process.exit(0);
  });

  // Promisified question function
  const question = (prompt: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      // Debug: Check stdin state
      if (process.env.COSMIC_DEBUG === '1') {
        console.log(chalk.dim(`\n[DEBUG] stdin readable: ${process.stdin.readable}, destroyed: ${process.stdin.destroyed}`));
        console.log(chalk.dim(`[DEBUG] rl closed: ${(rl as any).closed}, terminal: ${(rl as any).terminal}`));
      }

      // Check if stdin is still readable
      if (!process.stdin.readable || process.stdin.destroyed) {
        console.error(chalk.red('\n[ERROR] stdin is no longer readable'));
        reject(new Error('stdin closed'));
        return;
      }

      // Ensure stdin is flowing and readline is actively reading
      // This is critical to keep the event loop active
      process.stdin.resume();
      rl.resume();

      pendingResolve = resolve;
      pendingReject = reject;

      // Write the prompt
      process.stdout.write(prompt);
    });
  };

  // Set the shared input function so askConfirmation can use it
  sharedAskLine = question;

  // Main chat loop
  const runChatLoop = async () => {
    // Handle initial prompt if provided (from project creation)
    if (options.initialPrompt) {
      console.log(chalk.cyan('> ') + chalk.dim(options.initialPrompt));
      conversationHistory.push({
        role: 'user',
        content: options.initialPrompt,
      });
      try {
        let shouldContinue = true;
        while (shouldContinue) {
          shouldContinue = await processMessage(model, rl, bucketSlug);
        }
        skipConfirmations = false;
      } catch (error) {
        skipConfirmations = false;
        display.error((error as Error).message);
      }
    }

    while (true) {
      try {
        const line = await question(chalk.cyan('> '));
        const input = line.trim();

        // Handle special commands
        if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
          console.log(chalk.dim('Goodbye!'));
          rl.close();
          process.exit(0);
        }

        if (input.toLowerCase() === 'clear') {
          conversationHistory = [];
          console.log(chalk.dim('Conversation cleared.'));
          continue;
        }

        if (input.toLowerCase() === 'help') {
          printHelp();
          continue;
        }

        if (input.toLowerCase() === 'context') {
          console.log();
          console.log(chalk.bold('Current Configuration:'));
          console.log(chalk.dim(`  Bucket: ${formatContext()}`));
          console.log(chalk.dim(`  Model: ${model}`));
          console.log(chalk.dim(`  Mode: ${isAskMode ? 'Ask (read-only)' : isContentMode ? 'Content' : isRepoMode ? 'Repository' : isBuildMode ? 'Build' : 'Agent'}`));

          // Show chat context details
          if (chatContext.objectTypes?.length || chatContext.links?.length) {
            console.log();
            console.log(chalk.bold('AI Context:'));
            if (chatContext.objectTypes && chatContext.objectTypes.length > 0) {
              console.log(chalk.dim(`  Object Types: ${chatContext.objectTypes.join(', ')}`));
            }
            if (chatContext.links && chatContext.links.length > 0) {
              console.log(chalk.dim(`  External Links: ${chatContext.links.join(', ')}`));
            }
          } else {
            console.log();
            console.log(chalk.dim('  No additional context configured.'));
            console.log(chalk.dim('  Use --content, --types, or --links flags when starting chat.'));
          }
          console.log();
          continue;
        }

        if (input.toLowerCase() === 'open') {
          if (lastDeploymentUrl) {
            console.log(chalk.dim(`  Opening ${lastDeploymentUrl}...`));
            // Use dynamic import for open package
            const open = await import('open').then(m => m.default);
            await open(lastDeploymentUrl);
          } else {
            console.log(chalk.dim('  No deployment URL available. Deploy an app first.'));
          }
          continue;
        }

        // Handle "add content" command - generates content metadata and prompts to add
        if (input.toLowerCase() === 'add content' || input.toLowerCase().startsWith('add content:')) {
          const contentDescription = input.toLowerCase().startsWith('add content:')
            ? input.substring('add content:'.length).trim()
            : '';

          console.log();
          spinner.start('Generating content for Cosmic CMS...');

          try {
            // Build a prompt to generate content metadata
            const contentPrompt = contentDescription
              ? `Generate Cosmic CMS content for: ${contentDescription}`
              : `Based on the code we've been working on, generate any Cosmic CMS object types and demo content that would be needed. Look at the types, API calls, and pages to determine what content is expected from Cosmic.`;

            // Use the conversation history for context
            const contextMessages = conversationHistory.slice(-6).map((msg) => ({
              role: msg.role as 'user' | 'assistant',
              content: [{ type: 'text' as const, text: msg.content }],
            }));

            // Add the content generation request
            contextMessages.push({
              role: 'user',
              content: [{
                type: 'text', text: `${contentPrompt}

IMPORTANT: Generate the content using these EXACT metadata markers:

<!-- METADATA: {"type":"addContent"} -->
<!-- METADATA: {"type":"objectType"} -->
\`\`\`json
[{ "title": "...", "slug": "...", "emoji": "...", "metafields": [...] }]
\`\`\`

<!-- METADATA: {"type":"demoObjects"} -->
\`\`\`json
[{ "type": "...", "title": "...", "status": "published", "metafields": [...] }]
\`\`\`

Generate complete, realistic content that matches what the code expects.` }],
            });

            // Use the streaming chat API
            let fullResponse = '';
            await api.streamingChat({
              messages: contextMessages,
              bucketSlug,
              model,
              maxTokens: 16000,
              viewMode: 'content-model',
              onChunk: (chunk) => {
                fullResponse += chunk;
              },
            });

            spinner.stop();

            // Extract and install the content
            const extractedContent = extractContentFromResponse(fullResponse);
            if (extractedContent.hasAddContent && (extractedContent.objectTypes.length > 0 || extractedContent.demoObjects.length > 0)) {
              const result = await installContentToCosmic(sdk, extractedContent, rl);
              if (result.nextAction === 'build') {
                isBuildMode = true;
                console.log();
                console.log(chalk.green('  Switching to build mode...'));
                console.log();
                console.log(chalk.cyan('  Describe the app you\'d like to build:'));
              } else if (result.nextAction === 'exit') {
                console.log(chalk.dim('  Goodbye!'));
                rl.close();
                return;
              }
            } else {
              console.log(chalk.yellow('  No content metadata found in AI response.'));
              console.log(chalk.dim('  Try being more specific: add content: [description]'));
            }
          } catch (err) {
            spinner.stop();
            console.log(chalk.red(`  Error generating content: ${(err as Error).message}`));
          }
          continue;
        }

        if (!input) {
          continue;
        }

        // Add user message to history
        conversationHistory.push({
          role: 'user',
          content: input,
        });

        // Process message (loop while AI wants to continue, e.g., for multi-item creation)
        try {
          let shouldContinue = true;
          while (shouldContinue) {
            shouldContinue = await processMessage(model, rl, bucketSlug);
          }
          // Reset skip confirmations after auto-continue loop ends
          skipConfirmations = false;
          if (process.env.COSMIC_DEBUG === '1') {
            console.log(chalk.dim('[DEBUG] processMessage complete, about to loop back for next input'));
          }
        } catch (error) {
          skipConfirmations = false;
          console.error(chalk.red(`[DEBUG] Inner catch error: ${(error as Error).message}`));
          display.error((error as Error).message);
        }
      } catch (error) {
        // Handle readline close (Ctrl+C, etc.)
        const err = error as Error;
        if (process.env.COSMIC_DEBUG === '1') {
          console.error(chalk.red(`\n[DEBUG] Outer catch error: ${err.message}`));
          console.error(chalk.dim(`Stack: ${err.stack}`));
        }
        console.log(chalk.dim('\nGoodbye!'));
        process.exit(0);
      }
    }
  };

  // Start the chat loop with error handling
  runChatLoop().catch((error) => {
    console.error('Chat error:', error.message);
    process.exit(1);
  });
}

/**
 * Get the system prompt for ask mode (read-only, no actions)
 */
function getAskModeSystemPrompt(bucketSlug: string): string {
  const today = new Date().toISOString().split('T')[0];

  let contextSection = '';

  // Add object types context info
  if (chatContext.objectTypes && chatContext.objectTypes.length > 0) {
    contextSection += `\n\n**Object Types in Context:** ${chatContext.objectTypes.join(', ')}`;
  }

  // Add links context info  
  if (chatContext.links && chatContext.links.length > 0) {
    contextSection += `\n\n**External Links in Context:** ${chatContext.links.join(', ')}`;
  }

  // Add fetched context data (actual content)
  contextSection += buildFetchedContextSection();

  return `You are a helpful AI assistant for Cosmic CMS, answering questions about the bucket "${bucketSlug}".

Current date: ${today}

**MODE: Ask Mode (Read-Only)**
You are in read-only "ask" mode. You can answer questions, explain concepts, and provide guidance about Cosmic CMS, but you CANNOT execute any actions that modify content.

In this mode:
- Answer questions about Cosmic CMS, content modeling, APIs, and best practices
- Explain how to use features, structure content, or integrate with applications
- Provide code examples, documentation references, and helpful guidance
- Discuss the user's content strategy, architecture decisions, or implementation approaches

If the user wants to create, update, or delete content, explain that they need to use "agent mode" by restarting with:
  cosmic chat --agent

Or use the shortcut commands:
  cosmic content  - Create and manage content
  cosmic build    - Build and deploy a new app
  cosmic update   - Update an existing repository${contextSection}

Be helpful, concise, and friendly. Focus on providing valuable information rather than actions.`;
}

/**
 * Build fetched context section for system prompts
 */
function buildFetchedContextSection(): string {
  let section = '';

  // Add fetched objects
  if (fetchedContextData.objects.length > 0) {
    section += '\n\n**EXISTING CONTENT IN THIS BUCKET:**\n';
    section += 'Use this as reference for the content structure and style:\n';
    section += '```json\n';
    section += JSON.stringify(fetchedContextData.objects, null, 2);
    section += '\n```';
  }

  // Add fetched URL contents
  if (fetchedContextData.linkContents.length > 0) {
    section += '\n\n**REFERENCE CONTENT FROM PROVIDED URLs - USE THIS CONTENT:**\n';
    section += 'The user wants you to use this content as reference or to recreate it in their bucket.\n';
    section += 'When asked to "add this" or "create this", use the content below:\n';
    for (const { url, content } of fetchedContextData.linkContents) {
      section += `\n<url_content source="${url}">\n`;
      section += content;
      section += '\n</url_content>\n';
    }
  }

  // Debug logging
  if (process.env.COSMIC_DEBUG === '1' || process.env.COSMIC_DEBUG === '2') {
    console.log(chalk.dim(`[DEBUG] buildFetchedContextSection: ${fetchedContextData.objects.length} objects, ${fetchedContextData.linkContents.length} URLs`));
    if (fetchedContextData.linkContents.length > 0) {
      console.log(chalk.dim(`[DEBUG] URL content length: ${fetchedContextData.linkContents[0]?.content?.length || 0} chars`));
    }
  }

  return section;
}

/**
 * Get the system prompt for content mode (content creation and updates)
 */
function getContentModeSystemPrompt(bucketSlug: string): string {
  const today = new Date().toISOString().split('T')[0];

  let contextSection = '';

  // Add object types context info
  if (chatContext.objectTypes && chatContext.objectTypes.length > 0) {
    contextSection += `\n\n**Focus Object Types:** ${chatContext.objectTypes.join(', ')}
When creating content, prioritize these object types.`;
  }

  // Add fetched context data (actual content)
  contextSection += buildFetchedContextSection();

  return `You are an AI content assistant for Cosmic CMS, helping users create and manage content in their bucket "${bucketSlug}".

Current date: ${today}

**MODE: Content Mode**
You are in content creation mode. Your primary focus is helping users:
- Create new content objects (blog posts, pages, products, etc.)
- Generate high-quality text content with AI
- Update existing content
- Set up content models and object types
- Manage content organization${contextSection}

You can perform these actions by outputting JSON commands:

**CONTENT OPERATIONS:**
1. LIST objects: {"action": "list", "type": "<object-type-slug>", "limit": 10}
2. READ object: {"action": "read", "id": "<object-id-or-slug>"}
3. CREATE object: {"action": "create", "type": "<object-type-slug>", "title": "<title>", "metadata": {...}}
4. UPDATE object: {"action": "update", "id": "<id>", "title": "<new title>", "metadata": {...}}
5. DELETE object: {"action": "delete", "id": "<id>"}

**OBJECT TYPES:**
6. LIST object types: {"action": "list_object_types"}
7. CREATE object type: {"action": "create_object_type", "title": "<title>", "slug": "<slug>", "singular": "<singular>", "emoji": "<emoji>", "metafields": [...]}

**CREATE OBJECT - REQUIRED FIELDS:**
- "type": The object type SLUG (e.g., "blog-posts", "authors") - REQUIRED
- "title": The object title - REQUIRED

**CREATE OBJECT - OPTIONAL FIELDS:**
- "slug": Auto-generated from title if not provided
- "metadata": Object with metafield key:value pairs matching the object type's metafields

**METAFIELD TYPES:**
- text: Single line text
- textarea: Multi-line plain text
- html-textarea: Rich text HTML editor
- markdown: Markdown editor
- number: Numeric value
- date: Date picker
- file: File/image upload
- object: Reference to single object
- objects: Reference to multiple objects
- switch: Boolean toggle
- select-dropdown: Dropdown select
- repeater: Repeatable group of fields

When a user asks to create or update content, output the JSON command on a single line starting with "ACTION:".

Examples:
- ACTION: {"action": "list", "type": "posts", "limit": 5}
- ACTION: {"action": "create", "type": "blog-posts", "title": "My New Post", "metadata": {"content": "...", "excerpt": "..."}}

**CREATING MULTIPLE ITEMS:**
When asked to create multiple items, use create_batch first:
ACTION: {"action": "create_batch", "count": <number>, "type": "<type-slug>", "items": ["Title 1", "Title 2", ...]}

**INSTALL CONTENT MODEL:**
For creating object types with demo content:
ACTION: {"action": "install_content_model", "object_types": [...], "demo_objects": [...]}

Be creative and helpful when generating content. Write high-quality, engaging text that matches the user's needs.
For general questions or help, respond normally without any ACTION command.`;
}

/**
 * Get the system prompt for agent mode (full actions)
 */
function getAgentModeSystemPrompt(bucketSlug: string): string {
  const today = new Date().toISOString().split('T')[0];

  return `You are an AI assistant for Cosmic CMS, helping users manage content in their bucket "${bucketSlug}".

Current date: ${today}

You can perform these actions by outputting JSON commands:

**OBJECTS** (see https://www.cosmicjs.com/docs/api/objects):
1. LIST objects: {"action": "list", "type": "<object-type-slug>", "limit": 10}
2. READ object: {"action": "read", "id": "<object-id-or-slug>"}
3. CREATE object: {"action": "create", "type": "<object-type-slug>", "title": "<title>", "metadata": {...}}
4. UPDATE object: {"action": "update", "id": "<id>", "title": "<new title>", "metadata": {...}}
5. DELETE object: {"action": "delete", "id": "<id>"}

**CREATE OBJECT - REQUIRED FIELDS:**
- "type": The object type SLUG (e.g., "blog-posts", "authors") - REQUIRED
- "title": The object title - REQUIRED

**CREATE OBJECT - OPTIONAL FIELDS:**
- "slug": Auto-generated from title if not provided
- "metadata": Object with metafield key:value pairs matching the object type's metafields

**EXAMPLE CREATE BLOG POST:**
{"action": "create", "type": "blog-posts", "title": "Getting Started with React", "metadata": {"content": "# Introduction\n\nReact is a JavaScript library...", "excerpt": "Learn the basics of React", "published_date": "2024-01-15"}}

**OBJECT TYPES:**
6. LIST object types: {"action": "list_object_types"}
7. CREATE object type: {"action": "create_object_type", "title": "<title>", "slug": "<slug>", "singular": "<singular>", "emoji": "<emoji>", "metafields": [...]}

**OBJECT TYPE DATA MODEL:**
- title: string (required, display name like "Blog Posts")
- slug: string (auto-generated if not provided, like "blog-posts")
- singular: string (singular form, like "Blog Post")
- emoji: string (icon like "📝", "👤", "🏷️")
- metafields: array of field definitions with {title, key, type, required}

**METAFIELD TYPES:**
- text: Single line text
- textarea: Multi-line plain text
- html-textarea: Rich text HTML editor
- markdown: Markdown editor
- number: Numeric value
- date: Date picker
- file: File/image upload (use media_validation_type for validation)
- files: Multiple files upload (use media_validation_type for validation)
- object: Reference to single object (requires object_type)
- objects: Reference to multiple objects (requires object_type)
- switch: Boolean toggle - DO NOT include "options" field, just use type: "switch"
- select-dropdown: Dropdown select (requires options array like ["Option 1", "Option 2"])
- radio-buttons: Radio buttons (requires options array)
- repeater: Repeatable group of fields (requires repeater_fields array)

**IMPORTANT METAFIELD RULES:**
- For "switch" type: Do NOT include an "options" field. Just use {"title": "Featured", "key": "is_featured", "type": "switch"}
- For "object" type: Include "object_type": "<slug>" to specify which object type to reference
- For "objects" type: Include "object_type": "<slug>" for the referenced type
- For "file" and "files" types: Include "media_validation_type" to restrict file types:
  - "image" - Only allow image files (jpg, png, gif, webp, etc.)
  - "video" - Only allow video files (mp4, webm, etc.)
  - "audio" - Only allow audio files (mp3, wav, etc.)
  - "application" - Only allow documents (pdf, doc, etc.)

**EXAMPLE OBJECT TYPE:**
{"action": "create_object_type", "title": "Authors", "slug": "authors", "singular": "Author", "emoji": "👤", "metafields": [
  {"title": "Name", "key": "name", "type": "text", "required": true},
  {"title": "Bio", "key": "bio", "type": "textarea"},
  {"title": "Avatar", "key": "avatar", "type": "file", "media_validation_type": "image"},
  {"title": "Email", "key": "email", "type": "text"}
]}

**EXAMPLE BLOG POST WITH REFERENCES:**
{"action": "create_object_type", "title": "Blog Posts", "slug": "blog-posts", "singular": "Blog Post", "emoji": "📝", "metafields": [
  {"title": "Content", "key": "content", "type": "markdown", "required": true},
  {"title": "Excerpt", "key": "excerpt", "type": "textarea"},
  {"title": "Featured Image", "key": "featured_image", "type": "file", "media_validation_type": "image"},
  {"title": "Author", "key": "author", "type": "object", "object_type": "authors"},
  {"title": "Categories", "key": "categories", "type": "objects", "object_type": "categories"},
  {"title": "Published Date", "key": "published_date", "type": "date"},
  {"title": "Featured", "key": "is_featured", "type": "switch"}
]}

**AGENTS:**
6. LIST agents: {"action": "list_agents"}
7. GET agent: {"action": "get_agent", "id": "<agent-id>"}
8. CREATE agent: {"action": "create_agent", "name": "<name>", "type": "content|repository", "prompt": "<system prompt>", "emoji": "<emoji>", "object_types": ["<type-slug>", ...]}
9. UPDATE agent: {"action": "update_agent", "id": "<agent-id>", "name": "<new name>", "prompt": "<new prompt>"}
10. DELETE agent: {"action": "delete_agent", "id": "<agent-id>"}
11. RUN agent: {"action": "run_agent", "id": "<agent-id>", "prompt": "<optional prompt>"}

**AGENT DATA MODEL:**
- agent_name: string (required, 1-100 chars)
- agent_type: "content" | "repository" | "computer_use"
- prompt: string (required, the system prompt/instructions)
- model: defaults to "claude-opus-4-5-20251101" (don't include unless user specifies different model)
- emoji: string (always include, e.g. "✍️", "📝", "🤖", "📰", "💡")
- object_types: array of object type slugs for context (e.g. ["posts", "authors"])

**WORKFLOWS:**
12. LIST workflows: {"action": "list_workflows"}
13. GET workflow: {"action": "get_workflow", "id": "<workflow-id>"}
14. CREATE workflow: {"action": "create_workflow", "name": "<name>", "description": "<desc>", "steps": [...], "object_types": ["<type-slug>", ...]}
15. UPDATE workflow: {"action": "update_workflow", "id": "<workflow-id>", "name": "<new name>", "status": "active|draft|paused"}
16. DELETE workflow: {"action": "delete_workflow", "id": "<workflow-id>"}
17. RUN workflow: {"action": "run_workflow", "id": "<workflow-id>", "inputs": {<optional inputs>}}

**WORKFLOW DATA MODEL:**
- workflow_name: string (required)
- description: string
- emoji: string (always include, e.g., "⚡", "📧", "🔄", "📝")
- steps: array of step objects (required, at least 1 step)
- status: "draft" | "active" | "paused" (defaults to "draft")
- object_types: array of object type slugs for context

**STEP STRUCTURE (REQUIRED FIELDS):**
Each step MUST have:
- step_number: number (required, starts at 1)
- name: string (required, e.g., "Generate Article", "Send Notification")
- type: "agent" | "approval_gate" | "wait_for_parallel" | "conditional"
- agent_type: "content" | "repository" | "computer_use" (required for agent steps)
- config: object with step-specific configuration

**AGENT TYPE GUIDELINES:**
- "content": For generating/editing text content (blog posts, articles, descriptions)
- "repository": For working with code repositories
- "computer_use": For browser automation tasks like sending emails, filling forms, web interactions

**STEP CONFIG EXAMPLES:**
For content agent step (generating content):
{"prompt": "Generate a casual 500-word tech review", "object_type": "posts"}

For computer_use agent step (sending email via browser automation):
{"goal": "Send email to user@example.com with subject 'New Post Published' and body 'Check out the new blog post: {{object_link}}'", "start_url": "https://mail.google.com"}

**EXAMPLE WORKFLOW STEPS:**
[
  {"step_number": 1, "name": "Generate Article", "type": "agent", "agent_type": "content", "config": {"prompt": "Write a tech review", "object_type": "posts"}},
  {"step_number": 2, "name": "Send Email Notification", "type": "agent", "agent_type": "computer_use", "config": {"goal": "Send email to user@example.com with subject 'New Post' and body 'Check it out!'", "start_url": "https://mail.google.com"}}
]

**IMPORTANT for creating agents/workflows:**
- Before creating, you MUST gather ALL required information from the user:
  1. Name for the agent/workflow
  2. What it should do (purpose/description)
  3. Which object types it should work with (e.g., posts, authors, categories)
  4. Any specific guidelines, tone, or style preferences
- Do NOT create the agent/workflow until you have answers to ALL these questions
- If the user provides partial information (e.g., only answers one question), ask follow-up questions for the missing details
- Only output the ACTION command once you have complete information
- ALWAYS include an appropriate emoji for agents AND workflows (e.g., ✍️ for writing, 📰 for news, 🎨 for creative, ⚡ for automation, 📧 for email)
- Include all mentioned object types in the "object_types" array for context
- Use "computer_use" agent_type for browser automation tasks (sending emails, filling forms, web scraping)

When a user asks to perform an action, output the JSON command on a single line starting with "ACTION:".

Examples:
- ACTION: {"action": "list", "type": "posts", "limit": 5}
- ACTION: {"action": "list_agents"}
- ACTION: {"action": "run_workflow", "id": "abc123"}

**CRITICAL - CREATING MULTIPLE ITEMS:**
When asked to create 2 or more items, you MUST use the create_batch action FIRST to show what will be created:
ACTION: {"action": "create_batch", "count": <number>, "type": "<type-slug>", "items": ["Title 1", "Title 2", ...]}

This shows the user ALL items before they confirm. Only after create_batch is confirmed, proceed with individual create actions.

**EXAMPLE - User asks "create 3 demo blog posts":**
Your FIRST response MUST include create_batch:
"I'll create 3 demo blog posts for you:"
ACTION: {"action": "create_batch", "count": 3, "type": "blog-posts", "items": ["Getting Started with React", "Understanding TypeScript", "Building APIs with Node.js"]}

After user confirms, THEN create each one:
ACTION: {"action": "create", "type": "blog-posts", "title": "Getting Started with React", "metadata": {"content": "..."}}

**SINGLE ITEM CREATION:**
For creating just ONE item, use the create action directly (no create_batch needed).

**INSTALL CONTENT MODEL (for creating complete content models with demo content):**
When asked to "create object types" or "create a content model" or similar, use install_content_model:
ACTION: {"action": "install_content_model", "object_types": [...], "demo_objects": [...]}

**install_content_model STRUCTURE:**
- object_types: Array of object type definitions (same format as create_object_type but without "action" field)
- demo_objects: Array of demo content objects to create

**IMPORTANT FOR install_content_model:**
- Create object types that reference other types LAST (e.g., posts that reference authors/categories)
- For demo_objects, include Unsplash image URLs for thumbnails and file metafields
- Use real Unsplash URLs like: https://images.unsplash.com/photo-1234567890
- For object references in demo_objects, use the slug of the referenced object (e.g., "category": "technology")
- Create 2-3 demo objects per object type

**EXAMPLE install_content_model:**
ACTION: {"action": "install_content_model", "object_types": [
  {"title": "Categories", "slug": "categories", "singular": "Category", "emoji": "🏷️", "metafields": [
    {"title": "Name", "key": "name", "type": "text", "required": true},
    {"title": "Description", "key": "description", "type": "textarea"}
  ]},
  {"title": "Authors", "slug": "authors", "singular": "Author", "emoji": "👤", "metafields": [
    {"title": "Name", "key": "name", "type": "text", "required": true},
    {"title": "Bio", "key": "bio", "type": "textarea"},
    {"title": "Avatar", "key": "avatar", "type": "file", "media_validation_type": "image"}
  ]},
  {"title": "Blog Posts", "slug": "blog-posts", "singular": "Blog Post", "emoji": "📝", "metafields": [
    {"title": "Content", "key": "content", "type": "markdown", "required": true},
    {"title": "Featured Image", "key": "featured_image", "type": "file", "media_validation_type": "image"},
    {"title": "Author", "key": "author", "type": "object", "object_type": "authors"},
    {"title": "Categories", "key": "categories", "type": "objects", "object_type": "categories"}
  ]}
], "demo_objects": [
  {"title": "Technology", "type": "categories", "metadata": {"name": "Technology", "description": "Articles about tech"}},
  {"title": "Web Development", "type": "categories", "metadata": {"name": "Web Development", "description": "Frontend and backend tutorials"}},
  {"title": "Jane Smith", "type": "authors", "thumbnail": "https://images.unsplash.com/photo-1494790108377-be9c29b29330", "metadata": {"name": "Jane Smith", "bio": "Senior developer and tech writer", "avatar": "https://images.unsplash.com/photo-1494790108377-be9c29b29330"}},
  {"title": "Getting Started with React", "type": "blog-posts", "thumbnail": "https://images.unsplash.com/photo-1633356122544-f134324a6cee", "metadata": {"content": "# Introduction\\n\\nReact is a popular JavaScript library...", "featured_image": "https://images.unsplash.com/photo-1633356122544-f134324a6cee", "author": "jane-smith", "categories": ["technology", "web-development"]}}
]}

**OTHER RULES:**
- After each create completes, continue with the NEXT item automatically
- Do NOT list object types first - proceed directly with creation
- Common types: blog-posts, posts, authors, categories, pages, products

**REPOSITORIES:**
19. LIST REPOSITORIES: {"action": "list_repositories"}
20. DEPLOY REPOSITORY: {"action": "deploy_repository", "repository_id": "<id>"}

For general questions or help, respond normally without any ACTION command.`;
}

/**
 * Get the system prompt for the chat (mode-aware)
 */
function getSystemPrompt(bucketSlug: string): string {
  if (isAskMode) {
    return getAskModeSystemPrompt(bucketSlug);
  }
  if (isContentMode) {
    return getContentModeSystemPrompt(bucketSlug);
  }
  return getAgentModeSystemPrompt(bucketSlug);
}

/**
 * Format object details for display
 */
function formatObjectDetails(obj: Record<string, unknown>): string {
  let output = `\n📄 ${obj.title}\n`;
  output += `${'─'.repeat(60)}\n`;
  output += `ID: ${obj.id}\n`;
  output += `Slug: ${obj.slug}\n`;
  output += `Type: ${obj.type}\n`;
  output += `Status: ${obj.status}\n`;

  if (obj.content) {
    output += `\nContent:\n${obj.content}\n`;
  }

  if (obj.metadata && Object.keys(obj.metadata as object).length > 0) {
    output += `\nMetadata:\n`;
    for (const [key, value] of Object.entries(obj.metadata as object)) {
      if (typeof value === 'object') {
        output += `  ${key}: ${JSON.stringify(value, null, 2).split('\n').join('\n  ')}\n`;
      } else {
        output += `  ${key}: ${value}\n`;
      }
    }
  }

  return output;
}

/**
 * Main readline interface - shared across the module
 */
let mainRl: readline.Interface | null = null;

/**
 * Shared line input function - set by the main chat loop
 * This ensures all input goes through the same queue-based system
 */
let sharedAskLine: ((prompt: string) => Promise<string>) | null = null;

/**
 * Flag to skip confirmations during auto-continue mode
 * Set to true after the first item is confirmed in a multi-item operation
 */
let skipConfirmations = false;

/**
 * Ask for confirmation (defaults to Yes)
 * Uses the shared input function to avoid stdin conflicts
 */
async function askConfirmation(): Promise<boolean> {
  // Skip confirmation if we're in auto-continue mode
  if (skipConfirmations) {
    return true;
  }

  if (sharedAskLine) {
    try {
      const answer = await sharedAskLine(chalk.dim('[Y/n] '));
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

/**
 * Parse and execute actions from AI response
 */
async function executeAction(actionJson: string): Promise<string> {
  const sdk = getSDKClient();
  if (!sdk) {
    return 'Error: SDK not available';
  }

  const bucketSlug = getCurrentBucketSlug();
  if (!bucketSlug) {
    return 'Error: No bucket selected. Use "cosmic use" to set a bucket.';
  }

  try {
    const action = JSON.parse(actionJson);

    switch (action.action) {
      case 'create_batch': {
        // Batch creation confirmation - shows all items that will be created
        if (!action.type || !action.items || !action.count) {
          return 'Error: Batch create requires type, count, and items array.';
        }

        console.log();
        console.log(chalk.yellow(`  Create ${action.count} ${action.type}:`));
        for (let i = 0; i < action.items.length; i++) {
          console.log(chalk.yellow(`    ${i + 1}. ${action.items[i]}`));
        }
        process.stdout.write(chalk.yellow(`  Proceed? `));
        const confirmed = await askConfirmation();

        if (!confirmed) {
          return chalk.dim('Cancelled.');
        }

        // Set flag to skip individual confirmations since we just confirmed the batch
        skipConfirmations = true;

        // Return success - the actual creates will follow
        return `✓ Confirmed. Creating ${action.count} ${action.type}...`;
      }

      case 'create': {
        // Validate required fields per SDK docs: https://www.cosmicjs.com/docs/api/objects
        if (!action.type) {
          return 'Error: "type" is required. Please specify the object type slug (e.g., "blog-posts").';
        }
        if (!action.title) {
          return 'Error: "title" is required.';
        }

        // Skip confirmation if we already confirmed a batch
        if (!skipConfirmations) {
          // Ask for confirmation for single items
          console.log();
          process.stdout.write(chalk.yellow(`  Create ${action.type}: "${action.title}"? `));
          const confirmed = await askConfirmation();

          if (!confirmed) {
            return chalk.dim('Cancelled.');
          }
        }

        spinner.start('Creating...');

        // Build insert payload per SDK docs
        const insertPayload: Record<string, unknown> = {
          type: action.type,
          title: action.title,
        };

        // Add optional slug if provided
        if (action.slug) {
          insertPayload.slug = action.slug;
        }

        // Add metadata if provided (metafield key:value pairs)
        if (action.metadata) {
          insertPayload.metadata = action.metadata;
        }

        // Legacy support: if content is provided without metadata, use it
        if (action.content && !action.metadata) {
          insertPayload.metadata = { content: action.content };
        }

        const result = await sdk.objects.insertOne(insertPayload);
        spinner.stop();
        return `✓ Created "${result.object.title}" (ID: ${result.object.id})`;
      }

      case 'update': {
        console.log();
        process.stdout.write(chalk.yellow(`  Update object ${action.id}? `));
        const confirmed = await askConfirmation();

        if (!confirmed) {
          return chalk.dim('Cancelled.');
        }

        spinner.start('Updating...');
        const updateData: Record<string, unknown> = {};
        if (action.title) updateData.title = action.title;
        if (action.content) updateData.content = action.content;
        if (action.metadata) updateData.metadata = action.metadata;

        const result = await sdk.objects.updateOne(action.id, updateData);
        spinner.stop();
        return `✓ Updated "${result.object.title}"`;
      }

      case 'delete': {
        console.log();
        process.stdout.write(chalk.red(`  Delete object ${action.id}? (cannot be undone) `));
        const confirmed = await askConfirmation();

        if (!confirmed) {
          return chalk.dim('Cancelled.');
        }

        spinner.start('Deleting...');
        await sdk.objects.deleteOne(action.id);
        spinner.stop();
        return `✓ Deleted object ${action.id}`;
      }

      case 'list': {
        spinner.start('Fetching...');

        // SDK uses chaining: find(query).status('any').limit(n)
        const query: Record<string, unknown> = {};
        if (action.type) query.type = action.type;
        const limit = action.limit || 10;

        // Use .status('any') to fetch both published and draft objects
        const result = await sdk.objects.find(query).status('any').limit(limit);
        spinner.stop();

        if (!result.objects || result.objects.length === 0) {
          return `No ${action.type || 'objects'} found.`;
        }

        const typeLabel = action.type || 'objects';
        let output = `Found ${result.objects.length} ${typeLabel}:\n`;
        for (const obj of result.objects) {
          const status = obj.status === 'published' ? '●' : '○';
          output += `  ${status} ${obj.title} (${obj.slug})\n`;
        }
        return output;
      }

      case 'read': {
        spinner.start('Fetching object...');

        // Try to find by ID or slug
        const identifier = action.id || action.slug;
        if (!identifier) {
          spinner.stop();
          return 'Error: No object ID or slug provided.';
        }

        try {
          // Check if it looks like a MongoDB ObjectID (24 hex chars)
          const isObjectId = /^[a-f0-9]{24}$/i.test(identifier);

          // Use find().status('any').limit(1) for both ID and slug lookups
          // because findOne doesn't support .status() chaining
          let result;
          if (isObjectId) {
            const findResult = await sdk.objects.find({ id: identifier }).status('any').limit(1);
            result = { object: findResult.objects?.[0] };
          } else {
            // Search by slug using find with slug filter
            const findResult = await sdk.objects.find({ slug: identifier }).status('any').limit(1);
            result = { object: findResult.objects?.[0] };
          }

          spinner.stop();

          if (!result.object) {
            return `Object "${identifier}" not found.`;
          }

          return formatObjectDetails(result.object);
        } catch (err) {
          spinner.stop();
          return `Error fetching object: ${(err as Error).message}`;
        }
      }

      // ============== AGENTS ==============

      case 'list_agents': {
        spinner.start('Fetching agents...');
        const bucketSlug = getCurrentBucketSlug();
        if (!bucketSlug) {
          spinner.stop();
          return 'Error: No bucket selected.';
        }

        const agents = await listAgents(bucketSlug);
        spinner.stop();

        if (agents.length === 0) {
          return 'No agents found.';
        }

        let output = `Found ${agents.length} agent(s):\n`;
        for (const agent of agents) {
          const emoji = (agent as Record<string, unknown>).emoji || '🤖';
          const name = (agent as Record<string, unknown>).agent_name || agent.name;
          const type = (agent as Record<string, unknown>).agent_type || 'unknown';
          const id = (agent as Record<string, unknown>)._id || (agent as Record<string, unknown>).id;
          output += `  ${emoji} ${name} (${type}) - ID: ${id}\n`;
        }
        return output;
      }

      case 'get_agent': {
        spinner.start('Fetching agent...');
        const bucketSlug = getCurrentBucketSlug();
        if (!bucketSlug) {
          spinner.stop();
          return 'Error: No bucket selected.';
        }

        const agent = await getAgent(bucketSlug, action.id);
        spinner.stop();

        const agentAny = agent as Record<string, unknown>;
        let output = `\n🤖 ${agentAny.agent_name || agentAny.name}\n`;
        output += `${'─'.repeat(60)}\n`;
        output += `ID: ${agentAny._id || agentAny.id}\n`;
        output += `Type: ${agentAny.agent_type}\n`;
        output += `Model: ${agentAny.model || 'default'}\n`;
        if (agentAny.prompt) {
          output += `\nPrompt:\n${agentAny.prompt}\n`;
        }
        return output;
      }

      case 'create_agent': {
        const bucketSlug = getCurrentBucketSlug();
        if (!bucketSlug) {
          return 'Error: No bucket selected.';
        }

        console.log();
        process.stdout.write(chalk.yellow(`  Create agent "${action.name}" (${action.type || 'content'})? `));
        const confirmed = await askConfirmation();

        if (!confirmed) {
          return chalk.dim('Cancelled.');
        }

        spinner.start('Creating agent...');
        try {
          const agentData: Record<string, unknown> = {
            agent_name: action.name,
            agent_type: action.type || 'content',
            prompt: action.prompt || 'You are a helpful content writing assistant.',
            // Default to Claude Opus 4.5 unless user specifies a different model
            model: action.model || 'claude-opus-4-5-20251101',
            emoji: action.emoji || '🤖',
          };

          // Add object types to context if specified (correct structure: context.objects.object_types)
          if (action.object_types && action.object_types.length > 0) {
            agentData.context = {
              objects: {
                enabled: true,
                object_types: action.object_types,
              },
            };
          }

          const agent = await createAgent(bucketSlug, agentData);
          spinner.stop();

          if (!agent || (typeof agent === 'object' && Object.keys(agent).length === 0)) {
            return 'Error: No response from API. The agent may have been created - check the dashboard.';
          }

          const agentAny = agent as Record<string, unknown>;
          const name = agentAny.agent_name || agentAny.name || action.name;
          const id = agentAny.id || agentAny._id || 'unknown';
          return `✓ Created agent "${name}" (ID: ${id})`;
        } catch (err) {
          spinner.stop();
          return `Error creating agent: ${(err as Error).message}`;
        }
      }

      case 'update_agent': {
        const bucketSlug = getCurrentBucketSlug();
        if (!bucketSlug) {
          return 'Error: No bucket selected.';
        }

        console.log();
        process.stdout.write(chalk.yellow(`  Update agent ${action.id}? `));
        const confirmed = await askConfirmation();

        if (!confirmed) {
          return chalk.dim('Cancelled.');
        }

        spinner.start('Updating agent...');
        const updateData: Record<string, unknown> = {};
        if (action.name) updateData.agent_name = action.name;
        if (action.prompt) updateData.prompt = action.prompt;
        if (action.model) updateData.model = action.model;
        if (action.emoji) updateData.emoji = action.emoji;

        const agent = await updateAgent(bucketSlug, action.id, updateData);
        spinner.stop();

        const agentAny = agent as Record<string, unknown>;
        return `✓ Updated agent "${agentAny.agent_name}"`;
      }

      case 'delete_agent': {
        const bucketSlug = getCurrentBucketSlug();
        if (!bucketSlug) {
          return 'Error: No bucket selected.';
        }

        // Get agent details first
        spinner.start('Fetching agent...');
        const agent = await getAgent(bucketSlug, action.id);
        spinner.stop();

        const agentAny = agent as Record<string, unknown>;
        console.log();
        process.stdout.write(chalk.red(`  Delete agent "${agentAny.agent_name}"? (cannot be undone) `));
        const confirmed = await askConfirmation();

        if (!confirmed) {
          return chalk.dim('Cancelled.');
        }

        spinner.start('Deleting agent...');
        await deleteAgent(bucketSlug, action.id);
        spinner.stop();

        return `✓ Deleted agent "${agentAny.agent_name}"`;
      }

      case 'run_agent': {
        const bucketSlug = getCurrentBucketSlug();
        if (!bucketSlug) {
          return 'Error: No bucket selected.';
        }

        // Get agent details first
        spinner.start('Fetching agent...');
        const agent = await getAgent(bucketSlug, action.id);
        spinner.stop();

        const agentAny = agent as Record<string, unknown>;
        console.log();
        process.stdout.write(chalk.yellow(`  Run agent "${agentAny.agent_name}"? `));
        const confirmed = await askConfirmation();

        if (!confirmed) {
          return chalk.dim('Cancelled.');
        }

        spinner.start('Running agent...');
        const execution = await runAgent(bucketSlug, action.id, { prompt: action.prompt });
        spinner.stop();

        const execAny = execution as Record<string, unknown>;
        return `✓ Agent started! Execution ID: ${execAny._id || execAny.id}\n  Status: ${execAny.status}`;
      }

      // ============== WORKFLOWS ==============

      case 'list_workflows': {
        spinner.start('Fetching workflows...');
        const bucketSlug = getCurrentBucketSlug();
        if (!bucketSlug) {
          spinner.stop();
          return 'Error: No bucket selected.';
        }

        const workflows = await listWorkflows(bucketSlug);
        spinner.stop();

        if (workflows.length === 0) {
          return 'No workflows found.';
        }

        let output = `Found ${workflows.length} workflow(s):\n`;
        for (const wf of workflows) {
          const wfAny = wf as Record<string, unknown>;
          const status = wfAny.status === 'active' ? '●' : '○';
          output += `  ${status} ${wfAny.workflow_name} (${wfAny.schedule_type}) - ID: ${wfAny._id || wfAny.id}\n`;
        }
        return output;
      }

      case 'get_workflow': {
        spinner.start('Fetching workflow...');
        const bucketSlug = getCurrentBucketSlug();
        if (!bucketSlug) {
          spinner.stop();
          return 'Error: No bucket selected.';
        }

        const workflow = await getWorkflow(bucketSlug, action.id);
        spinner.stop();

        const wfAny = workflow as Record<string, unknown>;
        let output = `\n⚡ ${wfAny.workflow_name}\n`;
        output += `${'─'.repeat(60)}\n`;
        output += `ID: ${wfAny._id || wfAny.id}\n`;
        output += `Status: ${wfAny.status}\n`;
        output += `Schedule: ${wfAny.schedule_type}\n`;
        if (wfAny.description) {
          output += `Description: ${wfAny.description}\n`;
        }

        const steps = wfAny.steps as Array<Record<string, unknown>> | undefined;
        if (steps && steps.length > 0) {
          output += `\nSteps (${steps.length}):\n`;
          for (let i = 0; i < steps.length; i++) {
            const step = steps[i];
            output += `  ${i + 1}. ${step.step_name} (${step.step_type})\n`;
          }
        }

        const userInputs = wfAny.user_inputs as Array<Record<string, unknown>> | undefined;
        if (userInputs && userInputs.length > 0) {
          output += `\nRequired Inputs:\n`;
          for (const input of userInputs) {
            const required = input.required ? '*' : '';
            output += `  - ${input.key}${required}: ${input.description || input.type}\n`;
          }
        }

        return output;
      }

      case 'create_workflow': {
        const bucketSlug = getCurrentBucketSlug();
        if (!bucketSlug) {
          return 'Error: No bucket selected.';
        }

        console.log();
        process.stdout.write(chalk.yellow(`  Create workflow "${action.name}"? `));
        const confirmed = await askConfirmation();

        if (!confirmed) {
          return chalk.dim('Cancelled.');
        }

        spinner.start('Creating workflow...');
        try {
          const workflowData: Record<string, unknown> = {
            workflow_name: action.name,
            description: action.description || '',
            emoji: action.emoji || '⚡',
            steps: action.steps || [],
            schedule_type: action.schedule_type || 'manual',
            status: action.status || 'draft',
          };

          // Add object types to shared_context if specified
          if (action.object_types && action.object_types.length > 0) {
            workflowData.shared_context = {
              objects: {
                enabled: true,
                object_types: action.object_types,
              },
            };
          }

          const workflow = await createWorkflow(bucketSlug, workflowData as Parameters<typeof createWorkflow>[1]);
          spinner.stop();

          if (!workflow) {
            return 'Error: No response from API';
          }

          const wfAny = workflow as Record<string, unknown>;
          const name = wfAny.workflow_name || wfAny.name || action.name;
          const id = wfAny._id || wfAny.id || 'unknown';
          return `✓ Created workflow "${name}" (ID: ${id})`;
        } catch (err) {
          spinner.stop();
          return `Error creating workflow: ${(err as Error).message}`;
        }
      }

      case 'update_workflow': {
        const bucketSlug = getCurrentBucketSlug();
        if (!bucketSlug) {
          return 'Error: No bucket selected.';
        }

        console.log();
        process.stdout.write(chalk.yellow(`  Update workflow ${action.id}? `));
        const confirmed = await askConfirmation();

        if (!confirmed) {
          return chalk.dim('Cancelled.');
        }

        spinner.start('Updating workflow...');
        const updateData: Record<string, unknown> = {};
        if (action.name) updateData.workflow_name = action.name;
        if (action.description) updateData.description = action.description;
        if (action.steps) updateData.steps = action.steps;
        if (action.status) updateData.status = action.status;
        if (action.schedule_type) updateData.schedule_type = action.schedule_type;

        const workflow = await updateWorkflow(bucketSlug, action.id, updateData);
        spinner.stop();

        const wfAny = workflow as Record<string, unknown>;
        return `✓ Updated workflow "${wfAny.workflow_name}"`;
      }

      case 'delete_workflow': {
        const bucketSlug = getCurrentBucketSlug();
        if (!bucketSlug) {
          return 'Error: No bucket selected.';
        }

        // Get workflow details first
        spinner.start('Fetching workflow...');
        const workflow = await getWorkflow(bucketSlug, action.id);
        spinner.stop();

        const wfAny = workflow as Record<string, unknown>;
        console.log();
        process.stdout.write(chalk.red(`  Delete workflow "${wfAny.workflow_name}"? (cannot be undone) `));
        const confirmed = await askConfirmation();

        if (!confirmed) {
          return chalk.dim('Cancelled.');
        }

        spinner.start('Deleting workflow...');
        await deleteWorkflow(bucketSlug, action.id);
        spinner.stop();

        return `✓ Deleted workflow "${wfAny.workflow_name}"`;
      }

      case 'run_workflow': {
        const bucketSlug = getCurrentBucketSlug();
        if (!bucketSlug) {
          return 'Error: No bucket selected.';
        }

        // Get workflow details first
        spinner.start('Fetching workflow...');
        const workflow = await getWorkflow(bucketSlug, action.id);
        spinner.stop();

        const wfAny = workflow as Record<string, unknown>;
        console.log();
        process.stdout.write(chalk.yellow(`  Run workflow "${wfAny.workflow_name}"? `));
        const confirmed = await askConfirmation();

        if (!confirmed) {
          return chalk.dim('Cancelled.');
        }

        spinner.start('Executing workflow...');
        const execution = await executeWorkflow(bucketSlug, action.id, {
          user_inputs: action.inputs || {},
        });
        spinner.stop();

        const execAny = execution as Record<string, unknown>;
        return `✓ Workflow started! Execution ID: ${execAny._id || execAny.id}\n  Status: ${execAny.status}`;
      }

      // ============== OBJECT TYPES ==============

      case 'list_object_types': {
        spinner.start('Fetching object types...');
        const bucketSlug = getCurrentBucketSlug();
        if (!bucketSlug) {
          spinner.stop();
          return 'Error: No bucket selected.';
        }

        const types = await listObjectTypes(bucketSlug);
        spinner.stop();

        if (types.length === 0) {
          return 'No object types found.';
        }

        let output = `Found ${types.length} object type(s):\n`;
        for (const t of types) {
          const typeAny = t as Record<string, unknown>;
          const emoji = typeAny.emoji || '📄';
          output += `  ${emoji} ${typeAny.title} (${typeAny.slug})\n`;
        }
        return output;
      }

      case 'create_object_type': {
        if (!action.title) {
          return 'Error: Object type title is required.';
        }

        console.log();
        process.stdout.write(chalk.yellow(`  Create object type "${action.title}"? `));
        const confirmed = await askConfirmation();

        if (!confirmed) {
          return chalk.dim('Cancelled.');
        }

        spinner.start('Creating object type...');

        // Use SDK's objectTypes.insertOne() method
        // See: https://www.cosmicjs.com/docs/api/object-types#create-an-object-type
        const sdkClient = getSDKClient();
        if (!sdkClient) {
          spinner.stop();
          return 'Error: SDK client not available.';
        }

        const objectTypeData: Record<string, unknown> = {
          title: action.title,
        };

        // Add optional fields
        if (action.slug) objectTypeData.slug = action.slug;
        if (action.singular) objectTypeData.singular = action.singular;
        if (action.emoji) objectTypeData.emoji = action.emoji;
        if (action.singleton !== undefined) objectTypeData.singleton = action.singleton;

        // Sanitize metafields - fix common AI mistakes
        if (action.metafields && Array.isArray(action.metafields)) {
          objectTypeData.metafields = action.metafields.map((field: Record<string, unknown>) => {
            const sanitized = { ...field };
            // Switch type requires options as string "true,false" or "yes,no"
            if (field.type === 'switch') {
              sanitized.options = 'true,false';
            }
            return sanitized;
          });
        }

        const result = await sdkClient.objectTypes.insertOne(objectTypeData);
        spinner.stop();

        const typeAny = result.object_type as Record<string, unknown>;
        return `✓ Created object type "${typeAny.title}" with slug "${typeAny.slug}"`;
      }

      case 'install_content_model': {
        const objectTypes = action.object_types as Record<string, unknown>[];
        const demoObjects = action.demo_objects as Record<string, unknown>[];

        if (!objectTypes || !Array.isArray(objectTypes) || objectTypes.length === 0) {
          return 'Error: install_content_model requires object_types array.';
        }

        // Show confirmation with summary
        console.log();
        console.log(chalk.yellow(`  Install Content Model:`));
        console.log(chalk.yellow(`    • ${objectTypes.length} object type(s)`));
        if (demoObjects && demoObjects.length > 0) {
          console.log(chalk.yellow(`    • ${demoObjects.length} demo object(s)`));
        }
        console.log();

        // List object types
        for (const ot of objectTypes) {
          const emoji = (ot.emoji as string) || '📄';
          console.log(chalk.yellow(`    ${emoji} ${ot.title}`));
        }

        console.log();
        process.stdout.write(chalk.yellow(`  Proceed? `));
        const confirmed = await askConfirmation();

        if (!confirmed) {
          return chalk.dim('Cancelled.');
        }

        const sdkClient = getSDKClient();
        if (!sdkClient) {
          return 'Error: SDK client not available.';
        }

        const results: string[] = [];
        const createdObjectTypes: Map<string, Record<string, unknown>> = new Map();
        // Track created objects: both expected slug (from AI) and actual slug -> id
        const createdObjects: Map<string, string> = new Map(); // slug -> id mapping
        // Track which demo objects were successfully created with their details
        const successfulObjects: Array<{ original: Record<string, unknown>; created: Record<string, unknown> }> = [];

        // Step 1: Create all object types first (streaming output)
        console.log();
        console.log(chalk.cyan('  Creating object types...'));
        console.log();

        let typesCreated = 0;
        let typesFailed = 0;

        for (const ot of objectTypes) {
          const emoji = (ot.emoji as string) || '📄';
          // Stream the "creating" status
          process.stdout.write(chalk.dim(`  ${emoji} Creating "${ot.title}"...`));

          try {
            const objectTypeData: Record<string, unknown> = {
              title: ot.title,
            };

            if (ot.slug) objectTypeData.slug = ot.slug;
            if (ot.singular) objectTypeData.singular = ot.singular;
            if (ot.emoji) objectTypeData.emoji = ot.emoji;

            // Add IDs to metafields and sanitize
            if (ot.metafields && Array.isArray(ot.metafields)) {
              const metafieldsWithIds = addIdsToMetafields(ot.metafields as Record<string, unknown>[]);
              objectTypeData.metafields = metafieldsWithIds.map((field: Record<string, unknown>) => {
                const sanitized = { ...field };
                // Switch type requires options as string "true,false" or "yes,no"
                if (field.type === 'switch') {
                  sanitized.options = 'true,false';
                }
                return sanitized;
              });
            }

            const result = await sdkClient.objectTypes.insertOne(objectTypeData);

            const typeAny = result.object_type as Record<string, unknown>;
            const slug = typeAny.slug as string;
            createdObjectTypes.set(slug, typeAny);

            // Clear line and show success
            process.stdout.write('\r' + ' '.repeat(60) + '\r');
            console.log(chalk.green(`  ${emoji} ${typeAny.title} `) + chalk.dim(`(${slug})`));
            results.push(`Created object type: ${typeAny.title}`);
            typesCreated++;
          } catch (error) {
            // Clear line and show error
            process.stdout.write('\r' + ' '.repeat(60) + '\r');
            console.log(chalk.red(`  ✗ ${ot.title}: ${(error as Error).message}`));
            results.push(`Failed: ${ot.title} - ${(error as Error).message}`);
            typesFailed++;
          }
        }

        // Show types summary
        console.log();
        if (typesCreated > 0) {
          console.log(chalk.green(`  ✓ ${typesCreated} object type${typesCreated !== 1 ? 's' : ''} created`));
        }
        if (typesFailed > 0) {
          console.log(chalk.red(`  ✗ ${typesFailed} failed`));
        }

        // Step 2: Create demo objects if provided (streaming output)
        if (demoObjects && demoObjects.length > 0) {
          console.log();
          console.log(chalk.cyan('  Creating demo content...'));
          console.log();

          let objectsCreated = 0;
          let objectsFailed = 0;

          // Sort demo objects: create objects without references first
          // (categories, authors before posts that reference them)
          const sortedDemoObjects = [...demoObjects].sort((a, b) => {
            const aType = createdObjectTypes.get(a.type as string);
            const bType = createdObjectTypes.get(b.type as string);

            // Count object/objects references in metafields
            const countRefs = (ot: Record<string, unknown> | undefined) => {
              if (!ot?.metafields) return 0;
              return (ot.metafields as Record<string, unknown>[]).filter(
                (m) => m.type === 'object' || m.type === 'objects'
              ).length;
            };

            return countRefs(aType) - countRefs(bType);
          });

          for (const obj of sortedDemoObjects) {
            const typeSlug = obj.type as string;
            const objectType = createdObjectTypes.get(typeSlug);

            if (!objectType) {
              console.log(chalk.yellow(`  ⚠ Skipping "${obj.title}" - object type "${typeSlug}" not found`));
              continue;
            }

            // Stream the "creating" status
            process.stdout.write(chalk.dim(`  📝 Creating "${obj.title}"...`));

            try {
              // Process Unsplash URLs in thumbnail and metadata
              const metafields = (objectType.metafields as Record<string, unknown>[]) || [];
              await processUnsplashUrls(obj, sdkClient, metafields);

              // Build the object data
              const insertPayload: Record<string, unknown> = {
                type: typeSlug,
                title: obj.title,
              };

              if (obj.slug) insertPayload.slug = obj.slug;
              if (obj.thumbnail) insertPayload.thumbnail = obj.thumbnail;

              // Process metadata - resolve object references
              if (obj.metadata && typeof obj.metadata === 'object') {
                const metadata = { ...(obj.metadata as Record<string, unknown>) };

                // For now, we'll just use the metadata as-is
                // Object references will be resolved by slug after all objects are created
                insertPayload.metadata = metadata;
              }

              const result = await sdkClient.objects.insertOne(insertPayload);

              const createdObj = result.object as Record<string, unknown>;
              const actualSlug = createdObj.slug as string;
              const id = createdObj.id as string;

              // Store for reference resolution - map multiple possible slugs to the ID
              createdObjects.set(actualSlug, id);

              // Also map the expected slug (from AI) if different
              const expectedSlug = obj.slug as string;
              if (expectedSlug && expectedSlug !== actualSlug) {
                createdObjects.set(expectedSlug, id);
              }

              // Also map a slugified version of the title
              const titleSlug = (obj.title as string).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
              if (titleSlug && titleSlug !== actualSlug) {
                createdObjects.set(titleSlug, id);
              }

              // Track for reference resolution
              successfulObjects.push({ original: obj, created: createdObj });

              // Clear line and show success
              process.stdout.write('\r' + ' '.repeat(60) + '\r');
              console.log(chalk.green(`  ✓ ${createdObj.title} `) + chalk.dim(`(${typeSlug})`));
              results.push(`Created object: ${createdObj.title}`);
              objectsCreated++;
            } catch (error) {
              // Clear line and show error
              process.stdout.write('\r' + ' '.repeat(60) + '\r');
              console.log(chalk.red(`  ✗ ${obj.title}: ${(error as Error).message}`));
              results.push(`Failed: ${obj.title} - ${(error as Error).message}`);
              objectsFailed++;
            }
          }

          // Show objects summary
          console.log();
          if (objectsCreated > 0) {
            console.log(chalk.green(`  ✓ ${objectsCreated} object${objectsCreated !== 1 ? 's' : ''} created`));
          }
          if (objectsFailed > 0) {
            console.log(chalk.red(`  ✗ ${objectsFailed} failed`));
          }

          // Step 3: Resolve object references (update objects with proper IDs)
          if (successfulObjects.length > 0) {
            const objectsWithRefs = successfulObjects.filter(({ original }) => {
              const typeSlug = original.type as string;
              const objectType = createdObjectTypes.get(typeSlug);
              if (!objectType || !original.metadata) return false;
              const metafields = (objectType.metafields as Record<string, unknown>[]) || [];
              return metafields.some((m) => m.type === 'object' || m.type === 'objects');
            });

            if (objectsWithRefs.length > 0) {
              console.log();
              console.log(chalk.cyan('  Resolving references...'));

              let refsUpdated = 0;
              for (const { original, created } of objectsWithRefs) {
                const typeSlug = original.type as string;
                const objectType = createdObjectTypes.get(typeSlug);

                if (!objectType || !original.metadata) continue;

                const metafields = (objectType.metafields as Record<string, unknown>[]) || [];
                const refMetafields = metafields.filter(
                  (m) => m.type === 'object' || m.type === 'objects'
                );

                if (refMetafields.length === 0) continue;

                const metadata = original.metadata as Record<string, unknown>;
                const updates: Record<string, unknown> = {};
                let hasUpdates = false;

                for (const metafield of refMetafields) {
                  const key = metafield.key as string;
                  const value = metadata[key];

                  if (!value) continue;

                  if (metafield.type === 'object' && typeof value === 'string') {
                    // Single object reference - convert slug to ID
                    const refId = createdObjects.get(value);
                    if (refId) {
                      updates[key] = refId;
                      hasUpdates = true;
                    }
                  } else if (metafield.type === 'objects' && Array.isArray(value)) {
                    // Multiple object references - convert slugs to IDs
                    const refIds = value
                      .map((slug: string) => createdObjects.get(slug))
                      .filter(Boolean);
                    if (refIds.length > 0) {
                      updates[key] = refIds;
                      hasUpdates = true;
                    }
                  }
                }

                if (hasUpdates) {
                  const objId = created.id as string;
                  const objTitle = created.title as string;

                  try {
                    await sdkClient.objects.updateOne(objId, { metadata: updates });
                    refsUpdated++;
                  } catch {
                    console.log(chalk.yellow(`  ⚠ Could not update references for "${objTitle}"`));
                  }
                }
              }

              if (refsUpdated > 0) {
                console.log(chalk.dim(`  ✓ Updated ${refsUpdated} reference${refsUpdated !== 1 ? 's' : ''}`));
              }
            }
          }
        }

        console.log();
        const totalTypes = createdObjectTypes.size;
        const totalObjects = successfulObjects.length;
        return `✓ Content model installed: ${totalTypes} object type${totalTypes !== 1 ? 's' : ''}${totalObjects > 0 ? `, ${totalObjects} object${totalObjects !== 1 ? 's' : ''}` : ''}`;
      }

      case 'list_repositories': {
        const { repositories } = await api.listRepositories(bucketSlug);

        if (repositories.length === 0) {
          return 'No repositories connected. Use `cosmic repos connect` to add one.';
        }

        let result = `Found ${repositories.length} repository(ies):\n\n`;
        for (const repo of repositories) {
          result += `• ${repo.repository_name} (${repo.framework || 'other'})\n`;
          result += `  ID: ${repo.id}\n`;
          result += `  URL: ${repo.repository_url}\n`;
          if (repo.production_url) {
            result += `  Production: ${repo.production_url}\n`;
          }
          result += '\n';
        }
        return result;
      }

      case 'deploy_repository': {
        const repositoryId = action.repository_id as string;
        if (!repositoryId) {
          return 'Error: deploy_repository requires repository_id.';
        }

        console.log();
        console.log(chalk.yellow(`  Deploying repository...`));

        const result = await api.deployRepository(bucketSlug, repositoryId);

        if (!result.success) {
          return 'Error: Failed to deploy repository';
        }

        let response = '✓ Deployment started';
        if (result.deployment_url) {
          response += `\n  URL: ${result.deployment_url}`;
        }
        return response;
      }

      default:
        return `Unknown action: ${action.action}`;
    }
  } catch (error) {
    return `Error: ${(error as Error).message}`;
  }
}

/**
 * Process a chat message using the SDK
 * Returns true if the AI wants to continue (e.g., creating more items)
 */
async function processMessage(
  model: string,
  rl: readline.Interface,
  bucketSlug: string
): Promise<boolean> {
  const sdk = getSDKClient();
  if (!sdk) {
    throw new Error('SDK client not available. Check your bucket configuration.');
  }

  // Regular chat now uses streaming, but build/repo modes have their own status messages

  try {
    // Build messages for the SDK with system prompt
    const systemPrompt = getSystemPrompt(bucketSlug);
    const messagesWithSystem = [
      { role: 'user' as const, content: systemPrompt + '\n\n' + conversationHistory[0]?.content },
      ...conversationHistory.slice(1).map(msg => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      })),
    ];

    // Debug logging
    const verbose = process.env.COSMIC_DEBUG === '1' || process.env.COSMIC_DEBUG === '2';
    if (verbose) {
      const { bucketSlug: sdkBucket, readKey, writeKey } = getBucketKeys();

      console.log(chalk.dim('  [DEBUG] SDK Configuration:'));
      console.log(chalk.dim(`    Bucket Slug: ${sdkBucket}`));
      console.log(chalk.dim(`    Read Key: ${readKey ? readKey.substring(0, 8) + '...' : 'NOT SET'}`));
      console.log(chalk.dim(`    Write Key: ${writeKey ? writeKey.substring(0, 8) + '...' : 'NOT SET'}`));
      console.log(chalk.dim(`    API Environment: ${getApiEnv()}`));

      console.log(chalk.dim('  [DEBUG] Request Payload:'));
      console.log(chalk.dim(`    Model: ${model}`));
      console.log(chalk.dim(`    Max Tokens: ${isBuildMode ? '32000' : '16384'}${isBuildMode ? ' (build mode, streaming)' : ''}`));
      console.log(chalk.dim(`    Messages Count: ${messagesWithSystem.length}`));
      console.log(chalk.dim(`    System prompt length: ${systemPrompt.length} chars`));
      console.log(chalk.dim(`    User message: "${conversationHistory[0]?.content?.substring(0, 100)}${(conversationHistory[0]?.content?.length || 0) > 100 ? '...' : ''}"`));
      console.log(chalk.dim(`    Total payload size: ${JSON.stringify(messagesWithSystem).length} chars`));

      // Show more details if COSMIC_DEBUG=2
      if (process.env.COSMIC_DEBUG === '2') {
        console.log(chalk.dim('  [DEBUG] System prompt preview (first 500 chars):'));
        console.log(chalk.dim('    ' + systemPrompt.substring(0, 500).replace(/\n/g, '\n    ') + '...'));
        console.log(chalk.dim(`  [DEBUG] Full SDK ${isBuildMode ? 'stream' : 'generateText'} call:`));
        console.log(chalk.dim('    ' + JSON.stringify({ model, max_tokens: isBuildMode ? 32000 : 16384, stream: isBuildMode, messagesCount: messagesWithSystem.length })));
      }
    }

    // Use SDK to generate text
    // In build mode: use Dashboard API with build-app prompt (streaming, 32000 tokens)
    // In normal mode: use SDK API with 16384 tokens for faster responses
    const maxTokens = isBuildMode ? 32000 : 16384;

    let response: { text: string; usage?: { input_tokens: number; output_tokens: number }; messageId?: string };

    try {
      if (isBuildMode) {
        // Use Dashboard API for build mode - this uses the backend's sophisticated build-app prompt
        // Fetch object types so the AI knows the bucket's content structure
        let objectTypeSlugs: string[] = [];
        try {
          const objectTypes = await api.listObjectTypes(bucketSlug);
          objectTypeSlugs = objectTypes.map((ot: { slug: string }) => ot.slug);
          if (verbose) {
            console.log(chalk.dim(`  [DEBUG] Found ${objectTypeSlugs.length} object types: ${objectTypeSlugs.join(', ')}`));
          }
        } catch (err) {
          // Continue without object types if fetch fails
          if (verbose) {
            console.log(chalk.dim(`  [DEBUG] Could not fetch object types: ${(err as Error).message}`));
          }
        }

        spinner.stop();
        console.log(chalk.dim(isAskMode ? '  Thinking...' : '  Generating app...'));
        console.log();

        // Convert messages to Dashboard API format (content as array)
        const dashboardMessages = conversationHistory.map((msg) => ({
          role: msg.role as 'user' | 'assistant',
          content: [{ type: 'text' as const, text: msg.content }],
        }));

        // Track file progress during streaming
        let fileCount = 0;
        let currentFile = '';
        let fullText = '';
        let isGeneratingFiles = false;
        let lastPrintedLength = 0;
        let hasShownOverview = false;
        let overviewPrinted = 0;

        const result = await api.streamingChat({
          messages: dashboardMessages,
          bucketSlug,
          model,
          maxTokens,
          viewMode: 'build-app',
          selectedObjectTypes: objectTypeSlugs, // Include bucket's object types for context
          links: chatContext.links, // Pass links to backend for crawling
          metadata: {
            chat_mode: isAskMode ? 'ask' : 'agent', // Ask mode = educational answers only, no code generation
          },
          onChunk: (chunk) => {
            fullText += chunk;

            // Detect new file being generated (look for ```lang\n// path/to/file patterns)
            const fileStartMatch = fullText.match(/```\w*\n\/\/\s*([^\n]+)/g);
            if (fileStartMatch && fileStartMatch.length > fileCount) {
              // New file detected - switch to file progress mode
              if (!isGeneratingFiles) {
                isGeneratingFiles = true;
                console.log(); // New line before file list
              }

              const lastMatch = fileStartMatch[fileStartMatch.length - 1];
              const fileNameMatch = lastMatch.match(/\/\/\s*(.+)/);
              if (fileNameMatch) {
                const newFile = fileNameMatch[1].trim();
                if (newFile !== currentFile) {
                  currentFile = newFile;
                  fileCount = fileStartMatch.length;

                  // Show the file being generated
                  process.stdout.write(`\r${' '.repeat(60)}\r`); // Clear line
                  console.log(chalk.dim(`  📄 ${newFile}`));
                }
              }
            } else if (!isGeneratingFiles) {
              // Check if this is structured app output (has markers) or conversational response
              const hasAppMarkers = fullText.includes('<!-- APP_OVERVIEW_START -->') ||
                fullText.includes('<!-- METADATA:') ||
                fullText.includes('<!-- README_START -->');

              if (hasAppMarkers) {
                // Structured app output - only show content between APP_OVERVIEW_START and APP_OVERVIEW_END
                const overviewStart = fullText.indexOf('<!-- APP_OVERVIEW_START -->');
                const overviewEnd = fullText.indexOf('<!-- APP_OVERVIEW_END -->');

                if (overviewStart !== -1 && !hasShownOverview) {
                  // Extract and show only the overview content
                  const startPos = overviewStart + '<!-- APP_OVERVIEW_START -->'.length;
                  const endPos = overviewEnd !== -1 ? overviewEnd : fullText.length;
                  const overviewContent = fullText.slice(startPos, endPos);

                  // Show new content since last print
                  if (overviewContent.length > overviewPrinted) {
                    const newContent = overviewContent.slice(overviewPrinted);
                    // Filter out PROGRESS markers and json code blocks following them
                    const filteredContent = newContent
                      .replace(/<!-- PROGRESS:[^>]+-->\s*```json\s*\/\/[^`]*```/g, '')
                      .replace(/<!-- PROGRESS:[^>]+-->/g, '')
                      .replace(/<!-- METADATA:[^>]+-->/g, '')
                      .replace(/<!-- FRAMEWORK:[^>]+-->/g, '');
                    if (filteredContent.trim()) {
                      process.stdout.write(filteredContent);
                    }
                    overviewPrinted = overviewContent.length;
                  }

                  if (overviewEnd !== -1) {
                    hasShownOverview = true;
                    console.log();
                  }
                  lastPrintedLength = fullText.length;
                } else if (overviewStart === -1) {
                  // Has markers but no overview yet - wait for it
                  lastPrintedLength = fullText.length;
                }
              } else {
                // No app markers - stream normally (conversational response like questions)
                const newContent = fullText.slice(lastPrintedLength);
                if (newContent) {
                  process.stdout.write(newContent);
                  lastPrintedLength = fullText.length;
                }
              }
            }
          },
          onProgress: (progress) => {
            if (verbose && progress.message) {
              console.log(chalk.dim(`  [PROGRESS] ${progress.stage}: ${progress.message}`));
            }
          },
        });

        // Track if we already streamed the text (for non-file responses)
        const alreadyStreamedText = !isGeneratingFiles && lastPrintedLength > 0;

        // Add newline after streaming text if we weren't generating files
        if (alreadyStreamedText) {
          console.log();
          console.log();
        }

        // Show summary if files were generated
        if (fileCount > 0) {
          console.log();
          console.log(chalk.green(`  ✓ Generated ${fileCount} file(s)`));
        }

        response = {
          text: result.text,
          messageId: result.messageId,
          usage: undefined, // Dashboard API doesn't return usage in same format
          _alreadyStreamed: alreadyStreamedText, // Flag to skip duplicate display
        };
      } else if (isRepoMode && currentRepo) {
        // Use streamingRepositoryUpdate for repository update mode
        spinner.stop();
        console.log(chalk.dim('  Analyzing and updating repository...'));

        // Convert messages to the format expected by streamingRepositoryUpdate
        const repoMessages = conversationHistory.map((msg) => ({
          role: msg.role as 'user' | 'assistant',
          content: msg.content,
        }));

        // Track progress during streaming
        let fullText = '';
        let lastPrintedLength = 0;
        let fileCount = 0;
        let currentFile = '';
        let isEditingFiles = false;

        const result = await streamingRepositoryUpdate({
          repositoryOwner: currentRepo.owner,
          repositoryName: currentRepo.name,
          repositoryId: currentRepo.id,
          bucketSlug,
          messages: repoMessages,
          branch: currentRepo.branch,
          model,
          maxTokens: 32000,
          chatMode: isAskMode ? 'ask' : 'agent',  // Pass chat mode to backend
          onChunk: (chunk) => {
            // Skip empty chunks
            if (!chunk) return;

            fullText += chunk;

            // Debug: log raw chunks if COSMIC_DEBUG=2
            if (process.env.COSMIC_DEBUG === '2') {
              console.log(chalk.dim(`[CHUNK] "${chunk.replace(/\n/g, '\\n')}"`));
            }

            // Detect file edits (look for patterns like "## Editing file:" or ```diff patterns)
            const fileEditMatch = fullText.match(/(?:##\s*(?:Editing|Creating|Modifying|Updating)\s*(?:file:?)?\s*`?([^`\n]+)`?|```(?:diff|typescript|javascript|tsx|jsx)\s*\n\/\/\s*([^\n]+))/gi);
            if (fileEditMatch && fileEditMatch.length > fileCount) {
              if (!isEditingFiles) {
                isEditingFiles = true;
              }

              const lastMatch = fileEditMatch[fileEditMatch.length - 1];
              // Extract filename from various patterns
              let newFile = '';
              const headerMatch = lastMatch.match(/(?:Editing|Creating|Modifying|Updating)\s*(?:file:?)?\s*`?([^`\n]+)`?/i);
              const commentMatch = lastMatch.match(/\/\/\s*(.+)/);

              if (headerMatch) {
                newFile = headerMatch[1].trim();
              } else if (commentMatch) {
                newFile = commentMatch[1].trim();
              }

              if (newFile && newFile !== currentFile) {
                currentFile = newFile;
                fileCount = fileEditMatch.length;
                console.log(chalk.dim(`  📝 ${newFile}`));
              }
            } else if (!isEditingFiles) {
              // Stream the text response in real-time
              const newContent = fullText.slice(lastPrintedLength);
              if (newContent) {
                // Replace excessive newlines with max 2
                const cleanContent = newContent.replace(/\n{2,}/g, '\n');
                if (cleanContent.trim() || (cleanContent === '\n' && lastPrintedLength > 0)) {
                  process.stdout.write(cleanContent.trim() ? cleanContent : '');
                }
                lastPrintedLength = fullText.length;
              }
            }
          },
          onProgress: (progress) => {
            if (verbose && progress.message) {
              console.log(chalk.dim(`  [PROGRESS] ${progress.stage}: ${progress.message}`));
            }
            // Show commit progress
            if (progress.stage === 'committing' || progress.stage === 'pushing') {
              process.stdout.write(`\r${' '.repeat(60)}\r`);
              console.log(chalk.dim(`  🔄 ${progress.message || progress.stage}...`));
            }
          },
        });

        // Track if we already streamed the text
        const alreadyStreamedText = !isEditingFiles && lastPrintedLength > 0;

        if (alreadyStreamedText) {
          console.log(); // Single newline after streamed content
        }

        // Show summary
        if (fileCount > 0) {
          console.log(chalk.green(`  ✓ Updated ${fileCount} file(s)`));
          console.log(chalk.dim(`  Changes pushed to ${currentRepo.owner}/${currentRepo.name}`));
        }

        response = {
          text: result.text,
          messageId: result.requestId,
          usage: undefined,
          _alreadyStreamed: alreadyStreamedText,
        };

        // Always poll for deployment status after repo update
        // (The AI pushes changes automatically, so check for deployment)
        console.log();
        console.log(chalk.yellow('  Checking for Vercel deployment...'));

        // Give Vercel a moment to detect the push
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Poll deployment status and offer AI fix loop until success or user declines
        let keepFixing = true;
        while (keepFixing) {
          try {
            const deployResult = await pollDeploymentStatus(
              bucketSlug,
              currentRepo.name, // Use repo name as vercel project ID
              `https://github.com/${currentRepo.owner}/${currentRepo.name}`
            );

            // If deployment succeeded, exit the loop
            if (deployResult.success) {
              keepFixing = false;
              break;
            }

            // If deployment failed and we have logs, offer to fix with AI
            if (!deployResult.success && deployResult.logs && deployResult.logs.length > 0) {
              console.log();
              console.log(chalk.yellow('  Would you like AI to analyze the logs and fix the build error?'));
              const fixInput = await sharedAskLine!(chalk.yellow('  Fix with AI? [Y/n]: '));
              const fixWithAI = fixInput.toLowerCase() !== 'n';

              if (!fixWithAI) {
                keepFixing = false;
                break;
              }

              console.log();
              console.log(chalk.cyan('  Sending build logs to AI for analysis...'));
              console.log();

              // Format logs as text for the AI (filter out any logs with missing text)
              const logsText = deployResult.logs
                .filter(log => log.text && typeof log.text === 'string')
                .map(log => `[${log.type}] ${log.text}`)
                .join('\n');

              const userMessage = `The deployment failed with the following build logs. Please analyze the errors and fix the code:\n\n\`\`\`\n${logsText || 'No logs available'}\n\`\`\``;

              try {
                await streamingRepositoryUpdate({
                  repositoryOwner: currentRepo.owner,
                  repositoryName: currentRepo.name,
                  repositoryId: currentRepo.id,
                  bucketSlug,
                  messages: [{
                    role: 'user',
                    content: userMessage,
                  }],
                  onChunk: (chunk) => {
                    process.stdout.write(chunk);
                  },
                  onComplete: () => {
                    console.log();
                    console.log();
                    console.log(chalk.green('  ✓ AI has pushed fixes to the repository.'));
                    console.log(chalk.dim('  Vercel will automatically redeploy with the fixes.'));
                    console.log();
                  },
                  onError: (error) => {
                    console.log(chalk.red(`  ✗ AI fix failed: ${error.message}`));
                    console.log();
                  },
                });

                // Wait a moment for Vercel to pick up the new commit, then poll again
                console.log(chalk.dim('  Waiting for new deployment to start...'));
                await new Promise(resolve => setTimeout(resolve, 10000));
                // Loop will poll again for the new deployment
              } catch (aiError) {
                console.log(chalk.red(`  ✗ Failed to fix with AI: ${(aiError as Error).message}`));
                console.log();
                keepFixing = false;
              }
            } else if (!deployResult.success && !deployResult.error) {
              // Timeout or other non-error failure without logs
              console.log(chalk.dim('  Deployment is still in progress. Check Vercel dashboard for status.'));
              keepFixing = false;
            } else {
              // Some other failure case
              keepFixing = false;
            }
          } catch (err) {
            // Deployment polling failed - not critical, repo update succeeded
            if (verbose) {
              console.log(chalk.dim(`  [DEBUG] Deployment poll error: ${(err as Error).message}`));
            }
            console.log(chalk.dim('  Could not check deployment status. Changes were pushed to the repository.'));
            keepFixing = false;
          }
        }

        // Check if AI response contains content to add to Cosmic CMS
        const extractedContent = extractContentFromResponse(fullText);
        if (extractedContent.hasAddContent && (extractedContent.objectTypes.length > 0 || extractedContent.demoObjects.length > 0)) {
          const result = await installContentToCosmic(sdk, extractedContent, rl);
          if (result.nextAction === 'build') {
            isBuildMode = true;
            isRepoMode = false;
            currentRepo = null;
            console.log();
            console.log(chalk.green('  Switching to build mode...'));
            console.log();
            console.log(chalk.cyan('  Describe the app you\'d like to build:'));
          } else if (result.nextAction === 'exit') {
            console.log(chalk.dim('  Goodbye!'));
            rl.close();
            return;
          }
        } else {
          // Check if AI mentioned Cosmic content but didn't include metadata markers
          // This happens when AI explains what needs to be done but doesn't generate the content
          const cosmicContentMentioned = detectCosmicContentMention(fullText);
          if (cosmicContentMentioned) {
            // Offer to generate the content
            await offerContentGeneration(sdk, fullText, conversationHistory, model, bucketSlug, rl);
          }
        }
      } else {
        // Use streaming for regular chat
        // Convert messages to the format expected by streamingChat
        const dashboardMessages = conversationHistory.map((msg) => ({
          role: msg.role as 'user' | 'assistant',
          content: [{ type: 'text' as const, text: msg.content }],
        }));

        let fullText = '';
        let lastPrintedLength = 0;
        let isContentModelMode = false;
        let dotCount = 0;
        let loadingInterval: NodeJS.Timeout | null = null;

        // Check if the user message suggests content model creation
        const lastUserMessage = conversationHistory[conversationHistory.length - 1]?.content?.toLowerCase() || '';
        const isLikelyContentModel = lastUserMessage.includes('content model') ||
          lastUserMessage.includes('object type') ||
          lastUserMessage.includes('install_content_model');

        // Start loading indicator for likely content model requests
        if (isLikelyContentModel) {
          console.log();
          process.stdout.write(chalk.dim('  Generating content model'));
          loadingInterval = setInterval(() => {
            dotCount = (dotCount + 1) % 4;
            process.stdout.write('\r' + chalk.dim('  Generating content model' + '.'.repeat(dotCount + 1).padEnd(4)));
          }, 400);
        } else {
          console.log(); // New line before streaming output
        }

        // Build context configuration for the backend
        const contextConfig = chatContext.objectTypes && chatContext.objectTypes.length > 0 ? {
          objects: {
            enabled: true,
            object_types: chatContext.objectTypes,
            include_models: true,
            limit: chatContext.objectsLimit || 10,
            props: ['id', 'title', 'slug', 'metadata', 'content'],
          },
        } : undefined;

        const result = await api.streamingChat({
          messages: dashboardMessages,
          bucketSlug,
          model,
          maxTokens,
          viewMode: 'content-model',
          selectedObjectTypes: chatContext.objectTypes || [],
          links: chatContext.links, // Pass links to backend for crawling
          contextConfig,
          metadata: {
            chat_mode: isAskMode ? 'ask' : isContentMode ? 'content' : 'agent',
          },
          onChunk: (chunk) => {
            fullText += chunk;

            // Detect content model output (METADATA markers or ACTION:)
            if (!isContentModelMode) {
              if (containsMetadataMarker(fullText) || fullText.includes('ACTION:')) {
                isContentModelMode = true;

                // Print any remaining clean content before the marker
                const cleanText = cleanResponseForDisplay(fullText);
                const newContent = cleanText.slice(lastPrintedLength);
                if (newContent) {
                  process.stdout.write(newContent);
                  lastPrintedLength = cleanText.length;
                }
                return;
              }
            }

            // Skip streaming if in content model mode
            if (isContentModelMode || isLikelyContentModel) {
              return;
            }

            // Stream the text response in real-time for non-content-model responses
            // Clean the text to remove any METADATA artifacts
            const cleanText = cleanResponseForDisplay(fullText);
            const newContent = cleanText.slice(lastPrintedLength);
            if (newContent) {
              process.stdout.write(newContent);
              lastPrintedLength = cleanText.length;
            }
          },
        });

        // Clear loading interval
        if (loadingInterval) {
          clearInterval(loadingInterval);
          process.stdout.write('\r' + ' '.repeat(40) + '\r'); // Clear the loading line
        }

        // Track if we already streamed the text
        const alreadyStreamedText = lastPrintedLength > 0 && !isContentModelMode;

        if (alreadyStreamedText) {
          console.log(); // New line after streamed content
        }

        response = {
          text: result.text,
          messageId: result.messageId,
          usage: undefined,
          _alreadyStreamed: alreadyStreamedText || isContentModelMode,
        };

        // Check if AI response contains content to add to Cosmic CMS (metadata marker format)
        const extractedContent = extractContentFromResponse(fullText);
        if (extractedContent.hasAddContent && (extractedContent.objectTypes.length > 0 || extractedContent.demoObjects.length > 0)) {
          const contentResult = await installContentToCosmic(sdk, extractedContent, rl);
          if (contentResult.nextAction === 'build') {
            isBuildMode = true;
            console.log();
            console.log(chalk.green('  Switching to build mode...'));
            console.log();
            console.log(chalk.cyan('  Describe the app you\'d like to build:'));
          } else if (contentResult.nextAction === 'exit') {
            console.log(chalk.dim('  Goodbye!'));
            rl.close();
            return;
          }
        } else if (!isContentModelMode && !alreadyStreamedText && fullText.trim()) {
          // If we didn't stream and it's not content model, show the response now
          // Clean METADATA markers from the response
          const cleanText = cleanResponseForDisplay(fullText);
          if (cleanText.trim()) {
            console.log();
            console.log(formatResponse(cleanText.trim()));
          }
        }
      }
    } catch (apiError) {
      const err = apiError as Error & { response?: { data?: unknown }; cause?: unknown };

      // Always log the full error in debug mode
      if (verbose) {
        console.log(chalk.dim('  [DEBUG] API Error Details:'));
        console.log(chalk.dim(`    Message: ${err.message}`));
        console.log(chalk.dim(`    Name: ${err.name}`));
        if (err.response?.data) {
          console.log(chalk.dim(`    Response Data: ${JSON.stringify(err.response.data, null, 2)}`));
        }
        if (err.cause) {
          console.log(chalk.dim(`    Cause: ${JSON.stringify(err.cause, null, 2)}`));
        }
        // Log the full error object
        console.log(chalk.dim(`    Full Error: ${JSON.stringify(err, Object.getOwnPropertyNames(err), 2)}`));
      }

      // Check for token limit error
      if (err.message?.includes('token usage limit')) {
        console.log();
        console.log(chalk.red('✗ AI Token Limit Reached'));
        console.log(chalk.dim('  Your AI token usage limit has been exceeded.'));
        console.log(chalk.dim(`  Model "${model}" uses 2x pricing tier.`));
        console.log();
        console.log(chalk.yellow('  Options:'));
        console.log(chalk.dim('  1. Wait for your token quota to reset'));
        console.log(chalk.dim('  2. Use a less expensive model with: cosmic config set defaultModel <model>'));
        console.log(chalk.dim('  3. Upgrade your plan at https://app.cosmicjs.com/account/billing'));
        console.log();

        // Remove the failed message from history
        conversationHistory.pop();
        return;
      }

      throw apiError;
    }

    // Print assistant response
    if (response.text) {
      // Check for ACTION commands in the response
      // Support multi-line JSON by extracting the full JSON object
      let displayText = '';
      let actionResults: string[] = [];
      let actionExecuted = false;

      // Find ACTION: in the response and extract the full JSON
      const actionIndex = response.text.indexOf('ACTION:');
      if (actionIndex !== -1 && !actionExecuted) {
        // Extract JSON starting after "ACTION:"
        const afterAction = response.text.substring(actionIndex + 7).trim();

        // Find the start of JSON (first { or [)
        const jsonStartIndex = afterAction.search(/[{[]/);
        if (jsonStartIndex !== -1) {
          const jsonStart = afterAction.substring(jsonStartIndex);

          // Use brace matching to find the complete JSON object
          let braceCount = 0;
          let bracketCount = 0;
          let inString = false;
          let escapeNext = false;
          let jsonEndIndex = -1;

          for (let i = 0; i < jsonStart.length; i++) {
            const char = jsonStart[i];

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
                jsonEndIndex = i + 1;
                break;
              }
            }
          }

          if (jsonEndIndex !== -1) {
            const actionJson = jsonStart.substring(0, jsonEndIndex);
            const result = await executeAction(actionJson);
            actionResults.push(result);
            actionExecuted = true;

            // Build displayText excluding the ACTION: line and its JSON content
            // Find where the JSON ends in the original response
            const actionEndInOriginal = actionIndex + 7 + jsonStartIndex + jsonEndIndex;
            displayText = response.text.substring(0, actionIndex) + response.text.substring(actionEndInOriginal);
          } else {
            // Fallback: couldn't find complete JSON, try single-line parsing
            const firstLine = afterAction.split('\n')[0];
            try {
              const result = await executeAction(firstLine);
              actionResults.push(result);
              actionExecuted = true;
            } catch {
              // JSON parsing failed
              actionResults.push(`Error: Could not parse ACTION JSON - ${(firstLine || '').substring(0, 100)}...`);
            }
            // Exclude the ACTION line from display
            displayText = response.text.split('\n').filter(line => !line.trim().startsWith('ACTION:')).join('\n');
          }
        } else {
          // No JSON found after ACTION:
          displayText = response.text.split('\n').filter(line => !line.trim().startsWith('ACTION:')).join('\n');
        }
      } else {
        // No ACTION: found, display all text
        displayText = response.text;
      }

      // Clean METADATA markers from display text
      displayText = cleanResponseForDisplay(displayText);

      // Check for app build completion (FRAMEWORK and APP_NAME markers)
      const appMetadata = extractAppMetadata(response.text);
      const buildFiles = appMetadata.framework && appMetadata.appName ? parseCodeBlocks(response.text) : {};
      const buildFileCount = Object.keys(buildFiles).length;
      const isAppBuild = buildFileCount > 0;

      // Print the response text (without ACTION lines)
      // In build mode with files, we skip showing all the code content
      // Also skip if we already streamed the text in build mode
      const alreadyStreamed = (response as { _alreadyStreamed?: boolean })._alreadyStreamed;
      if (displayText.trim() && !isAppBuild && !alreadyStreamed) {
        console.log();
        console.log(formatResponse(displayText.trim()));
      } else if (isAppBuild) {
        // In build mode, just show a brief intro if there's text before the code
        const introText = displayText.split('```')[0].trim();
        if (introText && introText.length > 10) {
          console.log();
          // Only show first paragraph or so
          const firstParagraph = introText.split('\n\n')[0];
          if (firstParagraph) {
            console.log(formatResponse(firstParagraph));
          }
        }
      }

      // Print action results
      for (const result of actionResults) {
        console.log();
        console.log(chalk.green(result));
      }

      console.log();

      // Handle app build completion
      if (isAppBuild) {
        console.log();
        console.log(chalk.cyan(`  🚀 App Generated: ${appMetadata.appName}`));
        console.log(chalk.dim(`     Framework: ${appMetadata.framework}`));
        console.log(chalk.dim(`     Files: ${buildFileCount}`));
        console.log();

        // List first few files (if not already shown during streaming)
        const fileNames = Object.keys(buildFiles);
        const filesToShow = fileNames.slice(0, 5);
        for (const fileName of filesToShow) {
          console.log(chalk.dim(`     📄 ${fileName}`));
        }
        if (fileNames.length > 5) {
          console.log(chalk.dim(`     ... and ${fileNames.length - 5} more files`));
        }
        console.log();

        // Prompt for deployment options using the shared input function
        try {
          const defaultName = appMetadata.appName;
          let repoName = '';

          // Loop until we have an available repo name
          while (true) {
            const repoNameInput = await sharedAskLine!(chalk.yellow(`  Repository name [${defaultName}]: `));
            repoName = repoNameInput.trim() || defaultName;

            // Convert to slug format (lowercase, hyphens)
            const repoSlug = repoName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

            // Check repo availability
            console.log(chalk.dim(`  Checking availability...`));
            try {
              const availability = await api.checkRepoAvailability(repoSlug);

              if (availability.github_repository?.available) {
                repoName = repoSlug;
                console.log(chalk.green(`  ✓ Repository name "${repoSlug}" is available`));
                break;
              } else {
                console.log(chalk.yellow(`  ✗ ${availability.github_repository?.message || 'Repository name not available'}`));

                // Show suggestions if available
                if (availability.github_repository?.suggestions && availability.github_repository.suggestions.length > 0) {
                  console.log(chalk.dim(`  Suggestions: ${availability.github_repository.suggestions.join(', ')}`));
                }
                console.log();
                // Loop back to ask for a new name
              }
            } catch (checkError) {
              // If check fails, proceed anyway and let deploy handle it
              if (verbose) {
                console.log(chalk.dim(`  [DEBUG] Availability check failed: ${(checkError as Error).message}`));
              }
              repoName = repoSlug;
              break;
            }
          }

          const privateInput = await sharedAskLine!(chalk.yellow(`  Private repository? [y/N]: `));
          const isPrivate = privateInput.toLowerCase() === 'y';

          const deployInput = await sharedAskLine!(chalk.yellow(`  Deploy to Vercel? [Y/n]: `));
          const shouldDeploy = deployInput.toLowerCase() !== 'n';

          console.log();
          console.log(chalk.yellow(`  Creating repository and deploying...`));

          // Call the deploy API - use message_id if available from Dashboard API
          const result = await api.deployAIApp({
            platform: 'github',
            web_platform: shouldDeploy ? 'vercel' : undefined,
            framework: appMetadata.framework,
            name: repoName,
            ai_response: response.text,
            message_id: response.messageId, // Use message_id from Dashboard API if available
            private: isPrivate,
            slug: bucketSlug,
          });

          console.log();
          if (result.success) {
            const repositoryUrl = result.data?.repositoryUrl || result.data?.repository_url;
            if (repositoryUrl) {
              console.log(chalk.green(`  ✓ Repository created: ${repositoryUrl}`));
              console.log(chalk.dim(`    Clone locally: git clone ${repositoryUrl}.git`));
            }

            // Debug log the deploy result
            const verbose = process.env.COSMIC_DEBUG === '1' || process.env.COSMIC_DEBUG === '2';
            if (verbose) {
              console.log(`[DEBUG] Deploy result: ${JSON.stringify(result.data, null, 2)}`);
            }

            // If deployed to Vercel, poll for status
            if (shouldDeploy) {
              // Use vercel_project_id if available, otherwise the backend will look it up
              const vercelProjectId = result.data?.vercel_project_id || '';
              const repositoryId = result.data?.repository_id;
              if (verbose) {
                console.log(`[DEBUG] Polling with vercelProjectId: "${vercelProjectId}" (empty = backend will look up)`);
              }
              const deployResult = await pollDeploymentStatus(
                bucketSlug,
                vercelProjectId,
                repositoryUrl
              );

              // If deployment failed and we have logs, offer to fix with AI
              if (!deployResult.success && deployResult.logs && deployResult.logs.length > 0 && repositoryUrl) {
                // Extract repo owner and name from URL (e.g., https://github.com/cosmic-community/my-app)
                const urlParts = repositoryUrl.replace('https://github.com/', '').split('/');
                const repoOwner = urlParts[0] || 'cosmic-community';
                const repoNameFromUrl = urlParts[1] || repoName;

                console.log();
                console.log(chalk.yellow('  Would you like AI to analyze the logs and fix the build error?'));
                const fixInput = await sharedAskLine!(chalk.yellow('  Fix with AI? [Y/n]: '));
                const fixWithAI = fixInput.toLowerCase() !== 'n';

                if (fixWithAI) {
                  console.log();
                  console.log(chalk.cyan('  Sending build logs to AI for analysis...'));
                  console.log();

                  // Format logs as text for the AI (filter out any logs with missing text)
                  const logsText = deployResult.logs
                    .filter(log => log.text && typeof log.text === 'string')
                    .map(log => `[${log.type}] ${log.text}`)
                    .join('\n');

                  const userMessage = `The deployment failed with the following build logs. Please analyze the errors and fix the code:\n\n\`\`\`\n${logsText || 'No logs available'}\n\`\`\``;

                  try {
                    await streamingRepositoryUpdate({
                      repositoryOwner: repoOwner,
                      repositoryName: repoNameFromUrl,
                      repositoryId,
                      bucketSlug,
                      messages: [{
                        role: 'user',
                        content: userMessage, // streamingRepositoryUpdate expects content as string
                      }],
                      onChunk: (chunk) => {
                        process.stdout.write(chunk);
                      },
                      onComplete: () => {
                        console.log();
                        console.log();
                        console.log(chalk.green('  ✓ AI has pushed fixes to the repository.'));
                        console.log(chalk.dim('  Vercel will automatically redeploy with the fixes.'));
                        console.log();
                      },
                      onError: (error) => {
                        console.log(chalk.red(`  ✗ AI fix failed: ${error.message}`));
                        console.log();
                      },
                    });

                    // Wait a moment for Vercel to pick up the new commit, then poll again
                    console.log(chalk.dim('  Waiting for new deployment to start...'));
                    await new Promise(resolve => setTimeout(resolve, 10000));

                    // Poll for the new deployment
                    const fixDeployResult = await pollDeploymentStatus(bucketSlug, vercelProjectId, repositoryUrl);

                    // If deployment succeeded after fix, switch to repo mode
                    if (fixDeployResult.success && repositoryUrl) {
                      isBuildMode = false;
                      isRepoMode = true;
                      currentRepo = {
                        id: repositoryId || '',
                        owner: repoOwner,
                        name: repoNameFromUrl,
                        branch: 'main',
                      };
                      console.log();
                      console.log(chalk.green('  Switched to repository mode.'));
                      console.log(chalk.dim(`  You can now make updates to ${repoOwner}/${repoNameFromUrl}`));
                      console.log();
                    }
                  } catch (aiError) {
                    console.log(chalk.red(`  ✗ Failed to fix with AI: ${(aiError as Error).message}`));
                    console.log();
                  }
                }
              } else if (deployResult.success && repositoryUrl) {
                // Deployment succeeded on first try - switch to repo mode
                const urlParts = repositoryUrl.replace('https://github.com/', '').split('/');
                const repoOwner = urlParts[0] || 'cosmic-community';
                const repoNameFromUrl = urlParts[1] || repoName;
                const repositoryId = result.data?.repository_id || '';

                isBuildMode = false;
                isRepoMode = true;
                currentRepo = {
                  id: repositoryId,
                  owner: repoOwner,
                  name: repoNameFromUrl,
                  branch: 'main',
                };
                console.log();
                console.log(chalk.green('  Switched to repository mode.'));
                console.log(chalk.dim(`  You can now make updates to ${repoOwner}/${repoNameFromUrl}`));
                console.log();
              }

              // Check if AI response contains content to add to Cosmic CMS (build mode)
              const extractedContent = extractContentFromResponse(response.text);
              if (extractedContent.hasAddContent && (extractedContent.objectTypes.length > 0 || extractedContent.demoObjects.length > 0)) {
                const contentResult = await installContentToCosmic(sdk, extractedContent, rl);
                if (contentResult.nextAction === 'exit') {
                  console.log(chalk.dim('  Goodbye!'));
                  rl.close();
                  return;
                }
              }
            } else {
              // No Vercel deployment requested
              console.log();
              console.log(chalk.green(`  ✓ App "${repoName}" created successfully!`));
              console.log();
              if (repositoryUrl) {
                console.log(chalk.dim('  Next steps:'));
                console.log(chalk.dim(`  1. Clone your repo: git clone ${repositoryUrl}`));
                console.log(chalk.dim(`  2. Run locally: cd ${repositoryUrl.split('/').pop()} && npm install && npm run dev`));
                console.log();
              }

              // Check if AI response contains content to add to Cosmic CMS (build mode - no deploy)
              const extractedContent = extractContentFromResponse(response.text);
              if (extractedContent.hasAddContent && (extractedContent.objectTypes.length > 0 || extractedContent.demoObjects.length > 0)) {
                const contentResult = await installContentToCosmic(sdk, extractedContent, rl);
                if (contentResult.nextAction === 'exit') {
                  console.log(chalk.dim('  Goodbye!'));
                  rl.close();
                  return;
                }
              }
            }
          } else {
            console.log(chalk.red(`  ✗ Deployment failed: ${result.error || 'Unknown error'}`));
            console.log();
          }
        } catch (deployError) {
          console.log(chalk.red(`  ✗ Deployment error: ${(deployError as Error).message}`));
          console.log();
        }
      }

      // Add to history (include action results)
      const fullResponse = actionResults.length > 0
        ? response.text + '\n\nResult: ' + actionResults.join('\n')
        : response.text;

      conversationHistory.push({
        role: 'assistant',
        content: fullResponse,
      });

      // Auto-continue: if an action was executed and it was a create or batch action,
      // the AI might need to continue creating more items
      if (actionExecuted && actionResults.length > 0) {
        const lastResult = actionResults[actionResults.length - 1];
        // If the action was successful (created something or confirmed batch), add a continuation prompt
        if (lastResult.startsWith('✓ Created') || lastResult.startsWith('✓ Confirmed')) {
          // Add a system message to prompt continuation
          conversationHistory.push({
            role: 'user',
            content: 'Continue with the next item if there are more to create. If all items are done, say "All done!"',
          });

          // Return true to signal the caller to continue processing
          return true;
        }
      }
    }

    // Show token usage
    if (response.usage && (response.usage.input_tokens || response.usage.output_tokens)) {
      console.log(
        chalk.dim(
          `  [${response.usage.input_tokens || '?'} in / ${response.usage.output_tokens || '?'} out tokens]`
        )
      );
    }

    return false; // No continuation needed
  } catch (error) {
    spinner.fail();
    throw error;
  }
}

/**
 * Format response text
 */
function formatResponse(text: string): string {
  // Simple markdown-like formatting
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
function getTerminalWidth(): number {
  return process.stdout.columns || 80;
}

/**
 * Cosmic logo - large ASCII letters
 */
const COSMIC_LOGO = [
  ' ██████╗ ██████╗ ███████╗███╗   ███╗██╗ ██████╗',
  '██╔════╝██╔═══██╗██╔════╝████╗ ████║██║██╔════╝',
  '██║     ██║   ██║███████╗██╔████╔██║██║██║     ',
  '██║     ██║   ██║╚════██║██║╚██╔╝██║██║██║     ',
  '╚██████╗╚██████╔╝███████║██║ ╚═╝ ██║██║╚██████╗',
  ' ╚═════╝ ╚═════╝ ╚══════╝╚═╝     ╚═╝╚═╝ ╚═════╝',
];

/**
 * Print a horizontal line for the box
 */
function printBoxLine(width: number, left: string, fill: string, right: string): string {
  return left + fill.repeat(width - 2) + right;
}

/**
 * Print text padded to width
 */
function padText(text: string, width: number, align: 'left' | 'center' | 'right' = 'left'): string {
  // Strip ANSI codes for length calculation
  const stripAnsi = (str: string) => str.replace(/\x1b\[[0-9;]*m/g, '');
  const textLen = stripAnsi(text).length;
  const padding = width - textLen - 2; // -2 for border chars

  if (padding < 0) return '│' + text.slice(0, width - 2) + '│';

  if (align === 'center') {
    const leftPad = Math.floor(padding / 2);
    const rightPad = padding - leftPad;
    return '│' + ' '.repeat(leftPad) + text + ' '.repeat(rightPad) + '│';
  } else if (align === 'right') {
    return '│' + ' '.repeat(padding) + text + '│';
  } else {
    return '│' + text + ' '.repeat(padding) + '│';
  }
}

/**
 * Print the welcome screen with Cosmic logo
 */
function printWelcomeScreen(model: string): void {
  // Get version
  const version = '1.0.0';

  // Determine mode
  let modeText = '';
  let modeColor = chalk.cyan;
  if (isRepoMode && currentRepo) {
    modeText = isAskMode ? 'Repository Mode (Ask)' : 'Repository Mode';
    modeColor = isAskMode ? chalk.blue : chalk.magenta;
  } else if (isBuildMode) {
    modeText = isAskMode ? 'Build Mode (Ask)' : 'Build Mode';
    modeColor = isAskMode ? chalk.blue : chalk.green;
  } else if (isContentMode) {
    modeText = isAskMode ? 'Content Mode (Ask)' : 'Content Mode';
    modeColor = isAskMode ? chalk.blue : chalk.yellow;
  } else if (isAskMode) {
    modeText = 'Ask Mode (read-only)';
    modeColor = chalk.blue;
  } else {
    modeText = 'Agent Mode';
    modeColor = chalk.yellow;
  }

  // Get user name
  const userName = process.env.USER || process.env.USERNAME || 'there';

  // Calculate content widths to determine box size
  const logoWidth = 48;
  const contextText = `Context: ${formatContext()}`;
  const modelText = `Model: ${model}`;
  const repoText = isRepoMode && currentRepo ? `Repository: ${currentRepo.owner}/${currentRepo.name} (${currentRepo.branch})` : '';

  // Build AI context text lines
  const aiContextLines: string[] = [];
  if (chatContext.objectTypes && chatContext.objectTypes.length > 0) {
    aiContextLines.push(`Object Types: ${chatContext.objectTypes.join(', ')}`);
  }
  if (chatContext.links && chatContext.links.length > 0) {
    aiContextLines.push(`Links: ${chatContext.links.join(', ')}`);
  }

  // Find the widest content line
  const contentLines = [
    logoWidth,
    contextText.length,
    modelText.length,
    repoText.length,
    'Build and deploy a website:    cosmic chat --build'.length,
    ...aiContextLines.map(l => l.length),
  ];
  const maxContentWidth = Math.max(...contentLines);

  // Inner width = max content + padding (4 chars for margins)
  const innerWidth = maxContentWidth + 4;

  // Helper to strip ANSI codes
  const stripAnsi = (str: string): string => str.replace(/\x1b\[[0-9;]*m/g, '');

  // Helper to center text
  const centerLine = (text: string, color = chalk.white): string => {
    const textLen = stripAnsi(text).length;
    const leftPad = Math.floor((innerWidth - textLen) / 2);
    const rightPad = innerWidth - textLen - leftPad;
    return chalk.cyan('│') + ' '.repeat(leftPad) + color(text) + ' '.repeat(rightPad) + chalk.cyan('│');
  };

  // Helper for left-aligned text
  const leftLine = (text: string): string => {
    const textLen = stripAnsi(text).length;
    const rightPad = innerWidth - textLen - 2;
    return chalk.cyan('│') + '  ' + text + ' '.repeat(Math.max(0, rightPad)) + chalk.cyan('│');
  };

  // Empty line
  const emptyLine = (): string => chalk.cyan('│') + ' '.repeat(innerWidth) + chalk.cyan('│');

  // Horizontal rule
  const hrTop = (title: string): string => {
    const borderLen = innerWidth - title.length;
    const left = Math.floor(borderLen / 2);
    const right = borderLen - left;
    return chalk.cyan('╭' + '─'.repeat(left) + title + '─'.repeat(right) + '╮');
  };
  const hrMid = (): string => chalk.cyan('├' + '─'.repeat(innerWidth) + '┤');
  const hrBot = (): string => chalk.cyan('╰' + '─'.repeat(innerWidth) + '╯');

  console.log();

  // Top border with title
  console.log(hrTop(` Cosmic CLI v${version} `));
  console.log(emptyLine());

  // Logo - centered
  for (const line of COSMIC_LOGO) {
    const leftPad = Math.floor((innerWidth - line.length) / 2);
    const rightPad = innerWidth - line.length - leftPad;
    console.log(chalk.cyan('│') + ' '.repeat(leftPad) + chalk.cyan(line) + ' '.repeat(rightPad) + chalk.cyan('│'));
  }

  console.log(emptyLine());
  console.log(centerLine(`Welcome, ${userName}!`, chalk.bold.white));

  if (modeText) {
    console.log(centerLine(modeText, modeColor.bold));
  }

  console.log(emptyLine());
  console.log(hrMid());
  console.log(emptyLine());

  // Tips
  console.log(leftLine(chalk.bold.white('Getting started')));
  console.log(emptyLine());
  console.log(leftLine(chalk.dim('Create and manage content:     ') + chalk.white('cosmic content')));
  console.log(leftLine(chalk.dim('Build and deploy a website:    ') + chalk.white('cosmic build')));
  console.log(leftLine(chalk.dim('Update an existing repository: ') + chalk.white('cosmic update')));
  console.log(emptyLine());

  console.log(hrMid());

  // Info
  console.log(leftLine(chalk.dim(modelText)));
  console.log(leftLine(chalk.dim(contextText)));

  if (repoText) {
    console.log(leftLine(chalk.dim(repoText)));
  }

  // Show AI context if present
  if (aiContextLines.length > 0) {
    console.log(hrMid());
    console.log(leftLine(chalk.bold.white('AI Context')));
    for (const line of aiContextLines) {
      console.log(leftLine(chalk.dim(line)));
    }
  }

  console.log(hrBot());
  console.log();
}

/**
 * Print chat header (legacy simple version for non-interactive contexts)
 */
function printHeader(model: string): void {
  // Use the new welcome screen
  printWelcomeScreen(model);
}

/**
 * Print help information
 */
function printHelp(): void {
  console.log();
  console.log(chalk.bold('Chat Commands:'));
  console.log(chalk.dim('  exit, quit') + '    - Exit the chat');
  console.log(chalk.dim('  clear') + '         - Clear conversation history');
  console.log(chalk.dim('  context') + '       - Show/manage current context');
  console.log(chalk.dim('  open') + '          - Open last deployment in browser');
  console.log(chalk.dim('  add content') + '   - Generate and add content to Cosmic CMS');
  console.log(chalk.dim('  help') + '          - Show this help');
  console.log();

  // Show current mode info
  if (isAskMode) {
    console.log(chalk.bold('Current Mode: ') + chalk.blue('Ask Mode (read-only)'));
    console.log(chalk.dim('  The AI will answer questions but cannot execute actions.'));
    console.log(chalk.dim('  To enable actions, restart with: ') + chalk.cyan('cosmic chat --agent'));
    console.log();
    console.log(chalk.bold('Example questions:'));
    console.log(chalk.dim('  "What object types are available?"'));
    console.log(chalk.dim('  "How do I structure a blog with categories?"'));
    console.log(chalk.dim('  "Explain how metafields work"'));
    console.log(chalk.dim('  "What is the best way to model products?"'));
  } else if (isRepoMode) {
    if (isAskMode) {
      console.log(chalk.bold('Current Mode: ') + chalk.blue('Repository Mode (Ask)'));
      console.log(chalk.dim('  You are in read-only mode. Ask questions about the codebase.'));
      console.log(chalk.dim('  Use `cosmic update` without --ask to make changes.'));
    } else {
      console.log(chalk.bold('Current Mode: ') + chalk.magenta('Repository Mode'));
      console.log(chalk.dim('  You are in repository update mode. Describe the changes you want.'));
    }
    console.log();
    console.log(chalk.bold('Example prompts:'));
    console.log(chalk.dim('  "Add a dark mode toggle to the header"'));
    console.log(chalk.dim('  "Fix the broken image on the homepage"'));
    console.log(chalk.dim('  "Add a contact form component"'));
    console.log(chalk.dim('  "Update the footer with new social links"'));
  } else if (isBuildMode) {
    console.log(chalk.bold('Current Mode: ') + chalk.green('Build Mode'));
    console.log(chalk.dim('  Build and deploy a complete app from scratch.'));
  } else if (isContentMode) {
    console.log(chalk.bold('Current Mode: ') + chalk.yellow('Content Mode'));
    console.log(chalk.dim('  Create and manage content with AI assistance.'));
    console.log();
    console.log(chalk.bold('Example prompts:'));
    console.log(chalk.dim('  "Create a blog post about AI trends"'));
    console.log(chalk.dim('  "Add 5 product descriptions for my store"'));
    console.log(chalk.dim('  "Generate an author profile for John Doe"'));
    console.log(chalk.dim('  "Set up a blog content model with posts and categories"'));
    console.log(chalk.dim('  "Update the homepage content"'));
    console.log();
    console.log(chalk.dim('  Actions require confirmation before executing.'));
  } else {
    console.log(chalk.bold('Current Mode: ') + chalk.yellow('Agent Mode'));
    console.log(chalk.dim('  The AI can create, update, and delete content.'));
    console.log();
    console.log(chalk.bold('Example prompts:'));
    console.log(chalk.dim('  "List all authors"'));
    console.log(chalk.dim('  "Create a new post titled Hello World"'));
    console.log(chalk.dim('  "Add an author named John Doe"'));
    console.log(chalk.dim('  "Show me the posts"'));
    console.log(chalk.dim('  "Write a blog post about AI and save it"'));
    console.log();
    console.log(chalk.dim('  Actions require confirmation before executing.'));
  }

  console.log();
  console.log(chalk.bold('Mode Shortcuts:'));
  console.log(chalk.dim('  cosmic chat') + '             - Ask mode (read-only questions)');
  console.log(chalk.dim('  cosmic chat --content') + '   - Content mode (create/update content)');
  console.log(chalk.dim('  cosmic chat --agent') + '     - Agent mode (full actions)');
  console.log(chalk.dim('  cosmic chat --build') + '     - Build a new app');
  console.log(chalk.dim('  cosmic chat --repo') + '      - Update existing code');
  console.log();
  console.log(chalk.bold('Shortcut Commands:'));
  console.log(chalk.dim('  cosmic content') + '          - Same as cosmic chat --content');
  console.log(chalk.dim('  cosmic build') + '            - Same as cosmic chat --build');
  console.log(chalk.dim('  cosmic update') + '           - Same as cosmic chat --repo');
  console.log();
  console.log(chalk.bold('Context Options:'));
  console.log(chalk.dim('  --ctx <text>') + '            - Add custom context');
  console.log(chalk.dim('  -t, --types <slugs>') + '     - Include object types (comma-separated)');
  console.log(chalk.dim('  -l, --links <urls>') + '      - Include external URLs (comma-separated)');
  console.log();
}

export default { startChat };
