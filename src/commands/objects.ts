/**
 * Objects Commands
 * CRUD operations for content objects using Cosmic SDK
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { requireBucket } from '../config/context.js';
import * as display from '../utils/display.js';
import * as spinner from '../utils/spinner.js';
import * as prompts from '../utils/prompts.js';
import { getSDKClient, hasSDKClient } from '../api/sdk.js';
import * as api from '../api/dashboard.js';

/**
 * Generate a slug from a title
 */
function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 50);
}

/**
 * List objects using SDK
 */
async function listObjects(options: {
  type?: string;
  status?: string;
  limit?: string;
  skip?: string;
  props?: string;
  depth?: string;
  json?: boolean;
}): Promise<void> {
  requireBucket();
  const sdk = getSDKClient();

  if (!sdk) {
    display.error('SDK not available. Configure bucket keys first.');
    process.exit(1);
  }

  try {
    spinner.start('Loading objects...');

    // Build query for SDK - SDK uses chaining: find(query).status('any').limit(n)
    const query: Record<string, unknown> = {};
    if (options.type) query.type = options.type;

    const limit = options.limit ? parseInt(options.limit, 10) : 10;

    // Build the query chain
    let chain = sdk.objects.find(query).status('any').limit(limit);

    // Add props if specified
    if (options.props) {
      const propsArray = options.props.split(',').map(p => p.trim());
      chain = chain.props(propsArray);
    }

    // Add depth if specified
    if (options.depth) {
      chain = chain.depth(parseInt(options.depth, 10));
    }

    const result = await chain;

    const objects = result.objects || [];
    const total = result.total || objects.length;
    spinner.succeed(`Found ${total} object(s)`);

    if (objects.length === 0) {
      display.info('No objects found');
      return;
    }

    if (options.json) {
      display.json(objects);
      return;
    }

    const table = display.createTable({
      head: ['Title', 'ID', 'Status', 'Type', 'Modified'],
      colWidths: [40, 28, 16, 16, 14],
    });

    for (const obj of objects) {
      table.push([
        chalk.cyan(display.truncate(obj.title, 36) || chalk.dim('-')),
        chalk.dim(obj.id || '-'),
        display.formatStatus(obj.status),
        obj.type || chalk.dim('-'),
        display.formatDate(obj.modified_at || obj.created_at),
      ]);
    }

    console.log(table.toString());

    if (total > objects.length) {
      display.dim(`Showing ${objects.length} of ${total} objects`);
    }
  } catch (error) {
    spinner.fail('Failed to load objects');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Get object details using SDK
 */
async function getObject(
  objectId: string,
  options: { props?: string; depth?: string; json?: boolean }
): Promise<void> {
  requireBucket();
  const sdk = getSDKClient();

  if (!sdk) {
    display.error('SDK not available. Configure bucket keys first.');
    process.exit(1);
  }

  try {
    spinner.start('Loading object...');
    // Use find().status('any').limit(1) because findOne doesn't support .status() chaining
    let chain = sdk.objects.find({ id: objectId }).status('any').limit(1);

    // Add props if specified
    if (options.props) {
      const propsArray = options.props.split(',').map(p => p.trim());
      chain = chain.props(propsArray);
    }

    // Add depth if specified
    if (options.depth) {
      chain = chain.depth(parseInt(options.depth, 10));
    }

    const findResult = await chain;
    const obj = findResult.objects?.[0];

    if (!obj) {
      spinner.fail('Object not found');
      return;
    }

    spinner.succeed();

    if (options.json) {
      display.json(obj);
      return;
    }

    display.header(obj.title);
    display.keyValue('ID', obj.id);
    display.keyValue('Slug', obj.slug);
    display.keyValue('Type', obj.type);
    display.keyValue('Status', display.formatStatus(obj.status));
    display.keyValue('Created', display.formatDate(obj.created_at));
    display.keyValue('Modified', display.formatDate(obj.modified_at));

    if (obj.content) {
      display.subheader('Content');
      console.log(obj.content);
    }

    if (obj.metadata && Object.keys(obj.metadata).length > 0) {
      display.subheader('Metadata');
      display.json(obj.metadata);
    }
  } catch (error) {
    spinner.fail('Failed to load object');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Create object using SDK
 */
async function createObject(options: {
  type: string;
  title?: string;
  slug?: string;
  content?: string;
  status?: string;
  metadata?: string;
  json?: boolean;
}): Promise<void> {
  requireBucket();
  const sdk = getSDKClient();

  if (!sdk) {
    display.error('SDK not available. Configure bucket keys first.');
    process.exit(1);
  }

  // Get title if not provided
  const title =
    options.title ||
    (await prompts.text({
      message: 'Title:',
      required: true,
    }));

  try {
    spinner.start('Creating object...');

    // Auto-generate slug from title if not provided
    const slug = options.slug || generateSlug(title);

    // Build object data for SDK
    const objectData: Record<string, unknown> = {
      title,
      type: options.type,
      slug,
      content: options.content || '',
      status: options.status || 'draft',
    };

    if (options.metadata) {
      try {
        objectData.metadata = JSON.parse(options.metadata);
      } catch {
        spinner.fail('Invalid metadata JSON');
        process.exit(1);
      }
    }

    const result = await sdk.objects.insertOne(objectData);
    const obj = result.object;
    spinner.succeed(`Created object: ${chalk.cyan(obj.title)}`);

    if (options.json) {
      display.json(obj);
    } else {
      display.keyValue('ID', obj.id);
      display.keyValue('Slug', obj.slug);
    }
  } catch (error) {
    spinner.fail('Failed to create object');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Update object using SDK
 */
async function updateObject(
  objectId: string,
  options: {
    title?: string;
    slug?: string;
    content?: string;
    status?: string;
    metadata?: string;
    json?: boolean;
  }
): Promise<void> {
  requireBucket();
  const sdk = getSDKClient();

  if (!sdk) {
    display.error('SDK not available. Configure bucket keys first.');
    process.exit(1);
  }

  try {
    spinner.start('Updating object...');

    const data: Record<string, unknown> = {};

    if (options.title) data.title = options.title;
    if (options.slug) data.slug = options.slug;
    if (options.content) data.content = options.content;
    if (options.status) data.status = options.status;

    if (options.metadata) {
      try {
        data.metadata = JSON.parse(options.metadata);
      } catch {
        spinner.fail('Invalid metadata JSON');
        process.exit(1);
      }
    }

    const result = await sdk.objects.updateOne(objectId, data);
    const obj = result.object;
    spinner.succeed(`Updated object: ${chalk.cyan(obj.title)}`);

    if (options.json) {
      display.json(obj);
    }
  } catch (error) {
    spinner.fail('Failed to update object');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Delete objects using SDK
 */
async function deleteObjects(
  objectIds: string[],
  options: { force?: boolean }
): Promise<void> {
  requireBucket();
  const sdk = getSDKClient();

  if (!sdk) {
    display.error('SDK not available. Configure bucket keys first.');
    process.exit(1);
  }

  if (objectIds.length === 0) {
    display.error('No object IDs provided');
    process.exit(1);
  }

  // Confirm deletion
  if (!options.force) {
    const confirmed = await prompts.confirm({
      message: `Delete ${objectIds.length} object(s)? This cannot be undone.`,
    });

    if (!confirmed) {
      display.info('Cancelled');
      return;
    }
  }

  try {
    spinner.start(`Deleting ${objectIds.length} object(s)...`);
    // Delete each object (SDK deletes one at a time)
    for (const id of objectIds) {
      await sdk.objects.deleteOne(id);
    }
    spinner.succeed(`Deleted ${objectIds.length} object(s)`);
  } catch (error) {
    spinner.fail('Failed to delete objects');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Publish objects
 */
async function publishObjects(objectIds: string[]): Promise<void> {
  const bucketSlug = requireBucket();

  if (objectIds.length === 0) {
    display.error('No object IDs provided');
    process.exit(1);
  }

  try {
    spinner.start(`Publishing ${objectIds.length} object(s)...`);
    await api.publishObjects(bucketSlug, objectIds);
    spinner.succeed(`Published ${objectIds.length} object(s)`);
  } catch (error) {
    spinner.fail('Failed to publish objects');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Unpublish objects
 */
async function unpublishObjects(objectIds: string[]): Promise<void> {
  const bucketSlug = requireBucket();

  if (objectIds.length === 0) {
    display.error('No object IDs provided');
    process.exit(1);
  }

  try {
    spinner.start(`Unpublishing ${objectIds.length} object(s)...`);
    await api.unpublishObjects(bucketSlug, objectIds);
    spinner.succeed(`Unpublished ${objectIds.length} object(s)`);
  } catch (error) {
    spinner.fail('Failed to unpublish objects');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * List object types
 */
async function listObjectTypes(options: { json?: boolean }): Promise<void> {
  const bucketSlug = requireBucket();

  try {
    spinner.start('Loading object types...');
    const types = await api.listObjectTypes(bucketSlug);
    spinner.succeed(`Found ${types.length} object type(s)`);

    if (types.length === 0) {
      display.info('No object types found');
      return;
    }

    if (options.json) {
      display.json(types);
      return;
    }

    const table = display.createTable({
      head: ['Slug', 'Title', 'Singular', 'Emoji'],
    });

    for (const type of types) {
      table.push([
        chalk.cyan(type.slug),
        type.title,
        type.singular || '-',
        type.emoji || '-',
      ]);
    }

    console.log(table.toString());
  } catch (error) {
    spinner.fail('Failed to load object types');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Create objects commands
 */
export function createObjectsCommands(program: Command): void {
  const objectsCmd = program
    .command('objects')
    .alias('obj')
    .description('Manage content objects');

  objectsCmd
    .command('list')
    .alias('ls')
    .description('List objects')
    .option('-t, --type <type>', 'Filter by object type')
    .option('-s, --status <status>', 'Filter by status (published, draft, any)')
    .option('-l, --limit <number>', 'Limit results', '10')
    .option('--skip <number>', 'Skip results', '0')
    .option('-p, --props <props>', 'Properties to return (comma-separated, e.g. "id,title,slug,metadata")')
    .option('-d, --depth <number>', 'Depth for nested object references')
    .option('--json', 'Output as JSON')
    .action(listObjects);

  objectsCmd
    .command('get <id>')
    .description('Get object details')
    .option('-p, --props <props>', 'Properties to return (comma-separated, e.g. "id,title,slug,metadata")')
    .option('-d, --depth <number>', 'Depth for nested object references')
    .option('--json', 'Output as JSON')
    .action(getObject);

  objectsCmd
    .command('create')
    .alias('add')
    .description('Create a new object')
    .requiredOption('-t, --type <type>', 'Object type slug')
    .option('--title <title>', 'Object title')
    .option('--slug <slug>', 'Object slug')
    .option('--content <content>', 'Object content')
    .option('--status <status>', 'Object status (published, draft)', 'draft')
    .option('--metadata <json>', 'Object metadata as JSON')
    .option('--json', 'Output as JSON')
    .action(createObject);

  objectsCmd
    .command('update <id>')
    .alias('edit')
    .description('Update an object')
    .option('--title <title>', 'New title')
    .option('--slug <slug>', 'New slug')
    .option('--content <content>', 'New content')
    .option('--status <status>', 'New status')
    .option('--metadata <json>', 'New metadata as JSON')
    .option('--json', 'Output as JSON')
    .action(updateObject);

  objectsCmd
    .command('delete <ids...>')
    .alias('rm')
    .description('Delete objects')
    .option('-f, --force', 'Skip confirmation')
    .action(deleteObjects);

  objectsCmd
    .command('publish <ids...>')
    .description('Publish objects')
    .action(publishObjects);

  objectsCmd
    .command('unpublish <ids...>')
    .description('Unpublish objects')
    .action(unpublishObjects);

  objectsCmd
    .command('types')
    .description('List object types')
    .option('--json', 'Output as JSON')
    .action(listObjectTypes);
}

export default { createObjectsCommands };
