/**
 * Types Commands
 * CRUD operations for object types
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { requireBucket } from '../config/context.js';
import * as display from '../utils/display.js';
import * as spinner from '../utils/spinner.js';
import * as prompts from '../utils/prompts.js';
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
 * List object types
 */
async function listTypes(options: { json?: boolean }): Promise<void> {
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
      head: ['Slug', 'Title', 'Singular', 'Emoji', 'Metafields'],
    });

    for (const type of types) {
      table.push([
        chalk.cyan(type.slug),
        type.title,
        type.singular || '-',
        type.emoji || '-',
        String(type.metafields?.length || 0),
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
 * Get object type details
 */
async function getType(
  typeSlug: string,
  options: { json?: boolean }
): Promise<void> {
  const bucketSlug = requireBucket();

  try {
    spinner.start('Loading object type...');
    const type = await api.getObjectType(bucketSlug, typeSlug);
    spinner.succeed();

    if (options.json) {
      display.json(type);
      return;
    }

    display.header(type.title);
    display.keyValue('Slug', type.slug);
    if (type.singular) display.keyValue('Singular', type.singular);
    if (type.emoji) display.keyValue('Emoji', type.emoji);

    if (type.metafields && type.metafields.length > 0) {
      display.subheader('Metafields');
      const table = display.createTable({
        head: ['Key', 'Title', 'Type', 'Required'],
      });

      for (const mf of type.metafields) {
        table.push([
          chalk.cyan(mf.key),
          mf.title || '-',
          mf.type,
          mf.required ? chalk.green('Yes') : chalk.dim('No'),
        ]);
      }

      console.log(table.toString());
    }
  } catch (error) {
    spinner.fail('Failed to load object type');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Create object type
 */
async function createType(options: {
  title?: string;
  slug?: string;
  singular?: string;
  emoji?: string;
  singleton?: boolean;
  json?: boolean;
}): Promise<void> {
  const bucketSlug = requireBucket();

  const title =
    options.title ||
    (await prompts.text({
      message: 'Object type title:',
      required: true,
    }));

  const slug = options.slug || generateSlug(title);

  const singular =
    options.singular ||
    (await prompts.text({
      message: 'Singular name (optional):',
    })) ||
    undefined;

  const emoji =
    options.emoji ||
    (await prompts.text({
      message: 'Emoji (optional):',
    })) ||
    undefined;

  try {
    spinner.start('Creating object type...');
    const type = await api.createObjectType(bucketSlug, {
      title,
      slug,
      singular,
      emoji,
      singleton: options.singleton || false,
    });
    spinner.succeed(`Created object type: ${chalk.cyan(type.title)}`);

    if (options.json) {
      display.json(type);
    } else {
      display.keyValue('Slug', type.slug);
    }
  } catch (error) {
    spinner.fail('Failed to create object type');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Update object type
 */
async function updateType(
  typeSlug: string,
  options: {
    title?: string;
    slug?: string;
    singular?: string;
    emoji?: string;
    singleton?: boolean;
    json?: boolean;
  }
): Promise<void> {
  const bucketSlug = requireBucket();

  const data: Record<string, unknown> = {};
  if (options.title) data.title = options.title;
  if (options.slug) data.slug = options.slug;
  if (options.singular) data.singular = options.singular;
  if (options.emoji) data.emoji = options.emoji;
  if (options.singleton !== undefined) data.singleton = options.singleton;

  if (Object.keys(data).length === 0) {
    display.error('No update fields provided. Use --title, --slug, --singular, --emoji, or --singleton.');
    process.exit(1);
  }

  try {
    spinner.start('Updating object type...');
    const type = await api.updateObjectType(bucketSlug, typeSlug, data);
    spinner.succeed(`Updated object type: ${chalk.cyan(type.title)}`);

    if (options.json) {
      display.json(type);
    }
  } catch (error) {
    spinner.fail('Failed to update object type');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Delete object type
 */
async function deleteType(
  typeSlug: string,
  options: { force?: boolean }
): Promise<void> {
  const bucketSlug = requireBucket();

  if (!options.force) {
    const confirmed = await prompts.confirm({
      message: `Delete object type "${typeSlug}"? This will also delete all objects of this type.`,
    });

    if (!confirmed) {
      display.info('Cancelled');
      return;
    }
  }

  try {
    spinner.start('Deleting object type...');
    await api.deleteObjectType(bucketSlug, typeSlug);
    spinner.succeed(`Deleted object type: ${chalk.cyan(typeSlug)}`);
  } catch (error) {
    spinner.fail('Failed to delete object type');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Duplicate object type
 */
async function duplicateType(
  typeSlug: string,
  options: { json?: boolean }
): Promise<void> {
  const bucketSlug = requireBucket();

  try {
    spinner.start('Duplicating object type...');
    const type = await api.duplicateObjectType(bucketSlug, typeSlug);
    spinner.succeed(`Duplicated object type: ${chalk.cyan(type.title)}`);

    if (options.json) {
      display.json(type);
    } else {
      display.keyValue('New Slug', type.slug);
    }
  } catch (error) {
    spinner.fail('Failed to duplicate object type');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Create types commands
 */
export function createTypesCommands(program: Command): void {
  const typesCmd = program
    .command('types')
    .description('Manage object types');

  typesCmd
    .command('list')
    .alias('ls')
    .description('List object types')
    .option('--json', 'Output as JSON')
    .action(listTypes);

  typesCmd
    .command('get <slug>')
    .description('Get object type details')
    .option('--json', 'Output as JSON')
    .action(getType);

  typesCmd
    .command('create')
    .alias('add')
    .description('Create a new object type')
    .option('--title <title>', 'Object type title')
    .option('--slug <slug>', 'Object type slug')
    .option('--singular <singular>', 'Singular name')
    .option('--emoji <emoji>', 'Emoji icon')
    .option('--singleton', 'Create as singleton type')
    .option('--json', 'Output as JSON')
    .action(createType);

  typesCmd
    .command('update <slug>')
    .alias('edit')
    .description('Update an object type')
    .option('--title <title>', 'New title')
    .option('--slug <slug>', 'New slug')
    .option('--singular <singular>', 'New singular name')
    .option('--emoji <emoji>', 'New emoji')
    .option('--singleton', 'Set as singleton')
    .option('--no-singleton', 'Unset singleton')
    .option('--json', 'Output as JSON')
    .action(updateType);

  typesCmd
    .command('delete <slug>')
    .alias('rm')
    .description('Delete an object type')
    .option('-f, --force', 'Skip confirmation')
    .action(deleteType);

  typesCmd
    .command('duplicate <slug>')
    .alias('dup')
    .description('Duplicate an object type')
    .option('--json', 'Output as JSON')
    .action(duplicateType);
}

export default { createTypesCommands };
