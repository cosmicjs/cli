/**
 * Chat REPL
 * Interactive AI chat mode using Cosmic SDK
 */

import * as readline from 'readline';
import chalk from 'chalk';
import { isAuthenticated, getDefaultModel, getCurrentBucketSlug, setCredentials } from '../config/store.js';
import { formatContext } from '../config/context.js';
import { getSDKClient, hasSDKClient, clearSDKClient } from '../api/sdk.js';
import { getBucket } from '../api/dashboard.js';
import * as display from '../utils/display.js';
import * as spinner from '../utils/spinner.js';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatOptions {
  model?: string;
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

  // Create readline interface
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.cyan('> '),
  });

  // Handle input
  rl.prompt();

  rl.on('line', async (line) => {
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
      rl.prompt();
      return;
    }

    if (input.toLowerCase() === 'help') {
      printHelp();
      rl.prompt();
      return;
    }

    if (input.toLowerCase() === 'context') {
      console.log(chalk.dim(`Context: ${formatContext()}`));
      console.log(chalk.dim(`Model: ${model}`));
      rl.prompt();
      return;
    }

    if (!input) {
      rl.prompt();
      return;
    }

    // Add user message to history
    conversationHistory.push({
      role: 'user',
      content: input,
    });

    try {
      // Process the message using SDK
      await processMessage(model, rl, bucketSlug);
    } catch (error) {
      display.error((error as Error).message);
    }

    rl.prompt();
  });

  rl.on('close', () => {
    process.exit(0);
  });
}

/**
 * Get the system prompt for the chat
 */
function getSystemPrompt(bucketSlug: string): string {
  return `You are an AI assistant for Cosmic CMS, helping users manage content in their bucket "${bucketSlug}".

You can perform these actions by outputting JSON commands:

1. LIST objects:
{"action": "list", "type": "<object-type-slug>", "limit": 10}

2. READ/GET a specific object (by ID or slug):
{"action": "read", "id": "<object-id-or-slug>"}

3. CREATE an object:
{"action": "create", "type": "<object-type-slug>", "title": "<title>", "content": "<optional content>", "metadata": {<optional key-value pairs>}}

4. UPDATE an object:
{"action": "update", "id": "<object-id>", "title": "<new title>", "content": "<new content>", "metadata": {<updated fields>}}

5. DELETE an object:
{"action": "delete", "id": "<object-id>"}

When a user asks you to list, read, create, update, or delete content, output the appropriate JSON command on a single line starting with "ACTION:" followed by the JSON.

Examples:
- List: ACTION: {"action": "list", "type": "posts", "limit": 5}
- Read: ACTION: {"action": "read", "id": "todays-top-tech-stories"}
- Create: ACTION: {"action": "create", "type": "authors", "title": "Tony Spiro"}

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
 * Ask for confirmation using raw stdin (defaults to Yes)
 */
async function askConfirmation(): Promise<boolean> {
  return new Promise((resolve) => {
    process.stdout.write(chalk.dim('[Y/n] '));
    
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.once('data', (data) => {
      const char = data.toString().toLowerCase().trim();
      process.stdin.setRawMode(false);
      process.stdin.pause();
      const confirmed = char !== 'n';
      console.log(confirmed ? 'y' : 'n');
      resolve(confirmed);
    });
  });
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
      case 'create': {
        // Ask for confirmation
        console.log();
        process.stdout.write(chalk.yellow(`  Create ${action.type}: "${action.title}"? `));
        const confirmed = await askConfirmation();
        
        if (!confirmed) {
          return chalk.dim('Cancelled.');
        }

        spinner.start('Creating...');
        const result = await sdk.objects.insertOne({
          type: action.type,
          title: action.title,
          content: action.content || '',
          metadata: action.metadata || {},
        });
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
        
        // SDK uses chaining: find(query).limit(n)
        const query = action.type ? { type: action.type } : {};
        const limit = action.limit || 10;
        
        const result = await sdk.objects.find(query).limit(limit);
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
          
          let result;
          if (isObjectId) {
            result = await sdk.objects.findOne({ id: identifier });
          } else {
            // Search by slug using find with slug filter
            result = await sdk.objects.find({ slug: identifier }).limit(1);
            if (result.objects && result.objects.length > 0) {
              result = { object: result.objects[0] };
            }
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
      
      default:
        return `Unknown action: ${action.action}`;
    }
  } catch (error) {
    return `Error: ${(error as Error).message}`;
  }
}

/**
 * Process a chat message using the SDK
 */
async function processMessage(
  model: string,
  rl: readline.Interface,
  bucketSlug: string
): Promise<void> {
  const sdk = getSDKClient();
  if (!sdk) {
    throw new Error('SDK client not available. Check your bucket configuration.');
  }

  spinner.start('Thinking...');

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

    // Use SDK to generate text
    const response = await sdk.ai.generateText({
      messages: messagesWithSystem,
      model,
      max_tokens: 4096,
    });

    spinner.stop();

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
          // Pause the main readline during action execution
          rl.pause();
          const result = await executeAction(actionJson);
          rl.resume();
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
    }

    // Show token usage
    if (response.usage) {
      console.log(
        chalk.dim(
          `  [${response.usage.input_tokens} in / ${response.usage.output_tokens} out tokens]`
        )
      );
    }
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
