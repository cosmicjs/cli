/**
 * Chat REPL
 * Interactive AI chat mode using Cosmic SDK
 *
 * This is the main orchestrator. All helper functions, prompts, actions,
 * and utilities are extracted into sibling modules under src/chat/.
 */

import * as readline from 'readline';
import chalk from 'chalk';
import { isAuthenticated, getDefaultModel, getCurrentBucketSlug } from '../config/store.js';
import { formatContext } from '../config/context.js';
import { getSDKClient, hasSDKClient, getBucketKeys, getApiEnv } from '../api/sdk.js';
import {
  listRepositories,
  streamingRepositoryUpdate,
  commitPendingOperations,
  deployRepository,
  createAgent,
  createWorkflow,
  getRepositoryEnvVars,
  addRepositoryEnvVar,
} from '../api/dashboard.js';
import { extractEnvVarsFromContent, markdownLinksToTerminal } from '../utils/envVars.js';
import type { EnvVarFromBackend, RepositoryPendingOperations } from '../api/dashboard/ai.js';
import * as api from '../api/dashboard.js';
import * as display from '../utils/display.js';
import {
  extractImagePathsFromInput,
  uploadImagesForChat,
  stripPathsFromMessage,
} from './mediaAttachment.js';
import * as spinner from '../utils/spinner.js';
import { isAITokenLimitError, showAITokenUpgradePrompt } from '../utils/aiErrors.js';

// Extracted modules
import type { ChatOptions, ProcessMessageResponse } from './types.js';
import { state } from './state.js';
import { formatResponse, askQuestion, askConfirmation } from './utils.js';
import { printHeader, printHelp } from './welcome.js';
import {
  cleanResponseForDisplay,
  containsMetadataMarker,
  extractContentFromResponse,
  extractJsonBlocks,
  parseCodeBlocks,
  extractAppMetadata,
} from './parsing.js';
import { pollDeploymentStatus } from './deployment.js';
import { installContentToCosmic } from './contentInstaller.js';
import { fetchContextData, tryFetchBucketKeys, detectCosmicContentMention, offerContentGeneration } from './context.js';
import { getSystemPrompt } from './prompts.js';
import { executeAction } from './actions.js';

/**
 * Start the interactive chat
 */
export async function startChat(options: ChatOptions): Promise<void> {
  // Set build mode flag if provided (affects max_tokens)
  state.isBuildMode = options.buildMode || false;

  // Set repo mode flag if provided
  state.isRepoMode = options.repoMode || false;
  state.currentRepo = null;

  // Set content mode flag if provided
  state.isContentMode = options.contentMode || false;

  // Set automate mode flag if provided
  state.isAutomateMode = options.automateMode || false;

  // Set ask mode flag - defaults to true (read-only mode)
  if (options.askMode === true) {
    state.isAskMode = true;
  } else if (state.isBuildMode || state.isContentMode || state.isAutomateMode || state.isRepoMode) {
    state.isAskMode = false;
  } else {
    state.isAskMode = options.askMode !== false;
  }

  // Set chat context from options
  state.chatContext = options.context || {};

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
  if (state.isRepoMode) {
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
        state.currentRepo = {
          id: repo.id,
          owner: repo.repository_owner || 'cosmic-community',
          name: repo.repository_name || '',
          branch: options.repoBranch || repo.default_branch || 'main',
        };
      } else if (repositories.length === 1) {
        const repo = repositories[0];
        state.currentRepo = {
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
        state.currentRepo = {
          id: repo.id,
          owner: repo.repository_owner || 'cosmic-community',
          name: repo.repository_name || '',
          branch: options.repoBranch || repo.default_branch || 'main',
        };
      }

      console.log(chalk.green(`  ✓ Selected: ${state.currentRepo.owner}/${state.currentRepo.name} (${state.currentRepo.branch})`));
    } catch (error) {
      spinner.fail('Failed to load repositories');
      display.error((error as Error).message);
      process.exit(1);
    }
  }

  // Print header
  printHeader(model);

  // Initialize conversation
  state.conversationHistory = [];

  // Keep stdin open and prevent automatic close
  process.stdin.resume();

  // Create readline interface
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  state.mainRl = rl;

  // Queue-based input system - single persistent 'line' handler
  let pendingResolve: ((line: string) => void) | null = null;
  let pendingReject: ((err: Error) => void) | null = null;

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

  rl.on('close', () => {
    if (process.env.COSMIC_DEBUG) {
      console.error(chalk.red('\n[DEBUG] Readline closed unexpectedly'));
    }
    state.mainRl = null;
    state.sharedAskLine = null;
    if (pendingReject) {
      pendingReject(new Error('readline closed'));
      pendingResolve = null;
      pendingReject = null;
    }
  });

  process.stdin.on('end', () => {
    console.error(chalk.red('\n[DEBUG] stdin end event'));
  });

  process.stdin.on('close', () => {
    console.error(chalk.red('\n[DEBUG] stdin close event'));
  });

  process.on('exit', (code) => {
    if (process.env.COSMIC_DEBUG) {
      console.error(chalk.dim(`\n[DEBUG] Process exit with code: ${code}`));
    }
  });

  process.on('beforeExit', (code) => {
    if (process.env.COSMIC_DEBUG) {
      console.error(chalk.dim(`\n[DEBUG] Process beforeExit with code: ${code}`));
    }
  });

  process.on('SIGINT', () => {
    console.log(chalk.dim('\nGoodbye!'));
    rl.close();
    process.exit(0);
  });

  // Promisified question function
  const question = (prompt: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      if (process.env.COSMIC_DEBUG === '1') {
        console.log(chalk.dim(`\n[DEBUG] stdin readable: ${process.stdin.readable}, destroyed: ${process.stdin.destroyed}`));
        console.log(chalk.dim(`[DEBUG] rl closed: ${(rl as any).closed}, terminal: ${(rl as any).terminal}`));
      }

      if (!process.stdin.readable || process.stdin.destroyed) {
        console.error(chalk.red('\n[ERROR] stdin is no longer readable'));
        reject(new Error('stdin closed'));
        return;
      }

      process.stdin.resume();
      rl.resume();

      pendingResolve = resolve;
      pendingReject = reject;

      process.stdout.write(prompt);
    });
  };

  // Set the shared input function so askConfirmation can use it
  state.sharedAskLine = question;

  // Main chat loop
  const runChatLoop = async () => {
    // Handle initial prompt if provided (from project creation)
    if (options.initialPrompt) {
      console.log(chalk.cyan('> ') + chalk.dim(options.initialPrompt));
      state.conversationHistory.push({
        role: 'user',
        content: options.initialPrompt,
      });
      try {
        let shouldContinue = true;
        while (shouldContinue) {
          shouldContinue = await processMessage(model, rl, bucketSlug);
        }
        state.skipConfirmations = false;
      } catch (error) {
        state.skipConfirmations = false;
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
          state.conversationHistory = [];
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
          console.log(chalk.dim(`  Mode: ${state.isAskMode ? 'Ask (read-only)' : state.isContentMode ? 'Content' : state.isRepoMode ? 'Repository' : 'Build'}`));

          if (state.chatContext.objectTypes?.length || state.chatContext.links?.length || state.chatContext.objectsLimit || state.chatContext.objectsDepth) {
            console.log();
            console.log(chalk.bold('AI Context:'));
            if (state.chatContext.objectTypes && state.chatContext.objectTypes.length > 0) {
              console.log(chalk.dim(`  Object Types: ${state.chatContext.objectTypes.join(', ')}`));
            }
            if (state.chatContext.links && state.chatContext.links.length > 0) {
              console.log(chalk.dim(`  External Links: ${state.chatContext.links.join(', ')}`));
            }
            if (state.chatContext.objectsLimit) {
              console.log(chalk.dim(`  Objects Limit: ${state.chatContext.objectsLimit}`));
            }
            if (state.chatContext.objectsDepth) {
              console.log(chalk.dim(`  Objects Depth: ${state.chatContext.objectsDepth}`));
            }
          } else {
            console.log();
            console.log(chalk.dim('  No additional context configured.'));
            console.log(chalk.dim('  Use --content, --types, --links, --objects-limit, or --objects-depth when starting chat.'));
          }
          console.log();
          continue;
        }

        if (input.toLowerCase() === 'open') {
          if (state.lastDeploymentUrl) {
            console.log(chalk.dim(`  Opening ${state.lastDeploymentUrl}...`));
            const open = await import('open').then(m => m.default);
            await open(state.lastDeploymentUrl);
          } else {
            console.log(chalk.dim('  No deployment URL available. Deploy an app first.'));
          }
          continue;
        }

        // Handle "add content" command
        if (input.toLowerCase() === 'add content' || input.toLowerCase().startsWith('add content:')) {
          const contentDescription = input.toLowerCase().startsWith('add content:')
            ? input.substring('add content:'.length).trim()
            : '';

          console.log();
          spinner.start('Generating content for Cosmic CMS...');

          try {
            const contentPrompt = contentDescription
              ? `Generate Cosmic CMS content for: ${contentDescription}`
              : `Based on the code we've been working on, generate any Cosmic CMS object types and demo content that would be needed. Look at the types, API calls, and pages to determine what content is expected from Cosmic.`;

            const contextMessages = state.conversationHistory.slice(-6).map((msg) => ({
              role: msg.role as 'user' | 'assistant',
              content: [{ type: 'text' as const, text: msg.content }],
            }));

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

            const extractedContent = extractContentFromResponse(fullResponse);
            if (extractedContent.hasAddContent && (extractedContent.objectTypes.length > 0 || extractedContent.demoObjects.length > 0)) {
              const result = await installContentToCosmic(extractedContent, rl);
              if (result.nextAction === 'build') {
                state.isBuildMode = true;
                console.log();
                console.log(chalk.green('  Switching to build mode...'));
                console.log();
                console.log(chalk.cyan('  Describe the app you\'d like to build:'));
                console.log();
                console.log(chalk.dim('  Tip: Include details like:'));
                console.log(chalk.dim('    • Framework: Next.js, React, Vue, Astro'));
                console.log(chalk.dim('    • Design: modern, minimal, bold, elegant'));
                console.log(chalk.dim('    • Features: responsive, dark mode, animations'));
                console.log();
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

        // Extract and upload media attachments
        let messageText = input;
        state.pendingMediaIds = [];
        const cwd = process.cwd();
        const extracted = extractImagePathsFromInput(input, cwd);

        if (extracted.paths.length > 0) {
          try {
            spinner.start(`Uploading ${extracted.paths.length} image(s)...`);
            state.pendingMediaIds = await uploadImagesForChat(extracted.paths, bucketSlug);
            spinner.succeed(`Attached ${state.pendingMediaIds.length} image(s)`);
            const stripped = stripPathsFromMessage(input, extracted.segmentsToStrip);
            messageText = stripped || 'What can you tell me about this image?';
          } catch (err) {
            spinner.fail('Failed to upload images');
            display.error((err as Error).message);
            continue;
          }
        }

        // Add user message to history
        state.conversationHistory.push({
          role: 'user',
          content: messageText,
        });

        // Process message
        try {
          let shouldContinue = true;
          while (shouldContinue) {
            shouldContinue = await processMessage(model, rl, bucketSlug);
          }
          state.skipConfirmations = false;
          if (process.env.COSMIC_DEBUG === '1') {
            console.log(chalk.dim('[DEBUG] processMessage complete, about to loop back for next input'));
          }
        } catch (error) {
          state.skipConfirmations = false;
          if ((error as Error).message === '__EXIT_REQUESTED__') {
            rl.close();
            return;
          }
          console.error(chalk.red(`[DEBUG] Inner catch error: ${(error as Error).message}`));
          display.error((error as Error).message);
        }
      } catch (error) {
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

  runChatLoop().catch((error) => {
    console.error('Chat error:', error.message);
    process.exit(1);
  });
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

  try {
    // Build messages for the SDK with system prompt
    const systemPrompt = getSystemPrompt(bucketSlug);
    const messagesWithSystem = [
      { role: 'user' as const, content: systemPrompt + '\n\n' + state.conversationHistory[0]?.content },
      ...state.conversationHistory.slice(1).map(msg => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      })),
    ];

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
      console.log(chalk.dim(`    Max Tokens: ${state.isBuildMode ? '32000' : '16384'}${state.isBuildMode ? ' (build mode, streaming)' : ''}`));
      console.log(chalk.dim(`    Messages Count: ${messagesWithSystem.length}`));
      console.log(chalk.dim(`    System prompt length: ${systemPrompt.length} chars`));
      console.log(chalk.dim(`    User message: "${state.conversationHistory[0]?.content?.substring(0, 100)}${(state.conversationHistory[0]?.content?.length || 0) > 100 ? '...' : ''}"`));
      console.log(chalk.dim(`    Total payload size: ${JSON.stringify(messagesWithSystem).length} chars`));

      if (process.env.COSMIC_DEBUG === '2') {
        console.log(chalk.dim('  [DEBUG] System prompt preview (first 500 chars):'));
        console.log(chalk.dim('    ' + systemPrompt.substring(0, 500).replace(/\n/g, '\n    ') + '...'));
        console.log(chalk.dim(`  [DEBUG] Full SDK ${state.isBuildMode ? 'stream' : 'generateText'} call:`));
        console.log(chalk.dim('    ' + JSON.stringify({ model, max_tokens: state.isBuildMode ? 32000 : 16384, stream: state.isBuildMode, messagesCount: messagesWithSystem.length })));
      }
    }

    const maxTokens = state.isBuildMode ? 32000 : 16384;

    let response: ProcessMessageResponse & { _alreadyStreamed?: boolean; _contentHandledViaMetadata?: boolean };

    try {
      if (state.isBuildMode) {
        // ============== BUILD MODE ==============
        // Use Dashboard API for build mode
        let objectTypeSlugs: string[] = [];
        try {
          const objectTypes = await api.listObjectTypes(bucketSlug);
          objectTypeSlugs = objectTypes.map((ot: { slug: string }) => ot.slug);
          if (verbose) {
            console.log(chalk.dim(`  [DEBUG] Found ${objectTypeSlugs.length} object types: ${objectTypeSlugs.join(', ')}`));
          }
        } catch (err) {
          if (verbose) {
            console.log(chalk.dim(`  [DEBUG] Could not fetch object types: ${(err as Error).message}`));
          }
        }

        spinner.stop();
        console.log(chalk.dim(state.isAskMode ? '  Thinking...' : '  Generating app...'));
        console.log();

        const dashboardMessages = state.conversationHistory.map((msg) => ({
          role: msg.role as 'user' | 'assistant',
          content: [{ type: 'text' as const, text: msg.content }],
        }));

        let fileCount = 0;
        let currentFile = '';
        let fullText = '';
        let isGeneratingFiles = false;
        let lastPrintedLength = 0;
        let hasShownOverview = false;
        let overviewPrinted = 0;
        let structuredOutputConfirmed: boolean | null = null;

        const selectedTypes = (state.chatContext.objectTypes && state.chatContext.objectTypes.length > 0)
          ? state.chatContext.objectTypes
          : objectTypeSlugs;
        const buildContextConfig = (selectedTypes.length > 0 || state.chatContext.objectsLimit || state.chatContext.objectsDepth)
          ? {
            objects: {
              enabled: true,
              object_types: selectedTypes.length > 0 ? selectedTypes : undefined,
              include_models: true,
              limit: state.chatContext.objectsLimit ?? 100,
              depth: state.chatContext.objectsDepth ?? 1,
            },
          }
          : undefined;

        const result = await api.streamingChat({
          messages: dashboardMessages,
          bucketSlug,
          model,
          maxTokens,
          viewMode: 'build-app',
          selectedObjectTypes: selectedTypes,
          links: state.chatContext.links,
          media: state.pendingMediaIds.length > 0 ? state.pendingMediaIds : undefined,
          contextConfig: buildContextConfig,
          metadata: {
            chat_mode: state.isAskMode ? 'ask' : 'agent',
          },
          onChunk: (chunk) => {
            fullText += chunk;

            const fileStartMatch = fullText.match(/```\w*\n\/\/\s*([^\n]+)/g);
            if (fileStartMatch && fileStartMatch.length > fileCount) {
              if (!isGeneratingFiles) {
                isGeneratingFiles = true;
                console.log();
              }

              const lastMatch = fileStartMatch[fileStartMatch.length - 1];
              const fileNameMatch = lastMatch.match(/\/\/\s*(.+)/);
              if (fileNameMatch) {
                const newFile = fileNameMatch[1].trim();
                if (newFile !== currentFile) {
                  currentFile = newFile;
                  fileCount = fileStartMatch.length;
                  process.stdout.write(`\r${' '.repeat(60)}\r`);
                  console.log(chalk.dim(`  📄 ${newFile}`));
                }
              }
            } else if (!isGeneratingFiles) {
              const hasCompleteAppMarker = fullText.includes('<!-- APP_OVERVIEW_START -->');
              const hasCompleteMetadataMarker = fullText.includes('<!-- METADATA:');
              const hasCompleteReadmeMarker = fullText.includes('<!-- README_START -->');
              const hasAppMarkers = hasCompleteAppMarker || hasCompleteMetadataMarker || hasCompleteReadmeMarker;

              const hasPartialMarker = fullText.includes('<!--') && !hasAppMarkers;
              const endsWithPartialComment = /<!--[^>]*$/.test(fullText);

              if (structuredOutputConfirmed === null) {
                if (hasAppMarkers) {
                  structuredOutputConfirmed = true;
                } else if (hasPartialMarker && fullText.length < 500) {
                  lastPrintedLength = fullText.length;
                  return;
                } else if (!fullText.includes('<!--') && fullText.length > 100) {
                  structuredOutputConfirmed = false;
                } else if (fullText.length > 500) {
                  structuredOutputConfirmed = false;
                }
              }

              if (structuredOutputConfirmed === true || hasAppMarkers) {
                const overviewStart = fullText.indexOf('<!-- APP_OVERVIEW_START -->');
                const overviewEnd = fullText.indexOf('<!-- APP_OVERVIEW_END -->');

                if (overviewStart !== -1 && !hasShownOverview) {
                  const startPos = overviewStart + '<!-- APP_OVERVIEW_START -->'.length;
                  const endPos = overviewEnd !== -1 ? overviewEnd : fullText.length;
                  const overviewContent = fullText.slice(startPos, endPos);

                  if (overviewContent.length > overviewPrinted) {
                    const newContent = overviewContent.slice(overviewPrinted);
                    const filteredContent = newContent
                      .replace(/<!-- PROGRESS:[^>]+-->\s*```json\s*\/\/[^`]*```/g, '')
                      .replace(/<!-- PROGRESS:[^>]+-->/g, '')
                      .replace(/<!-- METADATA:[^>]+-->/g, '')
                      .replace(/<!-- FRAMEWORK:[^>]+-->/g, '')
                      .replace(/<!--[^>]*-->/g, '');
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
                  lastPrintedLength = fullText.length;
                }
              } else if (structuredOutputConfirmed === false) {
                const newContent = fullText.slice(lastPrintedLength);
                if (newContent && !endsWithPartialComment) {
                  const cleanContent = newContent.replace(/<!--[^>]*-->/g, '');
                  if (cleanContent) {
                    process.stdout.write(cleanContent);
                  }
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

        const alreadyStreamedText = !isGeneratingFiles && lastPrintedLength > 0;

        if (alreadyStreamedText) {
          console.log();
          console.log();
        }

        if (fileCount > 0) {
          console.log();
          console.log(chalk.green(`  ✓ Generated ${fileCount} file(s)`));
        }

        response = {
          text: result.text,
          messageId: result.messageId,
          usage: undefined,
          _alreadyStreamed: alreadyStreamedText,
        };
        state.pendingMediaIds = [];
      } else if (state.isRepoMode && state.currentRepo) {
        // ============== REPO MODE ==============
        spinner.stop();
        console.log(chalk.dim('  Analyzing and updating repository...'));

        const repoMessages = state.conversationHistory.map((msg) => ({
          role: msg.role as 'user' | 'assistant',
          content: msg.content,
        }));

        let fullText = '';
        let lastPrintedLength = 0;
        let fileCount = 0;
        let currentFile = '';
        let isEditingFiles = false;

        let pendingEnvVars: EnvVarFromBackend[] = [];
        let envVarsRequiredBeforeDeploy = false;

        let chunkQuietTimer: ReturnType<typeof setTimeout> | null = null;
        let codeSpinnerActive = false;

        const result = await streamingRepositoryUpdate({
          repositoryOwner: state.currentRepo.owner,
          repositoryName: state.currentRepo.name,
          repositoryId: state.currentRepo.id,
          bucketSlug,
          messages: repoMessages,
          branch: state.currentRepo.branch,
          model,
          maxTokens: 32000,
          chatMode: state.isAskMode ? 'ask' : 'agent',
          onChunk: (chunk) => {
            if (!chunk) return;

            if (codeSpinnerActive) {
              spinner.stop();
              codeSpinnerActive = false;
            }

            fullText += chunk;

            if (process.env.COSMIC_DEBUG === '2') {
              console.log(chalk.dim(`[CHUNK] "${chunk.replace(/\n/g, '\\n')}"`));
            }

            const fileEditMatch = fullText.match(/(?:##\s*(?:Editing|Creating|Modifying|Updating)\s*(?:file:?)?\s*`?([^`\n]+)`?|```(?:diff|typescript|javascript|tsx|jsx)\s*\n\/\/\s*([^\n]+))/gi);
            if (fileEditMatch && fileEditMatch.length > fileCount) {
              if (chunkQuietTimer) clearTimeout(chunkQuietTimer);

              if (!isEditingFiles) {
                isEditingFiles = true;
              }

              const lastMatch = fileEditMatch[fileEditMatch.length - 1];
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
              const newContent = fullText.slice(lastPrintedLength);
              if (newContent) {
                const cleanContent = newContent.replace(/\n{2,}/g, '\n');
                if (cleanContent.trim() || (cleanContent === '\n' && lastPrintedLength > 0)) {
                  process.stdout.write(cleanContent.trim() ? cleanContent : '');
                }
                lastPrintedLength = fullText.length;
              }

              if (chunkQuietTimer) clearTimeout(chunkQuietTimer);
              chunkQuietTimer = setTimeout(() => {
                console.log();
                console.log();
                spinner.start('Applying code changes...');
                codeSpinnerActive = true;
              }, 3000);
            }
          },
          onProgress: (progress) => {
            if (verbose && progress.message) {
              console.log(chalk.dim(`  [PROGRESS] ${progress.stage}: ${progress.message}`));
            }
            if (progress.stage === 'committing' || progress.stage === 'pushing') {
              if (codeSpinnerActive) {
                spinner.update(progress.message || `${progress.stage}...`);
              } else {
                process.stdout.write(`\r${' '.repeat(60)}\r`);
                console.log(chalk.dim(`  🔄 ${progress.message || progress.stage}...`));
              }
            }

            if (progress.stage === 'env_vars_required' && progress.env_vars && progress.env_vars.length > 0) {
              pendingEnvVars = progress.env_vars;
              envVarsRequiredBeforeDeploy = progress.required_before_deploy || false;

              if (verbose) {
                console.log(chalk.dim(`  [ENV VARS] Detected ${progress.env_vars.length} env var(s): ${progress.env_vars.map(v => v.key).join(', ')}`));
              }
            }
          },
        });

        if (chunkQuietTimer) clearTimeout(chunkQuietTimer);
        if (codeSpinnerActive) {
          spinner.stop();
          codeSpinnerActive = false;
        }

        const alreadyStreamedText = !isEditingFiles && lastPrintedLength > 0;

        if (alreadyStreamedText) {
          console.log();
        }

        const envVarsArePending = result.envVarsPending || (pendingEnvVars.length > 0 && envVarsRequiredBeforeDeploy);
        const envVarsToHandle = result.envVars || pendingEnvVars;
        const pendingOps = result.pendingOperations;

        if (envVarsArePending && pendingOps) {
          console.log();
          console.log(chalk.yellow('  ⏸️  Code Changes Ready - Deployment Paused'));
          console.log(chalk.dim('  Your code changes have been prepared but NOT committed yet.'));
          console.log(chalk.dim('  Configure the required environment variables below, then we will commit and deploy.'));
        } else if (fileCount > 0) {
          console.log(chalk.green(`  ✓ Updated ${fileCount} file(s)`));
          console.log(chalk.dim(`  Changes pushed to ${state.currentRepo.owner}/${state.currentRepo.name}`));
        }

        response = {
          text: result.text,
          messageId: result.requestId,
          usage: undefined,
          _alreadyStreamed: alreadyStreamedText,
        };

        // Handle env vars
        let envVarsConfigured = false;
        if (envVarsToHandle.length > 0) {
          console.log();
          if (envVarsArePending) {
            console.log(chalk.yellow(`  ⚠️  ${envVarsToHandle.length} environment variable(s) required before deployment:`));
          } else {
            console.log(chalk.yellow(`  ⚠️  Detected ${envVarsToHandle.length} environment variable(s) that need to be configured:`));
          }
          console.log();

          try {
            const existingEnvVars = await getRepositoryEnvVars(bucketSlug, state.currentRepo.id);
            const existingKeys = existingEnvVars.map((v) => v.key);

            const newEnvVars = envVarsToHandle.filter((v) => !existingKeys.includes(v.key));

            if (newEnvVars.length === 0) {
              console.log(chalk.green('  ✓ All detected environment variables are already configured'));
              envVarsConfigured = true;
            } else {
              newEnvVars.forEach((envVar, idx) => {
                console.log(chalk.cyan(`  ${idx + 1}. ${envVar.key}`));
                console.log(chalk.dim(`     ${markdownLinksToTerminal(envVar.description)}`));
                if (envVar.detected_in) {
                  console.log(chalk.dim(`     Detected in: ${envVar.detected_in}`));
                }
                console.log();
              });

              const promptMessage = envVarsArePending
                ? chalk.yellow('  Add these environment variables to proceed? [Y/n]: ')
                : chalk.yellow('  Would you like to add these environment variables now? [Y/n]: ');
              const addEnvVarsInput = await state.sharedAskLine!(promptMessage);

              if (addEnvVarsInput.toLowerCase() !== 'n') {
                console.log();

                let allConfigured = true;
                for (const envVar of newEnvVars) {
                  const valueInput = await state.sharedAskLine!(chalk.cyan(`  Enter value for ${envVar.key}: `));

                  if (valueInput.trim()) {
                    try {
                      await addRepositoryEnvVar(bucketSlug, state.currentRepo.id, {
                        key: envVar.key,
                        value: valueInput.trim(),
                        target: ['production', 'preview', 'development'],
                        type: 'encrypted',
                      });
                      console.log(chalk.green(`  ✓ Added ${envVar.key}`));
                    } catch (error) {
                      console.log(chalk.red(`  ✗ Failed to add ${envVar.key}: ${(error as Error).message}`));
                      allConfigured = false;
                    }
                  } else {
                    console.log(chalk.yellow(`  ⚠ Skipped ${envVar.key} (no value provided)`));
                    allConfigured = false;
                  }
                }

                console.log();
                console.log(chalk.green('  ✓ Environment variables configured'));
                envVarsConfigured = allConfigured;
              } else {
                console.log(chalk.yellow('  ⚠ Skipping environment variable configuration'));
                if (envVarsArePending) {
                  console.log(chalk.dim('  The deployment may fail if these variables are required at build time.'));
                  console.log();
                  const commitAnywayInput = await state.sharedAskLine!(chalk.yellow('  Commit without env var updates? [Y/n]: '));
                  if (commitAnywayInput.toLowerCase() !== 'n') {
                    envVarsConfigured = true;
                    console.log(chalk.dim('  Proceeding with commit without environment variables...'));
                  } else {
                    console.log(chalk.dim('  The commit will be skipped. Use "cosmic update" to try again later.'));
                  }
                } else {
                  console.log(chalk.dim('  The deployment may fail if these variables are required.'));
                }
              }
            }
          } catch (error) {
            console.error(chalk.red(`  Error checking environment variables: ${(error as Error).message}`));
          }
        }

        // If commit was blocked, now commit after env vars are configured
        let skipDeploymentPolling = false;

        if (envVarsArePending && pendingOps) {
          if (!envVarsConfigured && envVarsToHandle.length > 0) {
            console.log();
            console.log(chalk.yellow('  ⚠ Deployment cancelled - environment variables not configured'));
            console.log(chalk.dim('  Your code changes have NOT been committed. Configure the required'));
            console.log(chalk.dim('  environment variables and run "cosmic update" again to deploy.'));
            skipDeploymentPolling = true;
          } else {
            console.log();
            console.log(chalk.cyan('  📤 Committing changes...'));

            try {
              const commitResult = await commitPendingOperations({
                bucketSlug,
                operations: pendingOps.operations,
                commitMessage: pendingOps.commit_message,
                branch: pendingOps.branch,
                repoFullName: pendingOps.repo_full_name,
                repositoryId: state.currentRepo.id,
              });

              if (commitResult.success) {
                console.log(chalk.green('  ✓ Changes committed successfully'));
                if (commitResult.commit_url) {
                  console.log(chalk.dim(`  ${commitResult.commit_url}`));
                }

                console.log();
                console.log(chalk.yellow('  Checking for Vercel deployment...'));
              } else {
                console.log(chalk.red(`  ✗ Failed to commit changes: ${commitResult.message || commitResult.error}`));
                console.log(chalk.dim('  You may need to run "cosmic update" again to retry.'));
                skipDeploymentPolling = true;
              }
            } catch (commitError) {
              console.log(chalk.red(`  ✗ Commit error: ${(commitError as Error).message}`));
              skipDeploymentPolling = true;
            }
          }
        } else {
          console.log();
          console.log(chalk.yellow('  Checking for Vercel deployment...'));
        }

        if (skipDeploymentPolling) {
          state.conversationHistory.push({
            role: 'assistant',
            content: response.text || '',
          });
        }

        if (!skipDeploymentPolling) {
          await new Promise(resolve => setTimeout(resolve, 3000));

          let keepFixing = true;
          while (keepFixing) {
            try {
              const deployResult = await pollDeploymentStatus(
                bucketSlug,
                state.currentRepo.name,
                `https://github.com/${state.currentRepo.owner}/${state.currentRepo.name}`
              );

              if (deployResult.success) {
                keepFixing = false;
                break;
              }

              if (!deployResult.success && deployResult.logs && deployResult.logs.length > 0) {
                console.log();
                console.log(chalk.yellow('  Would you like AI to analyze the logs and fix the build error?'));
                const fixInput = await state.sharedAskLine!(chalk.yellow('  Fix with AI? [Y/n]: '));
                const fixWithAI = fixInput.toLowerCase() !== 'n';

                if (!fixWithAI) {
                  keepFixing = false;
                  break;
                }

                console.log();
                console.log(chalk.cyan('  Sending build logs to AI for analysis...'));
                console.log();

                const logsText = deployResult.logs
                  .filter(log => log.text && typeof log.text === 'string')
                  .map(log => `[${log.type}] ${log.text}`)
                  .join('\n');

                const userMessage = `The deployment failed with the following build logs. Please analyze the errors and fix the code:\n\n\`\`\`\n${logsText || 'No logs available'}\n\`\`\``;

                try {
                  let chunkQuietTimer2: ReturnType<typeof setTimeout> | null = null;
                  let codeSpinnerActive2 = false;

                  await streamingRepositoryUpdate({
                    repositoryOwner: state.currentRepo!.owner,
                    repositoryName: state.currentRepo!.name,
                    repositoryId: state.currentRepo!.id,
                    bucketSlug,
                    messages: [{
                      role: 'user',
                      content: userMessage,
                    }],
                    onChunk: (chunk) => {
                      if (codeSpinnerActive2) {
                        spinner.stop();
                        codeSpinnerActive2 = false;
                      }
                      process.stdout.write(chunk);
                      if (chunkQuietTimer2) clearTimeout(chunkQuietTimer2);
                      chunkQuietTimer2 = setTimeout(() => {
                        console.log();
                        console.log();
                        spinner.start('Generating code fixes...');
                        codeSpinnerActive2 = true;
                      }, 3000);
                    },
                    onProgress: (progress) => {
                      if (codeSpinnerActive2 && progress.message) {
                        spinner.update(progress.message);
                      }
                    },
                    onComplete: () => {
                      if (chunkQuietTimer2) clearTimeout(chunkQuietTimer2);
                      if (codeSpinnerActive2) {
                        spinner.succeed('AI has pushed fixes to the repository.');
                        codeSpinnerActive2 = false;
                      } else {
                        console.log();
                        console.log();
                        console.log(chalk.green('  ✓ AI has pushed fixes to the repository.'));
                      }
                      console.log(chalk.dim('  Vercel will automatically redeploy with the fixes.'));
                      console.log();
                    },
                    onError: (error) => {
                      if (chunkQuietTimer2) clearTimeout(chunkQuietTimer2);
                      if (codeSpinnerActive2) {
                        spinner.fail(`AI fix failed: ${error.message}`);
                        codeSpinnerActive2 = false;
                      } else {
                        console.log(chalk.red(`  ✗ AI fix failed: ${error.message}`));
                      }
                      console.log();
                    },
                  });

                  console.log(chalk.dim('  Waiting for new deployment to start...'));
                  await new Promise(resolve => setTimeout(resolve, 10000));
                } catch (aiError) {
                  console.log(chalk.red(`  ✗ Failed to fix with AI: ${(aiError as Error).message}`));
                  console.log();
                  keepFixing = false;
                }
              } else if (!deployResult.success && !deployResult.error) {
                console.log(chalk.dim('  Deployment is still in progress. Check Vercel dashboard for status.'));
                keepFixing = false;
              } else {
                keepFixing = false;
              }
            } catch (err) {
              if (verbose) {
                console.log(chalk.dim(`  [DEBUG] Deployment poll error: ${(err as Error).message}`));
              }
              console.log(chalk.dim('  Could not check deployment status. Changes were pushed to the repository.'));
              keepFixing = false;
            }
          }

          // Check for environment variables from content
          const detectedEnvVars = extractEnvVarsFromContent(fullText);
          if (detectedEnvVars.length > 0) {
            console.log();
            console.log(chalk.yellow(`  🔧 Detected ${detectedEnvVars.length} environment variable(s) that may need to be configured:`));
            console.log();

            try {
              const existingEnvVars = await getRepositoryEnvVars(bucketSlug, state.currentRepo.id);
              const existingKeys = existingEnvVars.map((v) => v.key);

              const newEnvVars = detectedEnvVars.filter((v) => !existingKeys.includes(v.key));

              if (newEnvVars.length === 0) {
                console.log(chalk.green('  ✓ All detected environment variables are already configured'));
              } else {
                newEnvVars.forEach((envVar, idx) => {
                  console.log(chalk.cyan(`  ${idx + 1}. ${envVar.key}`));
                  console.log(chalk.dim(`     ${markdownLinksToTerminal(envVar.description)}`));
                  const displayValue = envVar.value.includes('your_') || envVar.value.includes('your-')
                    ? envVar.value
                    : '<needs to be set>';
                  console.log(chalk.dim(`     Current: ${displayValue}`));
                  console.log();
                });

                const addEnvVarsInput = await state.sharedAskLine!(chalk.yellow('  Would you like to add these environment variables? [Y/n]: '));

                if (addEnvVarsInput.toLowerCase() !== 'n') {
                  console.log();

                  const envVarsToAdd: Array<{ key: string; value: string }> = [];

                  for (const envVar of newEnvVars) {
                    const defaultValue = envVar.value.includes('your_') || envVar.value.includes('your-')
                      ? ''
                      : envVar.value;

                    const valueInput = await state.sharedAskLine!(
                      chalk.cyan(`  Enter value for ${envVar.key}${defaultValue ? ` [${defaultValue}]` : ''}: `)
                    );

                    const finalValue = valueInput.trim() || defaultValue;

                    if (finalValue) {
                      envVarsToAdd.push({ key: envVar.key, value: finalValue });
                    } else {
                      console.log(chalk.dim(`  Skipping ${envVar.key} (no value provided)`));
                    }
                  }

                  if (envVarsToAdd.length > 0) {
                    console.log();
                    console.log(chalk.cyan('  Adding environment variables...'));

                    for (const envVar of envVarsToAdd) {
                      try {
                        await addRepositoryEnvVar(bucketSlug, state.currentRepo.id, {
                          key: envVar.key,
                          value: envVar.value,
                          target: ['production', 'preview', 'development'],
                          type: 'encrypted',
                        });
                        console.log(chalk.green(`  ✓ Added ${envVar.key}`));
                      } catch (error) {
                        console.log(chalk.red(`  ✗ Failed to add ${envVar.key}: ${(error as Error).message}`));
                      }
                    }

                    console.log();
                    console.log(chalk.green('  ✓ Environment variables added successfully'));
                    console.log(chalk.yellow('  ⚠ Note: A redeploy is needed for the changes to take effect'));

                    const redeployInput = await state.sharedAskLine!(chalk.yellow('  Would you like to trigger a redeploy now? [Y/n]: '));

                    if (redeployInput.toLowerCase() !== 'n') {
                      console.log();
                      console.log(chalk.cyan('  Triggering redeploy...'));

                      try {
                        await deployRepository(bucketSlug, state.currentRepo.id);
                        console.log(chalk.green('  ✓ Redeploy triggered!'));
                        console.log(chalk.dim('  The site will be updated shortly.'));

                        console.log();
                        console.log(chalk.yellow('  Waiting for deployment...'));
                        await new Promise((resolve) => setTimeout(resolve, 3000));

                        await pollDeploymentStatus(
                          bucketSlug,
                          state.currentRepo.name,
                          `https://github.com/${state.currentRepo.owner}/${state.currentRepo.name}`
                        );
                      } catch (deployError) {
                        console.log(chalk.red(`  ✗ Failed to trigger redeploy: ${(deployError as Error).message}`));
                      }
                    }
                  }
                }
              }
            } catch (error) {
              if (verbose) {
                console.log(chalk.dim(`  [DEBUG] Env var check error: ${(error as Error).message}`));
              }
              console.log(chalk.dim('  Could not check environment variables. You may need to configure them manually.'));
            }
          }
        }

        // Check for content in AI response
        const extractedContent = extractContentFromResponse(fullText);
        if (extractedContent.hasAddContent && (extractedContent.objectTypes.length > 0 || extractedContent.demoObjects.length > 0)) {
          const result = await installContentToCosmic(extractedContent, rl);
          if (result.nextAction === 'build') {
            state.isBuildMode = true;
            state.isRepoMode = false;
            state.currentRepo = null;
            console.log();
            console.log(chalk.green('  Switching to build mode...'));
            console.log();
            console.log(chalk.cyan('  Describe the app you\'d like to build:'));
            console.log();
            console.log(chalk.dim('  Tip: Include details like:'));
            console.log(chalk.dim('    • Framework: Next.js, React, Vue, Astro'));
            console.log(chalk.dim('    • Design: modern, minimal, bold, elegant'));
            console.log(chalk.dim('    • Features: responsive, dark mode, animations'));
            console.log();
          } else if (result.nextAction === 'exit') {
            console.log(chalk.dim('  Goodbye!'));
            rl.close();
            return;
          }
        } else {
          const cosmicContentMentioned = detectCosmicContentMention(fullText);
          if (cosmicContentMentioned) {
            await offerContentGeneration(fullText, state.conversationHistory, model, bucketSlug, rl);
          }
        }
      } else if (state.isAutomateMode) {
        // ============== AUTOMATE MODE ==============
        const dashboardMessages = state.conversationHistory.map((msg) => ({
          role: msg.role as 'user' | 'assistant',
          content: [{
            type: 'text' as const,
            text: msg.content,
          }],
        }));

        let fullText = '';
        let printedLength = 0;
        let insideJsonBlock = false;
        let firstChunkReceived = false;
        let dotCount = 0;
        let jsonLoadingInterval: NodeJS.Timeout | null = null;

        spinner.stop();

        const clearLine = '\x1b[2K\r';

        console.log();
        const loadingMessage = state.isAskMode ? 'Thinking' : 'Planning automation';
        process.stdout.write(chalk.dim(`  ${loadingMessage}.`));
        const loadingInterval = setInterval(() => {
          dotCount = (dotCount + 1) % 4;
          process.stdout.write('\r' + chalk.dim(`  ${loadingMessage}` + '.'.repeat(dotCount + 1).padEnd(4)));
        }, 400);

        const startJsonLoading = () => {
          if (jsonLoadingInterval) return;
          let jDotCount = 0;
          process.stdout.write('\n' + chalk.dim('  Generating automation config.'));
          jsonLoadingInterval = setInterval(() => {
            jDotCount = (jDotCount + 1) % 4;
            process.stdout.write('\r' + chalk.dim('  Generating automation config' + '.'.repeat(jDotCount + 1).padEnd(4)));
          }, 400);
        };

        const stopJsonLoading = () => {
          if (!jsonLoadingInterval) return;
          clearInterval(jsonLoadingInterval);
          jsonLoadingInterval = null;
          process.stdout.write(clearLine);
        };

        const result = await api.streamingChat({
          messages: dashboardMessages,
          bucketSlug,
          model,
          maxTokens,
          viewMode: 'automate',
          selectedObjectTypes: state.chatContext.objectTypes || [],
          links: state.chatContext.links,
          media: state.pendingMediaIds.length > 0 ? state.pendingMediaIds : undefined,
          metadata: {
            chat_mode: state.isAskMode ? 'ask' : 'agent',
          },
          onChunk: (chunk) => {
            fullText += chunk;

            if (!firstChunkReceived) {
              firstChunkReceived = true;
              clearInterval(loadingInterval);
              process.stdout.write(clearLine);
            }

            let safeToPrint = printedLength;
            let i = printedLength;
            while (i < fullText.length) {
              if (!insideJsonBlock) {
                const remaining = fullText.slice(i);
                if (remaining.startsWith('```json:agent') || remaining.startsWith('```json:workflow')) {
                  insideJsonBlock = true;
                  if (safeToPrint < i) {
                    const newContent = fullText.slice(printedLength, i);
                    if (newContent) process.stdout.write(newContent);
                  }
                  printedLength = i;
                  startJsonLoading();
                  i++;
                  continue;
                }
                if (remaining.startsWith('`') && remaining.length < 16) {
                  break;
                }
                safeToPrint = i + 1;
              } else {
                const remaining = fullText.slice(i);
                if (remaining.startsWith('```') && !remaining.startsWith('```json:')) {
                  insideJsonBlock = false;
                  stopJsonLoading();
                  i += 3;
                  safeToPrint = i;
                  printedLength = i;
                  continue;
                }
              }
              i++;
            }

            if (!insideJsonBlock && safeToPrint > printedLength) {
              const newContent = fullText.slice(printedLength, safeToPrint);
              if (newContent) process.stdout.write(newContent);
              printedLength = safeToPrint;
            }
          },
        });

        if (!firstChunkReceived) {
          clearInterval(loadingInterval);
          process.stdout.write(clearLine);
        }
        stopJsonLoading();

        if (!insideJsonBlock && printedLength < fullText.length) {
          const remaining = fullText.slice(printedLength);
          const cleaned = remaining.replace(/```json:(?:agent|workflow)\s*\n[\s\S]*?```/g, '');
          if (cleaned.trim()) process.stdout.write(cleaned);
        }

        console.log();

        state.pendingMediaIds = [];

        const aiText = result?.text || fullText;

        const messageId = result?.messageId;
        state.conversationHistory.push({
          role: 'assistant',
          content: aiText,
        });

        const agentBlocks = extractJsonBlocks(aiText, 'agent');
        const workflowBlocks = extractJsonBlocks(aiText, 'workflow');

        if (agentBlocks.length > 0 || workflowBlocks.length > 0) {
          console.log();
          console.log(chalk.bold('Automation plan ready:'));
          if (agentBlocks.length > 0) {
            console.log(chalk.dim(`  ${agentBlocks.length} agent${agentBlocks.length !== 1 ? 's' : ''} to create`));
          }
          if (workflowBlocks.length > 0) {
            console.log(chalk.dim(`  ${workflowBlocks.length} workflow${workflowBlocks.length !== 1 ? 's' : ''} to create`));
          }
          console.log();

          const confirmAnswer = await askQuestion(rl, chalk.yellow('Create these? [Y/n]: '));
          if (confirmAnswer.toLowerCase() === 'n' || confirmAnswer.toLowerCase() === 'no') {
            console.log(chalk.dim('  Skipped. You can modify the plan and try again.'));
          } else {
            for (const agentJson of agentBlocks) {
              try {
                const agentData = JSON.parse(agentJson);
                console.log(chalk.dim(`  Creating agent: ${agentData.emoji || ''} ${agentData.agent_name}...`));
                await createAgent(bucketSlug, agentData);
                console.log(chalk.green(`  ✓ Agent created: ${agentData.agent_name}`));
              } catch (err) {
                console.log(chalk.red(`  ✗ Failed to create agent: ${(err as Error).message}`));
              }
            }
            for (const workflowJson of workflowBlocks) {
              try {
                const workflowData = JSON.parse(workflowJson);
                console.log(chalk.dim(`  Creating workflow: ${workflowData.emoji || ''} ${workflowData.workflow_name}...`));
                await createWorkflow(bucketSlug, workflowData);
                console.log(chalk.green(`  ✓ Workflow created: ${workflowData.workflow_name}`));
              } catch (err) {
                console.log(chalk.red(`  ✗ Failed to create workflow: ${(err as Error).message}`));
              }
            }
          }
        }

        response = {
          text: aiText,
          usage: result?.usage,
          messageId,
          _alreadyStreamed: true,
        };
      } else {
        // ============== CONTENT/ASK MODE ==============
        const dashboardMessages = state.conversationHistory.map((msg) => ({
          role: msg.role as 'user' | 'assistant',
          content: [{
            type: 'text' as const,
            text: msg.content,
          }],
        }));

        let fullText = '';
        let lastPrintedLength = 0;
        let isContentModelMode = false;
        let dotCount = 0;
        let loadingInterval: NodeJS.Timeout | null = null;

        const lastUserMessage = state.conversationHistory[state.conversationHistory.length - 1]?.content?.toLowerCase() || '';

        const isLikelyContentModel = lastUserMessage.includes('content model') ||
          lastUserMessage.includes('object type') ||
          lastUserMessage.includes('install_content_model');

        const isLikelyContentAction = /\b(create|add|new|update|edit|delete|remove)\b.*\b(post|blog|article|page|product|item|entry|content|object)\b/i.test(lastUserMessage) ||
          /\b(post|blog|article|page|product|item|entry|content|object)\b.*\b(create|add|new|update|edit|delete|remove)\b/i.test(lastUserMessage);

        const isLikelyActionResponse = isLikelyContentModel || isLikelyContentAction;

        if (isLikelyActionResponse) {
          console.log();
          const loadingMessage = isLikelyContentModel ? 'Generating content model' : 'Processing';
          process.stdout.write(chalk.dim(`  ${loadingMessage}`));
          loadingInterval = setInterval(() => {
            dotCount = (dotCount + 1) % 4;
            process.stdout.write('\r' + chalk.dim(`  ${loadingMessage}` + '.'.repeat(dotCount + 1).padEnd(4)));
          }, 400);
        } else {
          console.log();
        }

        const contextConfig = state.chatContext.objectTypes && state.chatContext.objectTypes.length > 0 ? {
          objects: {
            enabled: true,
            object_types: state.chatContext.objectTypes,
            include_models: true,
            limit: state.chatContext.objectsLimit ?? 10,
            depth: state.chatContext.objectsDepth ?? 1,
            props: ['id', 'title', 'slug', 'metadata', 'content'],
          },
        } : undefined;

        const result = await api.streamingChat({
          messages: dashboardMessages,
          bucketSlug,
          model,
          maxTokens,
          viewMode: 'content-model',
          selectedObjectTypes: state.chatContext.objectTypes || [],
          links: state.chatContext.links,
          media: state.pendingMediaIds.length > 0 ? state.pendingMediaIds : undefined,
          contextConfig,
          metadata: {
            chat_mode: state.isAskMode ? 'ask' : 'content',
          },
          onChunk: (chunk) => {
            fullText += chunk;

            if (!isContentModelMode) {
              if (containsMetadataMarker(fullText) || fullText.includes('ACTION:')) {
                isContentModelMode = true;

                const cleanText = cleanResponseForDisplay(fullText);
                const newContent = cleanText.slice(lastPrintedLength);
                if (newContent) {
                  process.stdout.write(newContent);
                  lastPrintedLength = cleanText.length;
                }
                return;
              }
            }

            if (isContentModelMode || isLikelyActionResponse) {
              return;
            }

            const cleanText = cleanResponseForDisplay(fullText);
            const newContent = cleanText.slice(lastPrintedLength);
            if (newContent) {
              process.stdout.write(newContent);
              lastPrintedLength = cleanText.length;
            }
          },
        });

        if (loadingInterval) {
          clearInterval(loadingInterval);
          process.stdout.write('\r' + ' '.repeat(40) + '\r');
        }

        const alreadyStreamedText = lastPrintedLength > 0 && !isContentModelMode;

        if (alreadyStreamedText) {
          console.log();
        }

        response = {
          text: result.text,
          messageId: result.messageId,
          usage: undefined,
          _alreadyStreamed: alreadyStreamedText || isContentModelMode,
          _contentHandledViaMetadata: false,
        };
        state.pendingMediaIds = [];

        // Check if AI response contains content to add
        const extractedContent = extractContentFromResponse(fullText);
        if (extractedContent.hasAddContent && (extractedContent.objectTypes.length > 0 || extractedContent.demoObjects.length > 0)) {
          (response as any)._contentHandledViaMetadata = true;
          const contentResult = await installContentToCosmic(extractedContent, rl);
          if (contentResult.nextAction === 'build') {
            state.isBuildMode = true;
            console.log();
            console.log(chalk.green('  Switching to build mode...'));
            console.log();
            console.log(chalk.cyan('  Describe the app you\'d like to build:'));
            console.log();
            console.log(chalk.dim('  Tip: Include details like:'));
            console.log(chalk.dim('    • Framework: Next.js, React, Vue, Astro'));
            console.log(chalk.dim('    • Design: modern, minimal, bold, elegant'));
            console.log(chalk.dim('    • Features: responsive, dark mode, animations'));
            console.log();
          } else if (contentResult.nextAction === 'exit') {
            console.log(chalk.dim('  Goodbye!'));
            rl.close();
            return;
          }
        } else if (!isContentModelMode && !alreadyStreamedText && fullText.trim()) {
          const cleanText = cleanResponseForDisplay(fullText);
          if (cleanText.trim()) {
            console.log();
            console.log(formatResponse(cleanText.trim()));
          }
        }
      }
    } catch (apiError) {
      const err = apiError as Error & { response?: { data?: unknown }; cause?: unknown };

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
        console.log(chalk.dim(`    Full Error: ${JSON.stringify(err, Object.getOwnPropertyNames(err), 2)}`));
      }

      if (isAITokenLimitError(err)) {
        showAITokenUpgradePrompt(err, { model });

        state.conversationHistory.pop();
        return;
      }

      throw apiError;
    }

    // ============== POST-PROCESSING ==============
    if (response.text) {
      let displayText = '';
      let actionResults: string[] = [];
      let actionExecuted = false;

      const skipActionProcessing = state.isContentMode || (response as any)._contentHandledViaMetadata === true;

      const actionIndex = response.text.indexOf('ACTION:');
      if (actionIndex !== -1 && !actionExecuted && !skipActionProcessing) {
        const afterAction = response.text.substring(actionIndex + 7).trim();

        const jsonStartIndex = afterAction.search(/[{[]/);
        if (jsonStartIndex !== -1) {
          const jsonStart = afterAction.substring(jsonStartIndex);

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

            if (result === 'EXIT_REQUESTED') {
              console.log(chalk.dim('  Goodbye!'));
              throw new Error('__EXIT_REQUESTED__');
            }

            actionResults.push(result);
            actionExecuted = true;

            const actionEndInOriginal = actionIndex + 7 + jsonStartIndex + jsonEndIndex;
            displayText = response.text.substring(0, actionIndex) + response.text.substring(actionEndInOriginal);
          } else {
            const firstLine = afterAction.split('\n')[0];
            try {
              const result = await executeAction(firstLine);
              actionResults.push(result);
              actionExecuted = true;
            } catch {
              actionResults.push(`Error: Could not parse ACTION JSON - ${(firstLine || '').substring(0, 100)}...`);
            }
            displayText = response.text.split('\n').filter(line => !line.trim().startsWith('ACTION:')).join('\n');
          }
        } else {
          displayText = response.text.split('\n').filter(line => !line.trim().startsWith('ACTION:')).join('\n');
        }
      } else {
        displayText = response.text;
      }

      displayText = cleanResponseForDisplay(displayText);

      const appMetadata = extractAppMetadata(response.text);
      const buildFiles = appMetadata.framework && appMetadata.appName ? parseCodeBlocks(response.text) : {};
      const buildFileCount = Object.keys(buildFiles).length;
      const isAppBuild = buildFileCount > 0;

      const alreadyStreamed = (response as { _alreadyStreamed?: boolean })._alreadyStreamed;
      if (displayText.trim() && !isAppBuild && !alreadyStreamed) {
        console.log();
        console.log(formatResponse(displayText.trim()));
      } else if (isAppBuild) {
        const introText = displayText.split('```')[0].trim();
        if (introText && introText.length > 10) {
          console.log();
          const firstParagraph = introText.split('\n\n')[0];
          if (firstParagraph) {
            console.log(formatResponse(firstParagraph));
          }
        }
      }

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

        const fileNames = Object.keys(buildFiles);
        const filesToShow = fileNames.slice(0, 5);
        for (const fileName of filesToShow) {
          console.log(chalk.dim(`     📄 ${fileName}`));
        }
        if (fileNames.length > 5) {
          console.log(chalk.dim(`     ... and ${fileNames.length - 5} more files`));
        }
        console.log();

        try {
          const defaultName = appMetadata.appName;
          let repoName = '';

          while (true) {
            const repoNameInput = await state.sharedAskLine!(chalk.yellow(`  Repository name [${defaultName}]: `));
            repoName = repoNameInput.trim() || defaultName;

            const repoSlug = repoName
              .toLowerCase()
              .replace(/\s+/g, '-')
              .replace(/[^a-z0-9-]/g, '-')
              .replace(/-+/g, '-')
              .replace(/^-|-$/g, '');

            console.log(chalk.dim(`  Checking availability...`));
            try {
              const availability = await api.checkRepoAvailability(repoSlug);

              if (availability.github_repository?.available) {
                repoName = repoSlug;
                console.log(chalk.green(`  ✓ Repository name "${repoSlug}" is available`));
                break;
              } else {
                console.log(chalk.yellow(`  ✗ ${availability.github_repository?.message || 'Repository name not available'}`));

                if (availability.github_repository?.suggestions && availability.github_repository.suggestions.length > 0) {
                  console.log(chalk.dim(`  Suggestions: ${availability.github_repository.suggestions.join(', ')}`));
                }
                console.log();
              }
            } catch (checkError) {
              if (verbose) {
                console.log(chalk.dim(`  [DEBUG] Availability check failed: ${(checkError as Error).message}`));
              }
              repoName = repoSlug;
              break;
            }
          }

          const privateInput = await state.sharedAskLine!(chalk.yellow(`  Private repository? [y/N]: `));
          const isPrivate = privateInput.toLowerCase() === 'y';

          const deployInput = await state.sharedAskLine!(chalk.yellow(`  Deploy to Vercel? [Y/n]: `));
          const shouldDeploy = deployInput.toLowerCase() !== 'n';

          console.log();
          console.log(chalk.yellow(`  Creating repository and deploying...`));

          const result = await api.deployAIApp({
            platform: 'github',
            web_platform: shouldDeploy ? 'vercel' : undefined,
            framework: appMetadata.framework,
            name: repoName,
            ai_response: response.text,
            message_id: response.messageId,
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

            if (verbose) {
              console.log(`[DEBUG] Deploy result: ${JSON.stringify(result.data, null, 2)}`);
            }

            if (shouldDeploy) {
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

              let currentDeployResult = deployResult;

              const urlParts = repositoryUrl ? repositoryUrl.replace('https://github.com/', '').split('/') : [];
              const repoOwner = urlParts[0] || 'cosmic-community';
              const repoNameFromUrl = urlParts[1] || repoName;

              while (!currentDeployResult.success && currentDeployResult.logs && currentDeployResult.logs.length > 0 && repositoryUrl) {
                console.log();
                console.log(chalk.yellow('  Would you like AI to analyze the logs and fix the build error?'));
                const fixInput = await state.sharedAskLine!(chalk.yellow('  Fix with AI? [Y/n]: '));
                const fixWithAI = fixInput.toLowerCase() !== 'n';

                if (!fixWithAI) {
                  break;
                }

                console.log();
                console.log(chalk.cyan('  Sending build logs to AI for analysis...'));
                console.log();

                const logsText = currentDeployResult.logs
                  .filter(log => log.text && typeof log.text === 'string')
                  .map(log => `[${log.type}] ${log.text}`)
                  .join('\n');

                const userMessage = `The deployment failed with the following build logs. Please analyze the errors and fix the code:\n\n\`\`\`\n${logsText || 'No logs available'}\n\`\`\``;

                try {
                  let chunkQuietTimer: ReturnType<typeof setTimeout> | null = null;
                  let codeSpinnerActive = false;

                  await streamingRepositoryUpdate({
                    repositoryOwner: repoOwner,
                    repositoryName: repoNameFromUrl,
                    repositoryId,
                    bucketSlug,
                    messages: [{
                      role: 'user',
                      content: userMessage,
                    }],
                    onChunk: (chunk) => {
                      if (codeSpinnerActive) {
                        spinner.stop();
                        codeSpinnerActive = false;
                      }
                      process.stdout.write(chunk);
                      if (chunkQuietTimer) clearTimeout(chunkQuietTimer);
                      chunkQuietTimer = setTimeout(() => {
                        console.log();
                        console.log();
                        spinner.start('Generating code fixes...');
                        codeSpinnerActive = true;
                      }, 3000);
                    },
                    onProgress: (progress) => {
                      if (codeSpinnerActive && progress.message) {
                        spinner.update(progress.message);
                      }
                    },
                    onComplete: () => {
                      if (chunkQuietTimer) clearTimeout(chunkQuietTimer);
                      if (codeSpinnerActive) {
                        spinner.succeed('AI has pushed fixes to the repository.');
                        codeSpinnerActive = false;
                      } else {
                        console.log();
                        console.log();
                        console.log(chalk.green('  ✓ AI has pushed fixes to the repository.'));
                      }
                      console.log(chalk.dim('  Vercel will automatically redeploy with the fixes.'));
                      console.log();
                    },
                    onError: (error) => {
                      if (chunkQuietTimer) clearTimeout(chunkQuietTimer);
                      if (codeSpinnerActive) {
                        spinner.fail(`AI fix failed: ${error.message}`);
                        codeSpinnerActive = false;
                      } else {
                        console.log(chalk.red(`  ✗ AI fix failed: ${error.message}`));
                      }
                      console.log();
                    },
                  });

                  console.log(chalk.dim('  Waiting for new deployment to start...'));
                  await new Promise(resolve => setTimeout(resolve, 10000));

                  currentDeployResult = await pollDeploymentStatus(bucketSlug, vercelProjectId, repositoryUrl);
                } catch (aiError) {
                  console.log(chalk.red(`  ✗ Failed to fix with AI: ${(aiError as Error).message}`));
                  console.log();
                  break;
                }
              }

              if (currentDeployResult.success && repositoryUrl) {
                state.isBuildMode = false;
                state.isRepoMode = true;
                state.currentRepo = {
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

              // Check if AI response contains content to add (build mode)
              const extractedContent = extractContentFromResponse(response.text);
              if (extractedContent.hasAddContent && (extractedContent.objectTypes.length > 0 || extractedContent.demoObjects.length > 0)) {
                const contentResult = await installContentToCosmic(extractedContent, rl);
                if (contentResult.nextAction === 'exit') {
                  console.log(chalk.dim('  Goodbye!'));
                  rl.close();
                  return;
                }
              }
            } else {
              console.log();
              console.log(chalk.green(`  ✓ App "${repoName}" created successfully!`));
              console.log();
              if (repositoryUrl) {
                console.log(chalk.dim('  Next steps:'));
                console.log(chalk.dim(`  1. Clone your repo: git clone ${repositoryUrl}`));
                console.log(chalk.dim(`  2. Run locally: cd ${repositoryUrl.split('/').pop()} && npm install && npm run dev`));
                console.log();
              }

              const extractedContent = extractContentFromResponse(response.text);
              if (extractedContent.hasAddContent && (extractedContent.objectTypes.length > 0 || extractedContent.demoObjects.length > 0)) {
                const contentResult = await installContentToCosmic(extractedContent, rl);
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

      state.conversationHistory.push({
        role: 'assistant',
        content: fullResponse,
      });

      // Auto-continue for batch creation
      if (actionExecuted && actionResults.length > 0) {
        const lastResult = actionResults[actionResults.length - 1];
        if (lastResult.startsWith('✓ Created') || lastResult.startsWith('✓ Confirmed')) {
          state.conversationHistory.push({
            role: 'user',
            content: 'Continue with the next item if there are more to create. If all items are done, say "All done!"',
          });

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

    return false;
  } catch (error) {
    spinner.fail();
    throw error;
  }
}

export default { startChat };
