/**
 * Webhooks Commands
 * CRUD operations for webhooks
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { requireBucket } from '../config/context.js';
import * as display from '../utils/display.js';
import * as spinner from '../utils/spinner.js';
import * as prompts from '../utils/prompts.js';
import {
  listWebhooks as apiListWebhooks,
  getWebhook as apiGetWebhook,
  createWebhook as apiCreateWebhook,
  updateWebhook as apiUpdateWebhook,
  deleteWebhook as apiDeleteWebhook,
} from '../api/dashboard/webhooks.js';

/**
 * List webhooks
 */
async function listWebhooks(options: { json?: boolean }): Promise<void> {
  const bucketSlug = requireBucket();

  try {
    spinner.start('Loading webhooks...');
    const webhooks = await apiListWebhooks(bucketSlug);
    spinner.succeed(`Found ${webhooks.length} webhook(s)`);

    if (webhooks.length === 0) {
      display.info('No webhooks found');
      return;
    }

    if (options.json) {
      display.json(webhooks);
      return;
    }

    const table = display.createTable({
      head: ['ID', 'Title', 'Resource', 'Events', 'Endpoint'],
    });

    for (const wh of webhooks) {
      table.push([
        chalk.dim(wh.id),
        wh.title,
        chalk.cyan(wh.resource),
        wh.events.join(', '),
        display.truncate(wh.endpoint, 40),
      ]);
    }

    console.log(table.toString());
  } catch (error) {
    spinner.fail('Failed to load webhooks');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Get webhook details
 */
async function getWebhook(
  webhookId: string,
  options: { json?: boolean }
): Promise<void> {
  const bucketSlug = requireBucket();

  try {
    spinner.start('Loading webhook...');
    const wh = await apiGetWebhook(bucketSlug, webhookId);
    spinner.succeed();

    if (options.json) {
      display.json(wh);
      return;
    }

    display.header(wh.title);
    display.keyValue('ID', wh.id);
    display.keyValue('Endpoint', wh.endpoint);
    display.keyValue('Resource', wh.resource);
    display.keyValue('Events', wh.events.join(', '));
    if (wh.payload) display.keyValue('Payload', 'Enabled');
    if (wh.props) display.keyValue('Props', wh.props);
    if (wh.object_types && wh.object_types.length > 0) {
      display.keyValue('Object Types', wh.object_types.join(', '));
    }
    if (wh.headers && wh.headers.length > 0) {
      display.subheader('Custom Headers');
      for (const h of wh.headers) {
        display.keyValue(h.key, h.value);
      }
    }
  } catch (error) {
    spinner.fail('Failed to load webhook');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Create webhook
 */
async function createWebhook(options: {
  title?: string;
  endpoint?: string;
  resource?: string;
  events?: string;
  objectTypes?: string;
  payload?: boolean;
  props?: string;
  json?: boolean;
}): Promise<void> {
  const bucketSlug = requireBucket();

  const title =
    options.title ||
    (await prompts.text({
      message: 'Webhook title:',
      required: true,
    }));

  const endpoint =
    options.endpoint ||
    (await prompts.text({
      message: 'Endpoint URL:',
      required: true,
    }));

  const resource = (options.resource ||
    (await prompts.select({
      message: 'Resource:',
      choices: [
        { name: 'objects' as const, message: 'Objects' },
        { name: 'media' as const, message: 'Media' },
        { name: 'merge_request' as const, message: 'Merge Request' },
      ],
    }))) as 'objects' | 'media' | 'merge_request';

  let events: string[];
  if (options.events) {
    events = options.events.split(',').map(e => e.trim());
  } else {
    events = await prompts.multiselect({
      message: 'Events:',
      choices: [
        { name: 'created' as const, message: 'Created' },
        { name: 'edited' as const, message: 'Edited' },
        { name: 'deleted' as const, message: 'Deleted' },
        { name: 'completed' as const, message: 'Completed' },
      ],
    });
  }

  const objectTypes = options.objectTypes
    ? options.objectTypes.split(',').map(t => t.trim())
    : undefined;

  try {
    spinner.start('Creating webhook...');
    const wh = await apiCreateWebhook(bucketSlug, {
      title,
      endpoint,
      resource,
      events,
      object_types: objectTypes,
      payload: options.payload,
      props: options.props,
    });
    spinner.succeed(`Created webhook: ${chalk.cyan(wh.title)}`);

    if (options.json) {
      display.json(wh);
    } else {
      display.keyValue('ID', wh.id);
    }
  } catch (error) {
    spinner.fail('Failed to create webhook');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Update webhook
 */
async function updateWebhook(
  webhookId: string,
  options: {
    title?: string;
    endpoint?: string;
    resource?: string;
    events?: string;
    objectTypes?: string;
    payload?: boolean;
    props?: string;
    json?: boolean;
  }
): Promise<void> {
  const bucketSlug = requireBucket();

  const data: Record<string, unknown> = {};
  if (options.title) data.title = options.title;
  if (options.endpoint) data.endpoint = options.endpoint;
  if (options.resource) data.resource = options.resource;
  if (options.events) data.events = options.events.split(',').map(e => e.trim());
  if (options.objectTypes) data.object_types = options.objectTypes.split(',').map(t => t.trim());
  if (options.payload !== undefined) data.payload = options.payload;
  if (options.props) data.props = options.props;

  if (Object.keys(data).length === 0) {
    display.error('No update fields provided. Use --title, --endpoint, --resource, --events, etc.');
    process.exit(1);
  }

  try {
    spinner.start('Updating webhook...');
    const wh = await apiUpdateWebhook(bucketSlug, webhookId, data);
    spinner.succeed(`Updated webhook: ${chalk.cyan(wh.title)}`);

    if (options.json) {
      display.json(wh);
    }
  } catch (error) {
    spinner.fail('Failed to update webhook');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Delete webhook
 */
async function deleteWebhook(
  webhookId: string,
  options: { force?: boolean }
): Promise<void> {
  const bucketSlug = requireBucket();

  if (!options.force) {
    const confirmed = await prompts.confirm({
      message: `Delete webhook "${webhookId}"? This cannot be undone.`,
    });

    if (!confirmed) {
      display.info('Cancelled');
      return;
    }
  }

  try {
    spinner.start('Deleting webhook...');
    await apiDeleteWebhook(bucketSlug, webhookId);
    spinner.succeed('Deleted webhook');
  } catch (error) {
    spinner.fail('Failed to delete webhook');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Create webhooks commands
 */
export function createWebhooksCommands(program: Command): void {
  const webhooksCmd = program
    .command('webhooks')
    .alias('wh')
    .description('Manage webhooks');

  webhooksCmd
    .command('list')
    .alias('ls')
    .description('List webhooks')
    .option('--json', 'Output as JSON')
    .action(listWebhooks);

  webhooksCmd
    .command('get <id>')
    .description('Get webhook details')
    .option('--json', 'Output as JSON')
    .action(getWebhook);

  webhooksCmd
    .command('create')
    .alias('add')
    .description('Create a new webhook')
    .option('--title <title>', 'Webhook title')
    .option('--endpoint <url>', 'Endpoint URL')
    .option('--resource <resource>', 'Resource type (objects, media, merge_request)')
    .option('--events <events>', 'Events to listen for (comma-separated: created,edited,deleted,completed)')
    .option('--object-types <types>', 'Object type filters (comma-separated)')
    .option('--payload', 'Include full payload')
    .option('--props <props>', 'Properties to include in payload')
    .option('--json', 'Output as JSON')
    .action(createWebhook);

  webhooksCmd
    .command('update <id>')
    .alias('edit')
    .description('Update a webhook')
    .option('--title <title>', 'New title')
    .option('--endpoint <url>', 'New endpoint URL')
    .option('--resource <resource>', 'New resource type')
    .option('--events <events>', 'New events (comma-separated)')
    .option('--object-types <types>', 'New object type filters (comma-separated)')
    .option('--payload', 'Enable payload')
    .option('--no-payload', 'Disable payload')
    .option('--props <props>', 'Properties to include in payload')
    .option('--json', 'Output as JSON')
    .action(updateWebhook);

  webhooksCmd
    .command('delete <id>')
    .alias('rm')
    .description('Delete a webhook')
    .option('-f, --force', 'Skip confirmation')
    .action(deleteWebhook);
}

export default { createWebhooksCommands };
