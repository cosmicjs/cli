/**
 * Action execution: parse and execute AI-generated ACTION commands
 */

import chalk from 'chalk';
import { getCurrentBucketSlug } from '../config/store.js';
import { getSDKClient } from '../api/sdk.js';
import {
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
  listObjectTypes,
  createObjectType,
  createObjectWithMetafields,
} from '../api/dashboard.js';
import * as api from '../api/dashboard.js';
import * as spinner from '../utils/spinner.js';
import { select } from '../utils/prompts.js';
import { state } from './state.js';
import { addIdsToMetafields, askConfirmation } from './utils.js';
import { processMetafieldImages, processUnsplashUrls, uploadUnsplashImage } from './images.js';
import { updateObjectReferences } from './contentInstaller.js';
import { formatObjectDetails } from './prompts.js';

/**
 * Parse and execute actions from AI response
 */
export async function executeAction(actionJson: string): Promise<string> {
  const sdk = getSDKClient();
  if (!sdk) {
    return 'Error: SDK not available';
  }

  const bucketSlug = getCurrentBucketSlug();
  if (!bucketSlug) {
    return 'Error: No bucket selected. Use "cosmic use" to set a bucket.';
  }

  try {
    const action = JSON.parse(actionJson);

    switch (action.action) {
      case 'create_batch': {
        if (!action.type || !action.items || !action.count) {
          return 'Error: Batch create requires type, count, and items array.';
        }

        console.log();
        console.log(chalk.yellow(`  Create ${action.count} ${action.type}:`));
        for (let i = 0; i < action.items.length; i++) {
          console.log(chalk.yellow(`    ${i + 1}. ${action.items[i]}`));
        }
        process.stdout.write(chalk.yellow(`  Proceed? `));
        const confirmed = await askConfirmation();

        if (!confirmed) {
          return chalk.dim('Cancelled.');
        }

        state.skipConfirmations = true;
        return `✓ Confirmed. Creating ${action.count} ${action.type}...`;
      }

      case 'create': {
        if (!action.type) {
          return 'Error: "type" is required. Please specify the object type slug (e.g., "blog-posts").';
        }
        if (!action.title) {
          return 'Error: "title" is required.';
        }

        if (!state.skipConfirmations) {
          console.log();
          process.stdout.write(chalk.yellow(`  Create ${action.type}: "${action.title}"? `));
          const confirmed = await askConfirmation();

          if (!confirmed) {
            return chalk.dim('Cancelled.');
          }
        }

        spinner.start('Creating...');

        const insertPayload: Record<string, unknown> = {
          type: action.type,
          title: action.title,
        };

        if (action.slug) {
          insertPayload.slug = action.slug;
        }

        if (action.metadata) {
          insertPayload.metadata = action.metadata;
        }

        if (action.content && !action.metadata) {
          insertPayload.metadata = { content: action.content };
        }

        const result = await sdk.objects.insertOne(insertPayload);
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

        const query: Record<string, unknown> = {};
        if (action.type) query.type = action.type;
        const limit = action.limit || 10;

        const result = await sdk.objects.find(query).status('any').limit(limit);
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

        const identifier = action.id || action.slug;
        if (!identifier) {
          spinner.stop();
          return 'Error: No object ID or slug provided.';
        }

        try {
          const isObjectId = /^[a-f0-9]{24}$/i.test(identifier);

          let result;
          if (isObjectId) {
            const findResult = await sdk.objects.find({ id: identifier }).status('any').limit(1);
            result = { object: findResult.objects?.[0] };
          } else {
            const findResult = await sdk.objects.find({ slug: identifier }).status('any').limit(1);
            result = { object: findResult.objects?.[0] };
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
            model: action.model || 'claude-opus-4-5-20251101',
            emoji: action.emoji || '🤖',
          };

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

      // ============== OBJECT TYPES ==============

      case 'list_object_types': {
        spinner.start('Fetching object types...');
        const bucketSlug = getCurrentBucketSlug();
        if (!bucketSlug) {
          spinner.stop();
          return 'Error: No bucket selected.';
        }

        const types = await listObjectTypes(bucketSlug);
        spinner.stop();

        if (types.length === 0) {
          return 'No object types found.';
        }

        let output = `Found ${types.length} object type(s):\n`;
        for (const t of types) {
          const typeAny = t as Record<string, unknown>;
          const emoji = typeAny.emoji || '📄';
          output += `  ${emoji} ${typeAny.title} (${typeAny.slug})\n`;
        }
        return output;
      }

      case 'create_object_type': {
        if (!action.title) {
          return 'Error: Object type title is required.';
        }

        console.log();
        process.stdout.write(chalk.yellow(`  Create object type "${action.title}"? `));
        const confirmed = await askConfirmation();

        if (!confirmed) {
          return chalk.dim('Cancelled.');
        }

        spinner.start('Creating object type...');

        const sdkClient = getSDKClient();
        if (!sdkClient) {
          spinner.stop();
          return 'Error: SDK client not available.';
        }

        const objectTypeData: Record<string, unknown> = {
          title: action.title,
        };

        if (action.slug) objectTypeData.slug = action.slug;
        if (action.singular) objectTypeData.singular = action.singular;
        if (action.emoji) objectTypeData.emoji = action.emoji;
        if (action.singleton !== undefined) objectTypeData.singleton = action.singleton;

        if (action.metafields && Array.isArray(action.metafields)) {
          objectTypeData.metafields = action.metafields.map((field: Record<string, unknown>) => {
            const sanitized = { ...field };
            if (field.type === 'switch') {
              sanitized.options = 'true,false';
            }
            return sanitized;
          });
        }

        const result = await sdkClient.objectTypes.insertOne(objectTypeData);
        spinner.stop();

        const typeAny = result.object_type as Record<string, unknown>;
        return `✓ Created object type "${typeAny.title}" with slug "${typeAny.slug}"`;
      }

      case 'install_content_model': {
        const objectTypes = action.object_types as Record<string, unknown>[];
        const demoObjects = action.demo_objects as Record<string, unknown>[];

        if (!objectTypes || !Array.isArray(objectTypes) || objectTypes.length === 0) {
          return 'Error: install_content_model requires object_types array.';
        }

        // Show confirmation with summary
        console.log();
        console.log(chalk.yellow(`  Install Content Model:`));
        console.log(chalk.yellow(`    • ${objectTypes.length} object type(s)`));
        if (demoObjects && demoObjects.length > 0) {
          console.log(chalk.yellow(`    • ${demoObjects.length} demo object(s)`));
        }
        console.log();

        for (const ot of objectTypes) {
          const emoji = (ot.emoji as string) || '📄';
          console.log(chalk.yellow(`    ${emoji} ${ot.title}`));
        }

        console.log();
        process.stdout.write(chalk.yellow(`  Proceed? `));
        const confirmed = await askConfirmation();

        if (!confirmed) {
          return chalk.dim('Cancelled.');
        }

        const results: string[] = [];
        const createdObjectTypes: Map<string, Record<string, unknown>> = new Map();
        const createdObjects: Map<string, string> = new Map();
        const successfulObjects: Array<{ object: Record<string, unknown>; id: string; insertPayload: Record<string, unknown> }> = [];

        // Step 1: Create all object types
        console.log();
        console.log(chalk.cyan('  Creating object types...'));
        console.log();

        let typesCreated = 0;
        let typesFailed = 0;

        for (const ot of objectTypes) {
          const emoji = (ot.emoji as string) || '📄';
          process.stdout.write(chalk.dim(`  ${emoji} Creating "${ot.title}"...`));

          try {
            const objectTypeData: Record<string, unknown> = {
              title: ot.title,
            };

            if (ot.slug) objectTypeData.slug = ot.slug;
            if (ot.singular) objectTypeData.singular = ot.singular;
            if (ot.emoji) objectTypeData.emoji = ot.emoji;

            if (ot.metafields && Array.isArray(ot.metafields)) {
              const metafieldsWithIds = addIdsToMetafields(ot.metafields as Record<string, unknown>[]);
              objectTypeData.metafields = metafieldsWithIds.map((field: Record<string, unknown>) => {
                const sanitized = { ...field };
                if (field.type === 'switch') {
                  sanitized.options = 'true,false';
                }
                return sanitized;
              });
            }

            const typeResult = await createObjectType(bucketSlug, objectTypeData as Parameters<typeof createObjectType>[1]);

            const typeAny = typeResult as Record<string, unknown>;
            const slug = typeAny.slug as string;
            createdObjectTypes.set(slug, typeAny);

            process.stdout.write('\r' + ' '.repeat(60) + '\r');
            console.log(chalk.green(`  ${emoji} ${typeAny.title} `) + chalk.dim(`(${slug})`));
            results.push(`Created object type: ${typeAny.title}`);
            typesCreated++;
          } catch (error) {
            process.stdout.write('\r' + ' '.repeat(60) + '\r');
            console.log(chalk.red(`  ✗ ${ot.title}: ${(error as Error).message}`));
            results.push(`Failed: ${ot.title} - ${(error as Error).message}`);
            typesFailed++;
          }
        }

        console.log();
        if (typesCreated > 0) {
          console.log(chalk.green(`  ✓ ${typesCreated} object type${typesCreated !== 1 ? 's' : ''} created`));
        }
        if (typesFailed > 0) {
          console.log(chalk.red(`  ✗ ${typesFailed} failed`));
        }

        // Step 2: Create demo objects
        if (demoObjects && demoObjects.length > 0) {
          console.log();
          console.log(chalk.cyan('  Creating demo content...'));
          console.log();

          let objectsCreated = 0;
          let objectsFailed = 0;

          // Sort: create objects without references first
          const sortedDemoObjects = [...demoObjects].sort((a, b) => {
            const aType = createdObjectTypes.get(a.type as string);
            const bType = createdObjectTypes.get(b.type as string);

            const countRefs = (ot: Record<string, unknown> | undefined) => {
              if (!ot?.metafields) return 0;
              return (ot.metafields as Record<string, unknown>[]).filter(
                (m) => m.type === 'object' || m.type === 'objects'
              ).length;
            };

            return countRefs(aType) - countRefs(bType);
          });

          for (const obj of sortedDemoObjects) {
            const typeSlug = obj.type as string;
            const objectType = createdObjectTypes.get(typeSlug);

            if (!objectType) {
              console.log(chalk.yellow(`  ⚠ Skipping "${obj.title}" - object type "${typeSlug}" not found`));
              continue;
            }

            process.stdout.write(chalk.dim(`  📝 Creating "${obj.title}"...`));

            try {
              const objectTypeMetafields = (objectType.metafields as Record<string, unknown>[]) || [];
              await processUnsplashUrls(obj, bucketSlug, objectTypeMetafields);

              const insertPayload: {
                title: string;
                slug?: string;
                type: string;
                status?: string;
                thumbnail?: string;
                metafields?: Array<{
                  id?: string;
                  title?: string;
                  key: string;
                  type: string;
                  value?: unknown;
                  required?: boolean;
                  object_type?: string;
                }>;
              } = {
                type: typeSlug,
                title: obj.title as string,
                status: (obj.status as string) || 'published',
              };

              if (obj.slug) insertPayload.slug = obj.slug as string;
              if (obj.thumbnail) insertPayload.thumbnail = obj.thumbnail as string;

              // Convert metadata object to metafields array
              if (obj.metadata && typeof obj.metadata === 'object') {
                const metadata = obj.metadata as Record<string, unknown>;
                const metafieldsArray: Array<{
                  id?: string;
                  title?: string;
                  key: string;
                  type: string;
                  value?: unknown;
                  required?: boolean;
                  object_type?: string;
                }> = [];

                const typeMetafieldsMap = new Map<string, Record<string, unknown>>();
                for (const mf of objectTypeMetafields) {
                  typeMetafieldsMap.set(mf.key as string, mf);
                }

                for (const [key, value] of Object.entries(metadata)) {
                  const objectTypeMetafield = typeMetafieldsMap.get(key);
                  let fieldType = 'text';
                  let objectTypeRef: string | undefined;

                  if (objectTypeMetafield) {
                    fieldType = (objectTypeMetafield.type as string) || 'text';
                    if (fieldType === 'object' || fieldType === 'objects') {
                      objectTypeRef = objectTypeMetafield.object_type as string;
                    }
                  } else {
                    if (Array.isArray(value)) {
                      if (key.includes('image') || key.includes('photo') || key.includes('gallery')) {
                        fieldType = 'files';
                      }
                    } else if (key.includes('image') || key.includes('photo') || key.includes('thumbnail') || key.includes('featured')) {
                      fieldType = 'file';
                    } else if (key.includes('content') || key.includes('body') || key.includes('description')) {
                      fieldType = 'html-textarea';
                    } else if (key.includes('date')) {
                      fieldType = 'date';
                    } else if (typeof value === 'boolean') {
                      fieldType = 'switch';
                    }
                  }

                  const metafieldEntry: {
                    id?: string;
                    title?: string;
                    key: string;
                    type: string;
                    value?: unknown;
                    required?: boolean;
                    object_type?: string;
                  } = {
                    key,
                    type: fieldType,
                    title: key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' '),
                    value,
                    required: false,
                  };

                  if (objectTypeRef) {
                    metafieldEntry.object_type = objectTypeRef;
                  }

                  metafieldsArray.push(metafieldEntry);
                }

                const metafieldsWithIds = addIdsToMetafields(metafieldsArray as Record<string, unknown>[]);
                const processedMetafields = await processMetafieldImages(metafieldsWithIds, bucketSlug);

                insertPayload.metafields = processedMetafields.map(mf => {
                  const metafield = mf as Record<string, unknown>;
                  const result: {
                    id?: string;
                    title?: string;
                    key: string;
                    type: string;
                    value?: unknown;
                    required?: boolean;
                    object_type?: string;
                  } = {
                    id: metafield.id as string,
                    title: metafield.title as string || (metafield.key as string).charAt(0).toUpperCase() + (metafield.key as string).slice(1).replace(/_/g, ' '),
                    key: metafield.key as string,
                    type: metafield.type as string,
                    value: metafield.value,
                    required: (metafield.required as boolean) || false,
                  };
                  if (metafield.object_type) {
                    result.object_type = metafield.object_type as string;
                  }
                  return result;
                });
              }

              const createdObj = await createObjectWithMetafields(bucketSlug, insertPayload);
              const createdObjAny = createdObj as Record<string, unknown>;
              const actualSlug = createdObjAny.slug as string;
              const id = createdObjAny.id as string;

              createdObjects.set(actualSlug, id);

              const expectedSlug = obj.slug as string;
              if (expectedSlug && expectedSlug !== actualSlug) {
                createdObjects.set(expectedSlug, id);
              }

              const titleSlug = (obj.title as string).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
              if (titleSlug && titleSlug !== actualSlug) {
                createdObjects.set(titleSlug, id);
              }

              successfulObjects.push({ object: insertPayload as Record<string, unknown>, id, insertPayload: insertPayload as Record<string, unknown> });

              process.stdout.write('\r' + ' '.repeat(60) + '\r');
              console.log(chalk.green(`  ✓ ${createdObjAny.title} `) + chalk.dim(`(${typeSlug})`));
              results.push(`Created object: ${createdObjAny.title}`);
              objectsCreated++;
            } catch (error) {
              process.stdout.write('\r' + ' '.repeat(60) + '\r');
              console.log(chalk.red(`  ✗ ${obj.title}: ${(error as Error).message}`));
              results.push(`Failed: ${obj.title} - ${(error as Error).message}`);
              objectsFailed++;
            }
          }

          console.log();
          if (objectsCreated > 0) {
            console.log(chalk.green(`  ✓ ${objectsCreated} object${objectsCreated !== 1 ? 's' : ''} created`));
          }
          if (objectsFailed > 0) {
            console.log(chalk.red(`  ✗ ${objectsFailed} failed`));
          }

          // Step 3: Resolve object references
          if (successfulObjects.length > 0) {
            await updateObjectReferences(bucketSlug, successfulObjects);
          }
        }

        console.log();
        const totalTypes = createdObjectTypes.size;
        const totalObjects = successfulObjects.length;
        console.log(chalk.green(`✓ Content model installed: ${totalTypes} object type${totalTypes !== 1 ? 's' : ''}${totalObjects > 0 ? `, ${totalObjects} object${totalObjects !== 1 ? 's' : ''}` : ''}`));

        // Show next steps
        if (totalTypes > 0 || totalObjects > 0) {
          console.log();

          const nextAction = await select<'build' | 'content' | 'exit'>({
            message: 'What would you like to do next?',
            choices: [
              { name: 'build', message: 'Build and deploy an app' },
              { name: 'content', message: 'Add more content' },
              { name: 'exit', message: 'Exit' },
            ],
          });

          if (nextAction === 'build') {
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
            return '';
          } else if (nextAction === 'exit') {
            return 'EXIT_REQUESTED';
          }
        }

        return '';
      }

      case 'list_repositories': {
        const { repositories } = await api.listRepositories(bucketSlug);

        if (repositories.length === 0) {
          return 'No repositories connected. Use `cosmic repos connect` to add one.';
        }

        let result = `Found ${repositories.length} repository(ies):\n\n`;
        for (const repo of repositories) {
          result += `• ${repo.repository_name} (${repo.framework || 'other'})\n`;
          result += `  ID: ${repo.id}\n`;
          result += `  URL: ${repo.repository_url}\n`;
          if (repo.production_url) {
            result += `  Production: ${repo.production_url}\n`;
          }
          result += '\n';
        }
        return result;
      }

      case 'deploy_repository': {
        const repositoryId = action.repository_id as string;
        if (!repositoryId) {
          return 'Error: deploy_repository requires repository_id.';
        }

        console.log();
        console.log(chalk.yellow(`  Deploying repository...`));

        const result = await api.deployRepository(bucketSlug, repositoryId);

        if (!result.success) {
          return 'Error: Failed to deploy repository';
        }

        let response = '✓ Deployment started';
        if (result.deployment_url) {
          response += `\n  URL: ${result.deployment_url}`;
        }
        return response;
      }

      default:
        return `Unknown action: ${action.action}`;
    }
  } catch (error) {
    return `Error: ${(error as Error).message}`;
  }
}
