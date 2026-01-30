/**
 * Navigation Commands
 * Directory-style navigation for projects/buckets/objects
 */

import { Command } from 'commander';
import chalk from 'chalk';
import {
  getCurrentWorkspaceId,
  getCurrentProjectId,
  getCurrentProjectSlug,
  setConfigValue,
  clearConfigValue,
  getConfigValue,
  setCredentials,
  clearCredentials,
  getCredentials,
} from '../config/store.js';
import * as display from '../utils/display.js';
import * as spinner from '../utils/spinner.js';
import * as api from '../api/dashboard.js';
import { clearSDKClient } from '../api/sdk.js';

/**
 * Get current object type from config
 */
function getCurrentObjectType(): string | undefined {
  return getConfigValue('currentObjectType');
}

/**
 * Store bucket keys for SDK usage
 */
async function storeBucketKeys(bucketSlug: string): Promise<void> {
  try {
    const bucket = await api.getBucket(bucketSlug);
    const bucketAny = bucket as Record<string, unknown>;
    const apiAccess = bucketAny.api_access as Record<string, string> | undefined;

    if (apiAccess && apiAccess.read_key && apiAccess.write_key) {
      setCredentials({
        bucketSlug,
        readKey: apiAccess.read_key,
        writeKey: apiAccess.write_key,
      });
      clearSDKClient(); // Clear cached SDK client so it gets recreated with new keys
      console.log(chalk.dim('  ✓ API keys configured'));
    } else {
      console.log(chalk.dim('  Note: Bucket API keys not available'));
    }
  } catch (error) {
    // Silently fail - keys are optional for some operations
    console.log(chalk.dim('  Note: Could not retrieve bucket API keys'));
  }
}

/**
 * Get the current path as a string
 */
function getCurrentPath(): string {
  const projectId = getCurrentProjectId();
  const projectSlug = getCurrentProjectSlug();
  const bucketSlug = getConfigValue('currentBucket'); // Don't use credential fallback
  const objectType = getCurrentObjectType();

  if (!projectId && !projectSlug) {
    return '/';
  }

  let path = '/' + (projectSlug || projectId);

  if (bucketSlug) {
    path += '/' + bucketSlug;
  }

  if (objectType) {
    path += '/' + objectType;
  }

  return path;
}

/**
 * pwd command - print working directory
 */
function pwd(): void {
  const path = getCurrentPath();
  console.log(chalk.cyan(path));
}

/**
 * ls command - list contents at current level or specified path
 */
async function ls(path?: string): Promise<void> {
  const currentProjectId = getCurrentProjectId();
  const currentBucketSlug = getConfigValue('currentBucket'); // Don't use credential fallback
  const currentObjectType = getCurrentObjectType();

  // Determine what to list based on path argument or current context
  let targetPath = path;

  if (!targetPath) {
    // Use current context
    if (currentObjectType && currentBucketSlug && currentProjectId) {
      // Inside an object type - list objects
      targetPath = `/${currentProjectId}/${currentBucketSlug}/${currentObjectType}`;
    } else if (currentBucketSlug && currentProjectId) {
      // Inside a bucket - list object types
      targetPath = `/${currentProjectId}/${currentBucketSlug}`;
    } else if (currentProjectId) {
      // Inside a project - list buckets
      targetPath = `/${currentProjectId}`;
    } else {
      // At root - list projects
      targetPath = '/';
    }
  }

  // Parse the path
  const parts = targetPath.split('/').filter(Boolean);

  if (parts.length === 0 || targetPath === '/') {
    // List projects (root level)
    await listProjects();
  } else if (parts.length === 1) {
    // List buckets in project
    await listBuckets(parts[0]);
  } else if (parts.length === 2) {
    // List object types in bucket
    await listObjectTypes(parts[0], parts[1]);
  } else if (parts.length >= 3) {
    // List objects of a type
    await listObjects(parts[1], parts[2]);
  }
}

/**
 * List all projects
 */
async function listProjects(): Promise<void> {
  try {
    spinner.start('Loading...');
    const projectList = await api.listProjects();
    spinner.stop();

    if (projectList.length === 0) {
      display.info('No projects found');
      return;
    }

    console.log();
    console.log(chalk.bold.cyan('    Projects'));
    console.log(chalk.dim('    ' + '─'.repeat(60)));
    console.log();

    for (const proj of projectList) {
      const projAny = proj as Record<string, unknown>;
      const id = String(projAny.id || projAny._id || '-');
      const title = String(projAny.title || '-');
      const buckets = projAny.total_buckets || 0;

      console.log(`    📁  ${chalk.cyan(id.padEnd(26))} ${title.padEnd(25)} ${chalk.dim(`${buckets} bucket${Number(buckets) !== 1 ? 's' : ''}`)}`);
    }
    console.log();
  } catch (error) {
    spinner.fail('Failed to load projects');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * List buckets in a project
 */
async function listBuckets(projectId: string): Promise<void> {
  try {
    spinner.start('Loading...');
    const project = await api.getProject(projectId);
    spinner.stop();

    const projAny = project as Record<string, unknown>;
    const buckets = (projAny.buckets || []) as Array<Record<string, unknown>>;
    const projectTitle = String(projAny.title || projectId);

    if (buckets.length === 0) {
      display.info('No buckets found');
      return;
    }

    console.log();
    console.log(chalk.bold.cyan(`    Buckets in ${projectTitle}`));
    console.log(chalk.dim('    ' + '─'.repeat(70)));
    console.log();

    for (const bucket of buckets) {
      const slug = String(bucket.slug || bucket.id || '-');
      const title = String(bucket.title || '-');
      const objects = bucket.total_objects || 0;

      console.log(`    📦  ${chalk.cyan(slug)}`);
      console.log(`        ${title} ${chalk.dim(`(${objects} object${Number(objects) !== 1 ? 's' : ''})`)}`);
      console.log();
    }
  } catch (error) {
    spinner.fail('Failed to load buckets');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * List object types in a bucket (via bucket GET which includes object_types)
 */
async function listObjectTypes(projectId: string, bucketSlug: string): Promise<void> {
  try {
    spinner.start('Loading...');
    const bucket = await api.getBucket(bucketSlug);
    spinner.stop();

    const bucketAny = bucket as Record<string, unknown>;
    const objectTypes = (bucketAny.object_types || []) as Array<Record<string, unknown>>;

    if (objectTypes.length === 0) {
      display.info('No object types found');
      return;
    }

    console.log();
    console.log(chalk.bold.cyan(`    Object Types in ${bucketSlug}`));
    console.log(chalk.dim('    ' + '─'.repeat(60)));
    console.log();

    for (const objType of objectTypes) {
      const slug = String(objType.slug || '-');
      const title = String(objType.title || objType.singular || '-');
      const count = objType.total_objects || 0;
      const emoji = (objType.emoji as string) || '📄';

      console.log(`    ${emoji}  ${chalk.cyan(slug.padEnd(18))} ${title.padEnd(20)} ${chalk.dim(`${count} object${Number(count) !== 1 ? 's' : ''}`)}`);
    }
    console.log();
  } catch (error) {
    spinner.fail('Failed to load object types');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * List objects of a specific type
 */
async function listObjects(bucketSlug: string, typeSlug: string): Promise<void> {
  try {
    spinner.start('Loading...');
    const result = await api.listObjects(bucketSlug, { type: typeSlug, limit: 25 });
    spinner.stop();

    const objects = result.objects || [];

    if (objects.length === 0) {
      display.info('No objects found');
      return;
    }

    console.log();
    console.log(chalk.bold.cyan(`    Objects (${typeSlug})`));
    console.log(chalk.dim('    ' + '─'.repeat(60)));
    console.log();

    for (const obj of objects) {
      const objAny = obj as Record<string, unknown>;
      // Data might be nested inside 'object' property
      const data = (objAny.object || objAny) as Record<string, unknown>;

      const title = String(data.title || '-');
      const slug = String(data.slug || data.id || '-');
      const status = String(objAny.main_object_status || data.status || 'draft');

      const icon = status === 'published' ? chalk.green('●') : chalk.yellow('○');
      console.log(`    ${icon}  ${chalk.cyan(display.truncate(slug, 28).padEnd(28))} ${title}`);
    }

    if (result.total > objects.length) {
      console.log();
      console.log(chalk.dim(`    ... and ${result.total - objects.length} more`));
    }
    console.log();
  } catch (error) {
    spinner.fail('Failed to load objects');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * cd command - change directory
 */
async function cd(path?: string): Promise<void> {
  // No path or "/" - go to root
  if (!path || path === '/') {
    clearConfigValue('currentProject');
    clearConfigValue('currentProjectId');
    clearConfigValue('currentBucket');
    clearConfigValue('currentObjectType');
    console.log(chalk.dim('/'));
    return;
  }

  // ".." - go up one level
  if (path === '..') {
    const currentObjectType = getCurrentObjectType();
    const currentBucket = getConfigValue('currentBucket'); // Don't use credential fallback
    const currentProject = getCurrentProjectId();

    if (currentObjectType) {
      // In object type, go up to bucket
      clearConfigValue('currentObjectType');
      console.log(chalk.dim(`/${currentProject}/${currentBucket}`));
    } else if (currentBucket) {
      // In bucket, go up to project
      clearConfigValue('currentBucket');
      console.log(chalk.dim(`/${currentProject}`));
    } else if (currentProject) {
      // In project, go up to root
      clearConfigValue('currentProject');
      clearConfigValue('currentProjectId');
      console.log(chalk.dim('/'));
    } else {
      console.log(chalk.dim('/'));
    }
    return;
  }

  // Absolute path (starts with /)
  if (path.startsWith('/')) {
    const parts = path.split('/').filter(Boolean);

    if (parts.length === 0) {
      clearConfigValue('currentProject');
      clearConfigValue('currentProjectId');
      clearConfigValue('currentBucket');
      clearConfigValue('currentObjectType');
      console.log(chalk.dim('/'));
      return;
    }

    // Validate and set project
    const projectId = parts[0];
    try {
      spinner.start('');
      const project = await api.getProject(projectId);
      spinner.stop();

      const projAny = project as Record<string, unknown>;
      setConfigValue('currentProjectId', String(projAny.id || projectId));
      setConfigValue('currentProject', String(projAny.title || projectId));
      clearConfigValue('currentObjectType');

      if (parts.length >= 2) {
        const bucketSlug = parts[1];
        const buckets = projAny.buckets as Array<Record<string, unknown>> || [];
        const bucket = buckets.find(b => b.slug === bucketSlug);

        if (!bucket) {
          display.error(`Bucket "${bucketSlug}" not found`);
          process.exit(1);
        }

        setConfigValue('currentBucket', bucketSlug);
        // Store bucket keys for SDK
        await storeBucketKeys(bucketSlug);

        if (parts.length >= 3) {
          // Also set object type
          const typeSlug = parts[2];
          const bucketData = await api.getBucket(bucketSlug);
          const objectTypes = ((bucketData as Record<string, unknown>).object_types || []) as Array<Record<string, unknown>>;
          const objType = objectTypes.find(t => t.slug === typeSlug);

          if (!objType) {
            display.error(`Object type "${typeSlug}" not found`);
            process.exit(1);
          }

          setConfigValue('currentObjectType', typeSlug);
          console.log(chalk.dim(`/${projectId}/${bucketSlug}/${typeSlug}`));
        } else {
          console.log(chalk.dim(`/${projectId}/${bucketSlug}`));
        }
      } else {
        clearConfigValue('currentBucket');
        console.log(chalk.dim(`/${projectId}`));
      }
    } catch (error) {
      spinner.fail('Invalid path');
      display.error((error as Error).message);
      process.exit(1);
    }
    return;
  }

  // Relative path - depends on current context
  const currentProjectId = getCurrentProjectId();
  const currentBucket = getConfigValue('currentBucket'); // Don't use credential fallback
  const currentObjectType = getCurrentObjectType();

  if (!currentProjectId) {
    // At root level - path should be a project ID
    try {
      spinner.start('');
      const project = await api.getProject(path);
      spinner.stop();

      const projAny = project as Record<string, unknown>;
      setConfigValue('currentProjectId', String(projAny.id || path));
      setConfigValue('currentProject', String(projAny.title || path));
      clearConfigValue('currentBucket');
      clearConfigValue('currentObjectType');
      console.log(chalk.dim(`/${path}`));
    } catch (error) {
      spinner.fail('Not found');
      display.error((error as Error).message);
      process.exit(1);
    }
  } else if (!currentBucket) {
    // In a project - path should be a bucket slug
    try {
      spinner.start('');
      const project = await api.getProject(currentProjectId);
      spinner.stop();

      const projAny = project as Record<string, unknown>;
      const buckets = projAny.buckets as Array<Record<string, unknown>> || [];
      const bucket = buckets.find(b => b.slug === path);

      if (!bucket) {
        display.error(`Bucket "${path}" not found`);
        process.exit(1);
      }

      setConfigValue('currentBucket', path);
      clearConfigValue('currentObjectType');
      // Store bucket keys for SDK
      await storeBucketKeys(path);
      console.log(chalk.dim(`/${currentProjectId}/${path}`));
    } catch (error) {
      spinner.fail('Not found');
      display.error((error as Error).message);
      process.exit(1);
    }
  } else if (!currentObjectType) {
    // In a bucket - path should be an object type slug
    try {
      spinner.start('');
      const bucket = await api.getBucket(currentBucket);
      spinner.stop();

      const bucketAny = bucket as Record<string, unknown>;
      const objectTypes = (bucketAny.object_types || []) as Array<Record<string, unknown>>;
      const objType = objectTypes.find(t => t.slug === path);

      if (!objType) {
        display.error(`Object type "${path}" not found`);
        process.exit(1);
      }

      setConfigValue('currentObjectType', path);
      console.log(chalk.dim(`/${currentProjectId}/${currentBucket}/${path}`));
    } catch (error) {
      spinner.fail('Not found');
      display.error((error as Error).message);
      process.exit(1);
    }
  } else {
    display.error('Already at object type level. Use "cd .." to go up.');
    process.exit(1);
  }
}

/**
 * Create navigation commands
 */
export function createNavigationCommands(program: Command): void {
  program
    .command('pwd')
    .description('Print current working directory (project/bucket path)')
    .action(pwd);

  program
    .command('ls [path]')
    .description('List contents (projects, buckets, or objects)')
    .action(ls);

  program
    .command('cd [path]')
    .description('Change directory (navigate to project or bucket)')
    .action(cd);
}

export default { createNavigationCommands };
