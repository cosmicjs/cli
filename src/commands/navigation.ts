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
import * as prompts from '../utils/prompts.js';
import * as api from '../api/dashboard.js';
import { clearSDKClient } from '../api/sdk.js';
import { startChat } from '../chat/repl.js';

// Quick start templates for AI-generated content
const QUICK_START_TEMPLATES = [
  { name: 'Blog', prompt: 'A blog with posts, authors, and categories' },
  { name: 'E-commerce', prompt: 'An e-commerce store with products, categories, and reviews' },
  { name: 'Portfolio', prompt: 'A developer portfolio with projects, skills, and work experience' },
  { name: 'Company Site', prompt: 'A company website with services, team members, and testimonials' },
];

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
      const bucketText = `${buckets} bucket${Number(buckets) !== 1 ? 's' : ''}`;

      console.log(`    📁  ${chalk.cyan(id.padEnd(26))}${title.padEnd(28)}${chalk.dim(bucketText)}`);
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
      const countText = `${count} object${Number(count) !== 1 ? 's' : ''}`;

      console.log(`    ${emoji}  ${chalk.cyan(slug.padEnd(22))}${title.padEnd(24)}${chalk.dim(countText)}`);
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
    console.log();
    console.log(chalk.green(`  ✓ Now at Cosmic CLI home`));
    console.log(chalk.dim(`    Use "ls" to see projects.`));
    console.log();
    return;
  }

  // ".." - go up one level
  if (path === '..') {
    const currentObjectType = getCurrentObjectType();
    const currentBucket = getConfigValue('currentBucket'); // Don't use credential fallback
    const currentProjectId = getCurrentProjectId();
    const currentProjectTitle = getConfigValue('currentProject') || currentProjectId;

    if (currentObjectType) {
      // In object type, go up to bucket
      clearConfigValue('currentObjectType');
      // Fetch bucket title
      try {
        const bucket = await api.getBucket(currentBucket);
        const bucketTitle = String((bucket as Record<string, unknown>).title || currentBucket);
        console.log();
        console.log(chalk.green(`  ✓ Now in Project: ${chalk.bold(currentProjectTitle)} / Bucket: ${chalk.bold(bucketTitle)}`));
        console.log();
      } catch {
        console.log();
        console.log(chalk.green(`  ✓ Now in Project: ${chalk.bold(currentProjectTitle)} / Bucket: ${chalk.bold(currentBucket)}`));
        console.log();
      }
    } else if (currentBucket) {
      // In bucket, go up to project (or root if only one bucket)
      clearConfigValue('currentBucket');

      // Check if project has only one bucket - if so, go directly to root
      try {
        const project = await api.getProject(currentProjectId);
        const buckets = ((project as Record<string, unknown>).buckets || []) as Array<Record<string, unknown>>;

        if (buckets.length === 1) {
          // Only one bucket, go directly to root
          clearConfigValue('currentProject');
          clearConfigValue('currentProjectId');
          console.log();
          console.log(chalk.green(`  ✓ Now at Cosmic CLI home`));
          console.log(chalk.dim(`    Use "ls" to see projects.`));
          console.log();
        } else {
          console.log();
          console.log(chalk.green(`  ✓ Now in Project: ${chalk.bold(currentProjectTitle)}`));
          console.log(chalk.dim(`    Use "ls" to see buckets, or "cd <bucket-slug>" to select a bucket.`));
          console.log();
        }
      } catch {
        // Fallback to staying at project level
        console.log();
        console.log(chalk.green(`  ✓ Now in Project: ${chalk.bold(currentProjectTitle)}`));
        console.log(chalk.dim(`    Use "ls" to see buckets, or "cd <bucket-slug>" to select a bucket.`));
        console.log();
      }
    } else if (currentProjectId) {
      // In project, go up to root
      clearConfigValue('currentProject');
      clearConfigValue('currentProjectId');
      console.log();
      console.log(chalk.green(`  ✓ Now at Cosmic CLI home`));
      console.log(chalk.dim(`    Use "ls" to see projects.`));
      console.log();
    } else {
      console.log();
      console.log(chalk.green(`  ✓ Now at Cosmic CLI home`));
      console.log(chalk.dim(`    Use "ls" to see projects.`));
      console.log();
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
      const projectTitle = String(projAny.title || projectId);
      setConfigValue('currentProjectId', String(projAny.id || projectId));
      setConfigValue('currentProject', projectTitle);
      clearConfigValue('currentObjectType');

      if (parts.length >= 2) {
        const bucketSlug = parts[1];
        const buckets = projAny.buckets as Array<Record<string, unknown>> || [];
        const bucket = buckets.find(b => b.slug === bucketSlug);

        if (!bucket) {
          display.error(`Bucket "${bucketSlug}" not found`);
          process.exit(1);
        }

        const bucketTitle = String(bucket.title || bucketSlug);
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

          const objTypeTitle = String(objType.title || typeSlug);
          setConfigValue('currentObjectType', typeSlug);
          console.log();
          console.log(chalk.green(`  ✓ Now in Project: ${chalk.bold(projectTitle)} / Bucket: ${chalk.bold(bucketTitle)} / Type: ${chalk.bold(objTypeTitle)}`));
          console.log();
        } else {
          console.log();
          console.log(chalk.green(`  ✓ Now in Project: ${chalk.bold(projectTitle)} / Bucket: ${chalk.bold(bucketTitle)}`));
          console.log(chalk.dim(`    Use "ls" to see object types, or start chatting with "cosmic chat".`));
          console.log();
        }
      } else {
        // Only project specified - check if single bucket to auto-navigate
        const buckets = (projAny.buckets || []) as Array<Record<string, unknown>>;

        if (buckets.length === 1) {
          const bucket = buckets[0];
          const bucketSlug = String(bucket.slug || '');
          const bucketTitle = String(bucket.title || bucketSlug);
          setConfigValue('currentBucket', bucketSlug);
          await storeBucketKeys(bucketSlug);
          console.log();
          console.log(chalk.green(`  ✓ Now in Project: ${chalk.bold(projectTitle)} / Bucket: ${chalk.bold(bucketTitle)}`));
          console.log(chalk.dim(`    (Auto-selected only bucket)`));
          console.log(chalk.dim(`    Use "ls" to see object types, or start chatting with "cosmic chat".`));
          console.log();
        } else {
          clearConfigValue('currentBucket');
          console.log();
          console.log(chalk.green(`  ✓ Now in Project: ${chalk.bold(projectTitle)}`));
          console.log(chalk.dim(`    Use "ls" to see buckets, or "cd <bucket-slug>" to select a bucket.`));
          console.log();
        }
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

  // Check if path looks like a MongoDB ObjectId (24 hex chars) - treat as project ID
  const isProjectId = /^[a-f0-9]{24}$/i.test(path);

  if (!currentProjectId || isProjectId) {
    // At root level OR path is a project ID - navigate to project
    try {
      spinner.start('');
      const project = await api.getProject(path);
      spinner.stop();

      const projAny = project as Record<string, unknown>;
      const projectTitle = String(projAny.title || path);
      const buckets = (projAny.buckets || []) as Array<Record<string, unknown>>;

      setConfigValue('currentProjectId', String(projAny.id || path));
      setConfigValue('currentProject', projectTitle);
      clearConfigValue('currentObjectType');

      // If only one bucket, auto-navigate into it
      if (buckets.length === 1) {
        const bucket = buckets[0];
        const bucketSlug = String(bucket.slug || '');
        const bucketTitle = String(bucket.title || bucketSlug);
        setConfigValue('currentBucket', bucketSlug);
        await storeBucketKeys(bucketSlug);
        console.log();
        console.log(chalk.green(`  ✓ Now in Project: ${chalk.bold(projectTitle)} / Bucket: ${chalk.bold(bucketTitle)}`));
        console.log(chalk.dim(`    (Auto-selected only bucket)`));
        console.log(chalk.dim(`    Use "ls" to see object types, or start chatting with "cosmic chat".`));
        console.log();
      } else {
        clearConfigValue('currentBucket');
        console.log();
        console.log(chalk.green(`  ✓ Now in Project: ${chalk.bold(projectTitle)}`));
        console.log(chalk.dim(`    Use "ls" to see buckets, or "cd <bucket-slug>" to select a bucket.`));
        console.log();
      }
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

      const bucketTitle = String(bucket.title || path);
      const projectTitle = String(projAny.title || currentProjectId);
      setConfigValue('currentBucket', path);
      clearConfigValue('currentObjectType');
      // Store bucket keys for SDK
      await storeBucketKeys(path);
      console.log();
      console.log(chalk.green(`  ✓ Now in Project: ${chalk.bold(projectTitle)} / Bucket: ${chalk.bold(bucketTitle)}`));
      console.log(chalk.dim(`    Use "ls" to see object types, or start chatting with "cosmic chat".`));
      console.log();
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

      const objTypeTitle = String(objType.title || path);
      setConfigValue('currentObjectType', path);
      console.log();
      console.log(chalk.green(`  ✓ Now in Object Type: ${chalk.bold(objTypeTitle)}`));
      console.log(chalk.dim(`    Use "ls" to see objects.`));
      console.log();
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
 * Create a new project with interactive prompts
 */
async function createProject(): Promise<void> {
  display.header('Create a New Project');

  // Step 1: Get project title
  const projectTitle = await prompts.text({
    message: 'Project title:',
    required: true,
  });

  // Step 2: Get project description (optional)
  const description = await prompts.text({
    message: 'Description (optional):',
    required: false,
  });

  // Step 3: Choose how to start (default to AI)
  const startMethod = await prompts.select<'scratch' | 'ai' | 'template'>({
    message: 'How would you like to start?',
    choices: [
      { name: 'ai', message: 'Use AI to generate content model' },
      { name: 'template', message: 'Use a quick start template' },
      { name: 'scratch', message: 'Start from scratch' },
    ],
  });

  let aiPrompt: string | undefined;

  if (startMethod === 'template') {
    // Show quick start templates
    const templateChoice = await prompts.select<string>({
      message: 'Choose a template:',
      choices: QUICK_START_TEMPLATES.map(t => ({
        name: t.name,
        message: `${t.name} - "${t.prompt}"`,
      })),
    });

    const template = QUICK_START_TEMPLATES.find(t => t.name === templateChoice);
    aiPrompt = template?.prompt;
  } else if (startMethod === 'ai') {
    // Get custom AI prompt
    aiPrompt = await prompts.text({
      message: 'Describe your content model:',
      required: true,
    });
  }

  // Create the project
  try {
    spinner.start('Creating project...');

    const workspaceId = getCurrentWorkspaceId();
    const result = await api.createProject(
      {
        project_title: projectTitle,
        bucket_title: 'Production',
        description: description || undefined,
        ai_prompt: aiPrompt,
        plan_id: 'free',
      },
      workspaceId
    );

    spinner.succeed(`Project "${chalk.cyan(projectTitle)}" created!`);

    // Extract project and bucket info from response
    const projectAny = result.project as Record<string, unknown>;
    const bucketAny = result.bucket as Record<string, unknown>;
    const projectId = String(projectAny.id || projectAny._id);
    const bucketSlug = String(bucketAny.slug);

    display.newline();
    display.keyValue('Project ID', projectId);
    display.keyValue('Bucket', bucketSlug);

    // Auto-set context to the new project/bucket
    setConfigValue('currentProjectId', projectId);
    setConfigValue('currentProject', projectTitle);
    setConfigValue('currentBucket', bucketSlug);

    // Store bucket keys if available
    await storeBucketKeys(bucketSlug);

    display.newline();
    display.success(`Context set to ${chalk.cyan(`/${projectId}/${bucketSlug}`)}`);

    // If AI prompt was used, offer to start chat
    if (aiPrompt) {
      display.newline();
      const startAiChat = await prompts.confirm({
        message: 'Start AI chat to build your content model?',
        initial: true,
      });

      if (startAiChat) {
        display.newline();
        display.info('Starting AI chat to create your content model...');
        display.newline();

        // Start chat with a directive to use install_content_model action
        const createPrompt = `Create a complete content model for: ${aiPrompt}

Use the install_content_model action to create ALL object types AND demo content in one step. Include:
1. All necessary object types with appropriate metafields
2. 2-3 demo objects for each type with realistic content
3. Unsplash image URLs for thumbnails and file metafields (use real URLs like https://images.unsplash.com/photo-...)

Remember to create types that are referenced by others FIRST (e.g., categories and authors before blog posts).`;
        await startChat({ initialPrompt: createPrompt });
      } else {
        display.newline();
        display.info(`Run ${chalk.cyan('cosmic chat')} to start AI chat later.`);
        display.info(`Your prompt: "${chalk.dim(aiPrompt)}"`);
      }
    } else {
      display.newline();
      display.info(`Run ${chalk.cyan('cosmic chat')} to use AI to build your content model.`);
    }
  } catch (error) {
    spinner.fail('Failed to create project');
    display.error((error as Error).message);
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

// Export createProject for use by config.ts
export { createProject };

export default { createNavigationCommands };
