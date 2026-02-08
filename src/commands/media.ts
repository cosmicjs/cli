/**
 * Media Commands
 * Media file management
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync, existsSync } from 'fs';
import { basename } from 'path';
import { requireBucket } from '../config/context.js';
import * as display from '../utils/display.js';
import * as spinner from '../utils/spinner.js';
import * as prompts from '../utils/prompts.js';
import * as api from '../api/dashboard.js';
import {
  listMediaFolders as apiListMediaFolders,
  createMediaFolder as apiCreateMediaFolder,
  updateMediaFolder as apiUpdateMediaFolder,
  deleteMediaFolder as apiDeleteMediaFolder,
  addMediaToFolder as apiAddMediaToFolder,
  removeMediaFromFolder as apiRemoveMediaFromFolder,
} from '../api/dashboard/media.js';

/**
 * List media
 */
async function listMedia(options: {
  folder?: string;
  limit?: string;
  skip?: string;
  json?: boolean;
}): Promise<void> {
  const bucketSlug = requireBucket();

  try {
    spinner.start('Loading media...');
    const { media, total } = await api.listMedia(bucketSlug, {
      folder: options.folder,
      limit: options.limit ? parseInt(options.limit, 10) : 20,
      skip: options.skip ? parseInt(options.skip, 10) : 0,
    });
    spinner.succeed(`Found ${total} media file(s)`);

    if (media.length === 0) {
      display.info('No media found');
      return;
    }

    if (options.json) {
      display.json(media);
      return;
    }

    const table = display.createTable({
      head: ['ID', 'Name', 'Type', 'Size', 'Created'],
    });

    for (const file of media) {
      table.push([
        chalk.dim(file.id),
        display.truncate(file.name, 35),
        file.type || '-',
        file.size ? display.formatBytes(file.size) : '-',
        display.formatDate(file.created_at),
      ]);
    }

    console.log(table.toString());

    if (total > media.length) {
      display.dim(`Showing ${media.length} of ${total} files`);
    }
  } catch (error) {
    spinner.fail('Failed to load media');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Get media details
 */
async function getMedia(
  mediaId: string,
  options: { json?: boolean }
): Promise<void> {
  const bucketSlug = requireBucket();

  try {
    spinner.start('Loading media...');
    const media = await api.getMedia(bucketSlug, mediaId);
    spinner.succeed();

    if (options.json) {
      display.json(media);
      return;
    }

    display.header(media.name);
    display.keyValue('ID', media.id);
    display.keyValue('Original Name', media.original_name || '-');
    display.keyValue('Type', media.type || '-');
    display.keyValue('Size', media.size ? display.formatBytes(media.size) : '-');
    if (media.width && media.height) {
      display.keyValue('Dimensions', `${media.width} x ${media.height}`);
    }
    display.keyValue('Alt Text', media.alt_text || '-');
    display.keyValue('Folder', media.folder || '-');
    display.keyValue('Created', display.formatDate(media.created_at));

    display.subheader('URLs');
    display.keyValue('URL', media.url);
    if (media.imgix_url) {
      display.keyValue('Imgix URL', media.imgix_url);
    }

    if (media.metadata && Object.keys(media.metadata).length > 0) {
      display.subheader('Metadata');
      display.json(media.metadata);
    }
  } catch (error) {
    spinner.fail('Failed to load media');
    display.error((error as Error).message);
    process.exit(1);
  }
}

// MIME types for common file extensions
const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.pdf': 'application/pdf',
};

function getContentType(filePath: string): string {
  const ext = filePath.toLowerCase().slice(filePath.lastIndexOf('.'));
  return MIME_TYPES[ext] || 'application/octet-stream';
}

/**
 * Upload media
 * Uses Dashboard API (Workers) for parity with the dashboard
 */
async function uploadMediaCommand(
  filePath: string,
  options: {
    folder?: string;
    metadata?: string;
    json?: boolean;
  }
): Promise<void> {
  const bucketSlug = requireBucket();

  // Check if file exists
  if (!existsSync(filePath)) {
    display.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  try {
    spinner.start(`Uploading ${basename(filePath)}...`);

    const fileBuffer = readFileSync(filePath);
    const filename = basename(filePath);
    const contentType = getContentType(filePath);

    let metadata: Record<string, unknown> | undefined;
    if (options.metadata) {
      try {
        metadata = JSON.parse(options.metadata);
      } catch {
        spinner.fail('Invalid metadata JSON');
        process.exit(1);
      }
    }

    const media = await api.uploadMedia(bucketSlug, {
      buffer: fileBuffer,
      filename,
      contentType,
      folder: options.folder,
      metadata,
    });

    if (!media) {
      spinner.fail('Upload succeeded but no media returned');
      process.exit(1);
    }

    spinner.succeed(`Uploaded: ${chalk.cyan(media.name)}`);

    if (options.json) {
      display.json(media);
    } else {
      display.keyValue('ID', media.id);
      if (media.url) display.keyValue('URL', media.url);
      if (media.imgix_url) display.keyValue('Imgix URL', media.imgix_url);
    }
  } catch (error) {
    spinner.fail('Failed to upload media');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Delete media
 */
async function deleteMedia(
  mediaIds: string[],
  options: { force?: boolean }
): Promise<void> {
  const bucketSlug = requireBucket();

  if (mediaIds.length === 0) {
    display.error('No media IDs provided');
    process.exit(1);
  }

  // Confirm deletion (default: yes - press Enter to confirm, n+Enter to cancel)
  if (!options.force) {
    const confirmed = await prompts.confirm({
      message: `Delete ${mediaIds.length} media file(s)? This cannot be undone.`,
      initial: true,
    });

    if (!confirmed) {
      display.info('Cancelled');
      return;
    }
  }

  try {
    spinner.start(`Deleting ${mediaIds.length} media file(s)...`);
    await api.deleteMedia(bucketSlug, mediaIds);
    spinner.succeed(`Deleted ${mediaIds.length} media file(s)`);
  } catch (error) {
    spinner.fail('Failed to delete media');
    display.error((error as Error).message);
    process.exit(1);
  }
}

// ============================================================================
// Media Folder Commands
// ============================================================================

/**
 * List media folders
 */
async function listFolders(options: { json?: boolean }): Promise<void> {
  const bucketSlug = requireBucket();

  try {
    spinner.start('Loading media folders...');
    const folders = await apiListMediaFolders(bucketSlug);
    spinner.succeed(`Found ${folders.length} folder(s)`);

    if (folders.length === 0) {
      display.info('No media folders found');
      return;
    }

    if (options.json) {
      display.json(folders);
      return;
    }

    const table = display.createTable({
      head: ['Slug', 'Title', 'Emoji'],
    });

    for (const folder of folders) {
      table.push([
        chalk.cyan(folder.slug),
        folder.title,
        folder.emoji || '-',
      ]);
    }

    console.log(table.toString());
  } catch (error) {
    spinner.fail('Failed to load media folders');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Create media folder
 */
async function createFolder(options: {
  title?: string;
  slug?: string;
  emoji?: string;
  json?: boolean;
}): Promise<void> {
  const bucketSlug = requireBucket();

  const title =
    options.title ||
    (await prompts.text({
      message: 'Folder title:',
      required: true,
    }));

  try {
    spinner.start('Creating media folder...');
    await apiCreateMediaFolder(bucketSlug, {
      title,
      slug: options.slug,
      emoji: options.emoji,
    });
    spinner.succeed(`Created media folder: ${chalk.cyan(title)}`);
  } catch (error) {
    spinner.fail('Failed to create media folder');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Update media folder
 */
async function updateFolder(
  folderSlug: string,
  options: {
    title?: string;
    slug?: string;
    emoji?: string;
    json?: boolean;
  }
): Promise<void> {
  const bucketSlug = requireBucket();

  const data: Record<string, unknown> = {};
  if (options.title) data.title = options.title;
  if (options.slug) data.slug = options.slug;
  if (options.emoji) data.emoji = options.emoji;

  if (Object.keys(data).length === 0) {
    display.error('No update fields provided. Use --title, --slug, or --emoji.');
    process.exit(1);
  }

  try {
    spinner.start('Updating media folder...');
    await apiUpdateMediaFolder(bucketSlug, folderSlug, data);
    spinner.succeed(`Updated media folder: ${chalk.cyan(folderSlug)}`);
  } catch (error) {
    spinner.fail('Failed to update media folder');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Delete media folder
 */
async function deleteFolder(
  folderSlug: string,
  options: { force?: boolean }
): Promise<void> {
  const bucketSlug = requireBucket();

  if (!options.force) {
    const confirmed = await prompts.confirm({
      message: `Delete media folder "${folderSlug}"? Media files in this folder will be unfiled.`,
    });

    if (!confirmed) {
      display.info('Cancelled');
      return;
    }
  }

  try {
    spinner.start('Deleting media folder...');
    await apiDeleteMediaFolder(bucketSlug, folderSlug);
    spinner.succeed(`Deleted media folder: ${chalk.cyan(folderSlug)}`);
  } catch (error) {
    spinner.fail('Failed to delete media folder');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Move media files into a folder
 */
async function moveToFolder(
  ids: string[],
  options: { folder?: string }
): Promise<void> {
  const bucketSlug = requireBucket();

  if (ids.length === 0) {
    display.error('No media IDs provided');
    process.exit(1);
  }

  const folder =
    options.folder ||
    (await prompts.text({
      message: 'Target folder slug:',
      required: true,
    }));

  try {
    spinner.start(`Moving ${ids.length} file(s) to folder "${folder}"...`);
    await apiAddMediaToFolder(bucketSlug, ids, folder);
    spinner.succeed(`Moved ${ids.length} file(s) to folder: ${chalk.cyan(folder)}`);
  } catch (error) {
    spinner.fail('Failed to move media to folder');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Remove media files from their folder
 */
async function removeFromFolder(ids: string[]): Promise<void> {
  const bucketSlug = requireBucket();

  if (ids.length === 0) {
    display.error('No media IDs provided');
    process.exit(1);
  }

  try {
    spinner.start(`Removing ${ids.length} file(s) from folder...`);
    await apiRemoveMediaFromFolder(bucketSlug, ids);
    spinner.succeed(`Removed ${ids.length} file(s) from folder`);
  } catch (error) {
    spinner.fail('Failed to remove media from folder');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Create media commands
 */
export function createMediaCommands(program: Command): void {
  const mediaCmd = program
    .command('media')
    .description('Manage media files');

  mediaCmd
    .command('list')
    .alias('ls')
    .description('List media files')
    .option('-f, --folder <folder>', 'Filter by folder')
    .option('-l, --limit <number>', 'Limit results', '20')
    .option('--skip <number>', 'Skip results', '0')
    .option('--json', 'Output as JSON')
    .action(listMedia);

  mediaCmd
    .command('get <id>')
    .description('Get media details')
    .option('--json', 'Output as JSON')
    .action(getMedia);

  mediaCmd
    .command('upload <file>')
    .alias('add')
    .description('Upload a media file')
    .option('-f, --folder <folder>', 'Target folder')
    .option('--metadata <json>', 'Metadata as JSON')
    .option('--json', 'Output as JSON')
    .action(uploadMediaCommand);

  mediaCmd
    .command('delete <ids...>')
    .alias('rm')
    .description('Delete media files')
    .option('-f, --force', 'Skip confirmation')
    .action(deleteMedia);

  mediaCmd
    .command('move <ids...>')
    .description('Move media files into a folder')
    .requiredOption('-f, --folder <folder>', 'Target folder slug')
    .action(moveToFolder);

  mediaCmd
    .command('unfolder <ids...>')
    .description('Remove media files from their folder')
    .action(removeFromFolder);

  // Folder subcommands
  const foldersCmd = mediaCmd
    .command('folders')
    .description('Manage media folders');

  foldersCmd
    .command('list')
    .alias('ls')
    .description('List media folders')
    .option('--json', 'Output as JSON')
    .action(listFolders);

  foldersCmd
    .command('create')
    .alias('add')
    .description('Create a media folder')
    .option('--title <title>', 'Folder title')
    .option('--slug <slug>', 'Folder slug')
    .option('--emoji <emoji>', 'Folder emoji')
    .option('--json', 'Output as JSON')
    .action(createFolder);

  foldersCmd
    .command('update <slug>')
    .alias('edit')
    .description('Update a media folder')
    .option('--title <title>', 'New title')
    .option('--slug <slug>', 'New slug')
    .option('--emoji <emoji>', 'New emoji')
    .option('--json', 'Output as JSON')
    .action(updateFolder);

  foldersCmd
    .command('delete <slug>')
    .alias('rm')
    .description('Delete a media folder')
    .option('-f, --force', 'Skip confirmation')
    .action(deleteFolder);
}

export default { createMediaCommands };
