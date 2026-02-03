/**
 * AI Commands
 * Text, image, and video generation
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { requireBucket } from '../config/context.js';
import { getDefaultModel } from '../config/store.js';
import * as display from '../utils/display.js';
import * as spinner from '../utils/spinner.js';
import { getSDKClient } from '../api/sdk.js';

/**
 * Generate text using the Cosmic SDK with streaming output
 */
async function generateText(
  prompt: string,
  options: {
    model?: string;
    maxTokens?: string;
    temperature?: string;
    json?: boolean;
  }
): Promise<void> {
  requireBucket(); // Ensure bucket is configured

  const sdk = getSDKClient();
  if (!sdk) {
    display.error('SDK not configured. Run "cosmic use" to configure bucket keys.');
    process.exit(1);
  }

  const model = options.model || getDefaultModel();

  try {
    // Use SDK streaming for real-time output
    const stream = await sdk.ai.stream({
      prompt,
      model,
      max_tokens: options.maxTokens ? parseInt(options.maxTokens, 10) : 4096,
    });

    let fullText = '';
    let hasStarted = false;

    // Use async iterator for streaming chunks
    for await (const chunk of stream) {
      // Handle different chunk formats
      let text: string | undefined;

      // Format 1: Anthropic-style content_block_delta
      if (chunk.type === 'content_block_delta' && chunk.delta?.text) {
        text = chunk.delta.text;
      }
      // Format 2: SSE data with text property (SDK format)
      else if (chunk.text) {
        text = chunk.text;
      }
      // Format 3: Direct string chunk
      else if (typeof chunk === 'string') {
        text = chunk;
      }

      if (text) {
        fullText += text;

        // Skip leading whitespace
        if (!hasStarted) {
          const trimmed = text.replace(/^\s+/, '');
          if (trimmed) {
            hasStarted = true;
            process.stdout.write(trimmed);
          }
        } else {
          process.stdout.write(text);
        }
      }
    }

    // Add newline after streaming completes
    console.log();

    if (options.json) {
      display.json({ text: fullText });
    }
  } catch (error: unknown) {
    display.newline();

    // Better error handling for SDK errors
    if (error instanceof Error) {
      display.error(error.message);
    } else if (typeof error === 'object' && error !== null) {
      const errObj = error as { response?: { data?: { message?: string; error?: string } }; message?: string; error?: string };
      const message = errObj.response?.data?.message || errObj.response?.data?.error || errObj.message || errObj.error || 'Unknown error';
      display.error(message);
    } else {
      display.error(String(error));
    }

    if (process.env.COSMIC_DEBUG === '1') {
      // Safely log error without circular references
      try {
        const safeError = {
          message: (error as Error)?.message,
          name: (error as Error)?.name,
          response: (error as { response?: { status?: number; data?: unknown } })?.response?.data,
        };
        console.log(chalk.dim('  [DEBUG] Error details:'), JSON.stringify(safeError, null, 2));
      } catch {
        console.log(chalk.dim('  [DEBUG] Error (non-serializable):'), (error as Error)?.message || 'Unknown');
      }
    }

    process.exit(1);
  }
}

/**
 * Generate image using the Cosmic SDK
 */
async function generateImage(
  prompt: string,
  options: {
    folder?: string;
    altText?: string;
    json?: boolean;
  }
): Promise<void> {
  requireBucket(); // Ensure bucket is configured

  const sdk = getSDKClient();
  if (!sdk) {
    display.error('SDK not configured. Run "cosmic use" to configure bucket keys.');
    process.exit(1);
  }

  try {
    spinner.start('Generating image...');

    const result = await sdk.ai.generateImage({
      prompt,
      folder: options.folder,
      alt_text: options.altText,
    });

    spinner.succeed('Image generated');

    const media = result.media;

    if (options.json) {
      display.json(media);
      return;
    }

    display.keyValue('ID', media.id);
    display.keyValue('Name', media.name);
    display.keyValue('URL', media.url);
    if (media.imgix_url) {
      display.keyValue('Imgix URL', media.imgix_url);
    }
    if (media.width && media.height) {
      display.keyValue('Dimensions', `${media.width} x ${media.height}`);
    }
  } catch (error: unknown) {
    spinner.fail('Failed to generate image');

    // Better error handling for SDK errors
    if (error instanceof Error) {
      display.error(error.message);
    } else if (typeof error === 'object' && error !== null) {
      // SDK might return axios errors with response data
      const axiosError = error as { response?: { data?: { message?: string } }; message?: string };
      const message = axiosError.response?.data?.message || axiosError.message || JSON.stringify(error);
      display.error(message);
    } else {
      display.error(String(error));
    }

    if (process.env.COSMIC_DEBUG === '1') {
      console.log(chalk.dim('  [DEBUG] Full error:'), error);
    }

    process.exit(1);
  }
}

/**
 * Chat with AI using the Cosmic SDK with streaming
 */
async function chat(
  message: string,
  options: {
    model?: string;
    system?: string;
    json?: boolean;
  }
): Promise<void> {
  requireBucket(); // Ensure bucket is configured

  const sdk = getSDKClient();
  if (!sdk) {
    display.error('SDK not configured. Run "cosmic use" to configure bucket keys.');
    process.exit(1);
  }

  const model = options.model || getDefaultModel();

  // Build messages array for SDK
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  // Note: SDK doesn't support system role, so prepend to first user message if provided
  let userMessage = message;
  if (options.system) {
    userMessage = `${options.system}\n\n${message}`;
  }

  messages.push({
    role: 'user',
    content: userMessage,
  });

  try {
    // Use SDK streaming for real-time output
    const stream = await sdk.ai.stream({
      messages,
      model,
      max_tokens: 4096,
    });

    let fullText = '';
    let hasStarted = false;

    // Use async iterator for streaming chunks
    for await (const chunk of stream) {
      // Handle different chunk formats
      let text: string | undefined;

      // Format 1: Anthropic-style content_block_delta
      if (chunk.type === 'content_block_delta' && chunk.delta?.text) {
        text = chunk.delta.text;
      }
      // Format 2: SSE data with text property (SDK format)
      else if (chunk.text) {
        text = chunk.text;
      }
      // Format 3: Direct string chunk
      else if (typeof chunk === 'string') {
        text = chunk;
      }

      if (text) {
        fullText += text;

        // Skip leading whitespace
        if (!hasStarted) {
          const trimmed = text.replace(/^\s+/, '');
          if (trimmed) {
            hasStarted = true;
            process.stdout.write(trimmed);
          }
        } else {
          process.stdout.write(text);
        }
      }
    }

    // Add newline after streaming completes
    console.log();

    if (options.json) {
      display.json({ text: fullText });
    }
  } catch (error: unknown) {
    display.newline();

    // Better error handling for SDK errors
    if (error instanceof Error) {
      display.error(error.message);
    } else if (typeof error === 'object' && error !== null) {
      const errObj = error as { response?: { data?: { message?: string; error?: string } }; message?: string; error?: string };
      const message = errObj.response?.data?.message || errObj.response?.data?.error || errObj.message || errObj.error || 'Unknown error';
      display.error(message);
    } else {
      display.error(String(error));
    }

    if (process.env.COSMIC_DEBUG === '1') {
      // Safely log error without circular references
      try {
        const safeError = {
          message: (error as Error)?.message,
          name: (error as Error)?.name,
          response: (error as { response?: { status?: number; data?: unknown } })?.response?.data,
        };
        console.log(chalk.dim('  [DEBUG] Error details:'), JSON.stringify(safeError, null, 2));
      } catch {
        console.log(chalk.dim('  [DEBUG] Error (non-serializable):'), (error as Error)?.message || 'Unknown');
      }
    }

    process.exit(1);
  }
}

/**
 * Create AI commands
 */
export function createAICommands(program: Command): void {
  const aiCmd = program
    .command('ai')
    .description('AI generation commands');

  aiCmd
    .command('generate <prompt>')
    .alias('gen')
    .description('Generate text from a prompt')
    .option('-m, --model <model>', 'AI model to use')
    .option('--max-tokens <number>', 'Maximum tokens to generate')
    .option('--temperature <number>', 'Temperature (0-2)')
    .option('--json', 'Output as JSON')
    .action(generateText);

  aiCmd
    .command('image <prompt>')
    .alias('img')
    .description('Generate an image from a prompt')
    .option('-f, --folder <folder>', 'Target folder in media library')
    .option('-a, --alt-text <text>', 'Alt text for the image')
    .option('--json', 'Output as JSON')
    .action(generateImage);

  aiCmd
    .command('chat <message>')
    .description('Send a message to AI')
    .option('-m, --model <model>', 'AI model to use')
    .option('-s, --system <prompt>', 'System prompt')
    .option('--json', 'Output as JSON')
    .action(chat);
}

export default { createAICommands };
