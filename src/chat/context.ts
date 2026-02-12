/**
 * Context fetching and content detection utilities
 */

import chalk from 'chalk';
import {
  getBucket,
} from '../api/dashboard.js';
import * as api from '../api/dashboard.js';
import { setCredentials } from '../config/store.js';
import { clearSDKClient } from '../api/sdk.js';
import * as spinner from '../utils/spinner.js';
import { state } from './state.js';
import { extractContentFromResponse } from './parsing.js';
import { installContentToCosmic } from './contentInstaller.js';

/**
 * Fetch text content from a URL
 */
export async function fetchUrlContent(url: string): Promise<string | null> {
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
    let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    text = text.replace(/<[^>]+>/g, ' ');
    text = text.replace(/&nbsp;/g, ' ');
    text = text.replace(/&amp;/g, '&');
    text = text.replace(/&lt;/g, '<');
    text = text.replace(/&gt;/g, '>');
    text = text.replace(/&quot;/g, '"');
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
export async function fetchContextData(bucketSlug: string): Promise<void> {
  state.fetchedContextData = { objects: [], linkContents: [] };

  const isDebug = process.env.COSMIC_DEBUG === '1' || process.env.COSMIC_DEBUG === '2';

  const hasContext = (state.chatContext.objectTypes && state.chatContext.objectTypes.length > 0) ||
    (state.chatContext.links && state.chatContext.links.length > 0);

  if (!hasContext) {
    if (isDebug) {
      console.log(chalk.dim('[DEBUG] fetchContextData: No context to fetch'));
    }
    return;
  }

  spinner.start('Fetching context data...');

  try {
    // Fetch objects for specified types
    if (state.chatContext.objectTypes && state.chatContext.objectTypes.length > 0) {
      const limit = state.chatContext.objectsLimit || 5;

      for (const typeSlug of state.chatContext.objectTypes) {
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

          state.fetchedContextData.objects.push(...objects.map(obj => ({
            id: obj.id,
            title: obj.title,
            slug: obj.slug,
            type: obj.type,
            status: obj.status,
            content: obj.content,
            metadata: obj.metadata,
          })));
        } catch (err) {
          if (isDebug) {
            console.log(chalk.dim(`[DEBUG] Failed to fetch type ${typeSlug}: ${(err as Error).message}`));
          }
        }
      }
    }

    // Fetch content from URLs
    if (state.chatContext.links && state.chatContext.links.length > 0) {
      for (const url of state.chatContext.links) {
        if (isDebug) {
          console.log(chalk.dim(`\n[DEBUG] Fetching URL: ${url}`));
        }

        const content = await fetchUrlContent(url);

        if (content) {
          if (isDebug) {
            console.log(chalk.dim(`[DEBUG] Got ${content.length} chars from URL`));
            console.log(chalk.dim(`[DEBUG] Content preview: ${content.substring(0, 200)}...`));
          }
          state.fetchedContextData.linkContents.push({ url, content });
        } else if (isDebug) {
          console.log(chalk.dim('[DEBUG] No content returned from URL'));
        }
      }
    }

    const objectCount = state.fetchedContextData.objects.length;
    const linkCount = state.fetchedContextData.linkContents.length;

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
export async function tryFetchBucketKeys(bucketSlug: string): Promise<boolean> {
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
 * Detect if AI response mentions Cosmic content that needs to be created
 * (without including the metadata markers)
 */
export function detectCosmicContentMention(content: string): boolean {
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

  return cosmicContentPatterns.some(pattern => pattern.test(content));
}

/**
 * Offer to generate and add content to Cosmic after a repo update
 */
export async function offerContentGeneration(
  aiResponse: string,
  conversationHistory: Array<{ role: string; content: string }>,
  model: string,
  bucketSlug: string,
  rl: import('readline').Interface
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
      const result = await installContentToCosmic(extractedContent, rl);
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
