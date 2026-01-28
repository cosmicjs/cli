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
import * as api from '../api/dashboard.js';

/**
 * Generate text
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
  const bucketSlug = requireBucket();
  const model = options.model || getDefaultModel();

  try {
    spinner.start(`Generating text with ${model}...`);

    const response = await api.generateText(bucketSlug, {
      prompt,
      model,
      max_tokens: options.maxTokens ? parseInt(options.maxTokens, 10) : undefined,
      temperature: options.temperature ? parseFloat(options.temperature) : undefined,
    });

    spinner.succeed();

    if (options.json) {
      display.json(response);
      return;
    }

    console.log(response.text);

    if (response.usage) {
      display.newline();
      display.dim(
        `Tokens: ${response.usage.input_tokens} in / ${response.usage.output_tokens} out`
      );
    }
  } catch (error) {
    spinner.fail('Failed to generate text');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Generate image
 */
async function generateImage(
  prompt: string,
  options: {
    folder?: string;
    altText?: string;
    json?: boolean;
  }
): Promise<void> {
  const bucketSlug = requireBucket();

  try {
    spinner.start('Generating image...');

    const media = await api.generateImage(bucketSlug, prompt, {
      folder: options.folder,
      alt_text: options.altText,
    });

    spinner.succeed('Image generated');

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
  } catch (error) {
    spinner.fail('Failed to generate image');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Chat with AI (simple single-turn)
 */
async function chat(
  message: string,
  options: {
    model?: string;
    system?: string;
    json?: boolean;
  }
): Promise<void> {
  const bucketSlug = requireBucket();
  const model = options.model || getDefaultModel();

  const messages: api.AITextRequest['messages'] = [];

  if (options.system) {
    messages.push({ role: 'system', content: options.system });
  }

  messages.push({ role: 'user', content: message });

  try {
    spinner.start(`Thinking...`);

    const response = await api.generateText(bucketSlug, {
      messages,
      model,
    });

    spinner.succeed();

    if (options.json) {
      display.json(response);
      return;
    }

    console.log(response.text);

    if (response.usage) {
      display.newline();
      display.dim(
        `Model: ${model} | Tokens: ${response.usage.input_tokens} in / ${response.usage.output_tokens} out`
      );
    }
  } catch (error) {
    spinner.fail('Failed to get response');
    display.error((error as Error).message);
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
