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
} from '../api/dashboard.js';
import * as display from '../utils/display.js';
import * as spinner from '../utils/spinner.js';

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

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatOptions {
  model?: string;
  initialPrompt?: string;  // Pre-loaded prompt to start the conversation
}

// Conversation history
let conversationHistory: ChatMessage[] = [];

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
          console.log(chalk.dim(`Context: ${formatContext()}`));
          console.log(chalk.dim(`Model: ${model}`));
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
 * Get the system prompt for the chat
 */
function getSystemPrompt(bucketSlug: string): string {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
  
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

For general questions or help, respond normally without any ACTION command.`;
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

        // Step 1: Create all object types first
        console.log();
        console.log(chalk.cyan('  Creating object types...'));
        
        for (const ot of objectTypes) {
          spinner.start(`Creating ${ot.title}...`);
          
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
            spinner.stop();
            
            const typeAny = result.object_type as Record<string, unknown>;
            const slug = typeAny.slug as string;
            createdObjectTypes.set(slug, typeAny);
            
            const emoji = (ot.emoji as string) || '✓';
            console.log(chalk.green(`  ${emoji} Created "${typeAny.title}" (${slug})`));
            results.push(`Created object type: ${typeAny.title}`);
          } catch (error) {
            spinner.stop();
            console.log(chalk.red(`  ✗ Failed to create "${ot.title}": ${(error as Error).message}`));
            results.push(`Failed: ${ot.title} - ${(error as Error).message}`);
          }
        }

        // Step 2: Create demo objects if provided
        if (demoObjects && demoObjects.length > 0) {
          console.log();
          console.log(chalk.cyan('  Creating demo content...'));
          
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
            
            spinner.start(`Creating "${obj.title}"...`);
            
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
              spinner.stop();
              
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
              
              console.log(chalk.green(`  ✓ Created "${createdObj.title}" (${typeSlug})`));
              results.push(`Created object: ${createdObj.title}`);
            } catch (error) {
              spinner.stop();
              console.log(chalk.red(`  ✗ Failed to create "${obj.title}": ${(error as Error).message}`));
              results.push(`Failed: ${obj.title} - ${(error as Error).message}`);
            }
          }

          // Step 3: Resolve object references (update objects with proper IDs)
          if (successfulObjects.length > 0) {
            console.log();
            console.log(chalk.cyan('  Resolving references...'));
            
            for (const { original, created } of successfulObjects) {
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
                  console.log(chalk.dim(`  ✓ Updated references for "${objTitle}"`));
                } catch (error) {
                  console.log(chalk.yellow(`  ⚠ Could not update references for "${objTitle}"`));
                }
              }
            }
          }
        }

        console.log();
        return `✓ Content model installed: ${objectTypes.length} object type(s)${demoObjects ? `, ${demoObjects.length} demo object(s)` : ''}`;
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

  // Don't use spinner - it interferes with readline
  console.log(chalk.dim('  Thinking...'));

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
      console.log(chalk.dim(`    Max Tokens: 4096`));
      console.log(chalk.dim(`    Messages Count: ${messagesWithSystem.length}`));
      console.log(chalk.dim(`    System prompt length: ${systemPrompt.length} chars`));
      console.log(chalk.dim(`    User message: "${conversationHistory[0]?.content?.substring(0, 100)}${(conversationHistory[0]?.content?.length || 0) > 100 ? '...' : ''}"`));
      console.log(chalk.dim(`    Total payload size: ${JSON.stringify(messagesWithSystem).length} chars`));
      
      // Show more details if COSMIC_DEBUG=2
      if (process.env.COSMIC_DEBUG === '2') {
        console.log(chalk.dim('  [DEBUG] System prompt preview (first 500 chars):'));
        console.log(chalk.dim('    ' + systemPrompt.substring(0, 500).replace(/\n/g, '\n    ') + '...'));
        console.log(chalk.dim('  [DEBUG] Full SDK generateText call:'));
        console.log(chalk.dim('    ' + JSON.stringify({ model, max_tokens: 4096, messagesCount: messagesWithSystem.length })));
      }
    }

    // Use SDK to generate text
    let response;
    try {
      response = await sdk.ai.generateText({
        messages: messagesWithSystem,
        model,
        max_tokens: 4096,
      });
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
      const lines = response.text.split('\n');
      let displayText = '';
      let actionResults: string[] = [];

      let actionExecuted = false;
      for (const line of lines) {
        if (line.trim().startsWith('ACTION:') && !actionExecuted) {
          const actionJson = line.replace('ACTION:', '').trim();
          const result = await executeAction(actionJson);
          actionResults.push(result);
          actionExecuted = true; // Only execute one action per response
        } else if (!line.trim().startsWith('ACTION:')) {
          displayText += line + '\n';
        }
      }

      // Print the response text (without ACTION lines)
      if (displayText.trim()) {
        console.log();
        console.log(formatResponse(displayText.trim()));
      }

      // Print action results
      for (const result of actionResults) {
        console.log();
        console.log(chalk.green(result));
      }

      console.log();

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
    if (response.usage) {
      console.log(
        chalk.dim(
          `  [${response.usage.input_tokens} in / ${response.usage.output_tokens} out tokens]`
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
 * Print chat header
 */
function printHeader(model: string): void {
  console.log();
  console.log(chalk.bold.cyan('  Cosmic Chat'));
  console.log(chalk.dim(`  Model: ${model}`));
  console.log(chalk.dim(`  Context: ${formatContext()}`));
  console.log();
  console.log(chalk.dim('  Type your message and press Enter. Type "help" for commands.'));
  console.log();
}

/**
 * Print help information
 */
function printHelp(): void {
  console.log();
  console.log(chalk.bold('Chat Commands:'));
  console.log(chalk.dim('  exit, quit') + '  - Exit the chat');
  console.log(chalk.dim('  clear') + '       - Clear conversation history');
  console.log(chalk.dim('  context') + '     - Show current context');
  console.log(chalk.dim('  help') + '        - Show this help');
  console.log();
  console.log(chalk.bold('Example prompts:'));
  console.log(chalk.dim('  "List all authors"'));
  console.log(chalk.dim('  "Create a new post titled Hello World"'));
  console.log(chalk.dim('  "Add an author named John Doe"'));
  console.log(chalk.dim('  "Show me the posts"'));
  console.log(chalk.dim('  "Write a blog post about AI and save it"'));
  console.log();
  console.log(chalk.dim('  Actions require confirmation before executing.'));
  console.log();
}

export default { startChat };
