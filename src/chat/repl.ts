/**
 * Chat REPL
 * Interactive AI chat mode using Cosmic SDK
 */

import * as readline from 'readline';
import chalk from 'chalk';
import { isAuthenticated, getDefaultModel, getCurrentBucketSlug, setCredentials } from '../config/store.js';
import { formatContext } from '../config/context.js';
import { getSDKClient, hasSDKClient, clearSDKClient } from '../api/sdk.js';
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
} from '../api/dashboard.js';
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
    if (pendingResolve) {
      const resolve = pendingResolve;
      pendingResolve = null;
      pendingReject = null;
      resolve(line);
    }
  });
  
  // Handle readline close
  rl.on('close', () => {
    mainRl = null;
    if (pendingReject) {
      pendingReject(new Error('readline closed'));
      pendingResolve = null;
      pendingReject = null;
    }
  });

  // Promisified question function
  const question = (prompt: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      // Ensure readline is actively reading
      rl.resume();
      
      pendingResolve = resolve;
      pendingReject = reject;
      
      // Write the prompt
      process.stdout.write(prompt);
    });
  };

  // Main chat loop
  const runChatLoop = async () => {
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

        // Process message
        try {
          await processMessage(model, rl, bucketSlug);
        } catch (error) {
          display.error((error as Error).message);
        }
      } catch (error) {
        // Handle readline close (Ctrl+C, etc.)
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
  return `You are an AI assistant for Cosmic CMS, helping users manage content in their bucket "${bucketSlug}".

You can perform these actions by outputting JSON commands:

**OBJECTS:**
1. LIST objects: {"action": "list", "type": "<object-type-slug>", "limit": 10}
2. READ object: {"action": "read", "id": "<object-id-or-slug>"}
3. CREATE object: {"action": "create", "type": "<type>", "title": "<title>", "content": "<content>"}
4. UPDATE object: {"action": "update", "id": "<id>", "title": "<new title>"}
5. DELETE object: {"action": "delete", "id": "<id>"}

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
 * Ask for confirmation (defaults to Yes)
 * Uses the main readline interface to avoid stdin conflicts
 */
async function askConfirmation(): Promise<boolean> {
  return new Promise((resolve) => {
    process.stdout.write(chalk.dim('[Y/n] '));
    
    if (mainRl) {
      mainRl.once('line', (answer) => {
        const confirmed = answer.toLowerCase().trim() !== 'n';
        resolve(confirmed);
      });
    } else {
      // Fallback: default to yes if no readline
      resolve(true);
    }
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

    // Use SDK to generate text
    const response = await sdk.ai.generateText({
      messages: messagesWithSystem,
      model,
      max_tokens: 4096,
    });

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
