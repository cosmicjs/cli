/**
 * Tool Handlers
 * Execute AI tool calls and return results
 */

import * as api from '../api/dashboard.js';
import type { AIToolResult } from '../types.js';

/**
 * Execute a tool call
 */
export async function executeToolCall(
  toolName: string,
  args: Record<string, unknown>,
  bucketSlug: string
): Promise<AIToolResult> {
  try {
    switch (toolName) {
      // Object tools
      case 'list_objects':
        return await handleListObjects(args, bucketSlug);
      case 'get_object':
        return await handleGetObject(args, bucketSlug);
      case 'create_object':
        return await handleCreateObject(args, bucketSlug);
      case 'update_object':
        return await handleUpdateObject(args, bucketSlug);
      case 'delete_objects':
        return await handleDeleteObjects(args, bucketSlug);
      case 'publish_objects':
        return await handlePublishObjects(args, bucketSlug);
      case 'unpublish_objects':
        return await handleUnpublishObjects(args, bucketSlug);
      case 'list_object_types':
        return await handleListObjectTypes(bucketSlug);

      // Media tools
      case 'list_media':
        return await handleListMedia(args, bucketSlug);
      case 'get_media':
        return await handleGetMedia(args, bucketSlug);
      case 'delete_media':
        return await handleDeleteMedia(args, bucketSlug);

      // Workflow tools
      case 'list_workflows':
        return await handleListWorkflows(args, bucketSlug);
      case 'get_workflow':
        return await handleGetWorkflow(args, bucketSlug);
      case 'execute_workflow':
        return await handleExecuteWorkflow(args, bucketSlug);
      case 'list_executions':
        return await handleListExecutions(args, bucketSlug);

      // Agent tools
      case 'list_agents':
        return await handleListAgents(bucketSlug);
      case 'get_agent':
        return await handleGetAgent(args, bucketSlug);
      case 'run_agent':
        return await handleRunAgent(args, bucketSlug);

      // AI tools
      case 'generate_text':
        return await handleGenerateText(args, bucketSlug);
      case 'generate_image':
        return await handleGenerateImage(args, bucketSlug);

      default:
        return {
          success: false,
          error: `Unknown tool: ${toolName}`,
        };
    }
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message,
    };
  }
}

// ============================================================================
// Object Handlers
// ============================================================================

async function handleListObjects(
  args: Record<string, unknown>,
  bucketSlug: string
): Promise<AIToolResult> {
  const { objects, total } = await api.listObjects(bucketSlug, {
    type: args.type as string,
    status: args.status as 'published' | 'draft' | 'any',
    limit: (args.limit as number) || 10,
  });

  return {
    success: true,
    data: {
      objects: objects.map((obj) => ({
        id: obj.id,
        title: obj.title,
        slug: obj.slug,
        type: obj.type,
        status: obj.status,
        created_at: obj.created_at,
      })),
      total,
    },
  };
}

async function handleGetObject(
  args: Record<string, unknown>,
  bucketSlug: string
): Promise<AIToolResult> {
  const object = await api.getObject(bucketSlug, args.id as string);

  return {
    success: true,
    data: object,
  };
}

async function handleCreateObject(
  args: Record<string, unknown>,
  bucketSlug: string
): Promise<AIToolResult> {
  const object = await api.createObject(bucketSlug, {
    type: args.type as string,
    title: args.title as string,
    content: args.content as string,
    status: (args.status as 'published' | 'draft') || 'draft',
    metadata: args.metadata as Record<string, unknown>,
  });

  return {
    success: true,
    data: {
      id: object.id,
      title: object.title,
      slug: object.slug,
      status: object.status,
    },
  };
}

async function handleUpdateObject(
  args: Record<string, unknown>,
  bucketSlug: string
): Promise<AIToolResult> {
  const object = await api.updateObject(bucketSlug, args.id as string, {
    title: args.title as string,
    content: args.content as string,
    status: args.status as 'published' | 'draft',
    metadata: args.metadata as Record<string, unknown>,
  });

  return {
    success: true,
    data: {
      id: object.id,
      title: object.title,
      status: object.status,
    },
  };
}

async function handleDeleteObjects(
  args: Record<string, unknown>,
  bucketSlug: string
): Promise<AIToolResult> {
  await api.deleteObjects(bucketSlug, args.ids as string[]);

  return {
    success: true,
    data: {
      deleted: (args.ids as string[]).length,
    },
  };
}

async function handlePublishObjects(
  args: Record<string, unknown>,
  bucketSlug: string
): Promise<AIToolResult> {
  await api.publishObjects(bucketSlug, args.ids as string[]);

  return {
    success: true,
    data: {
      published: (args.ids as string[]).length,
    },
  };
}

async function handleUnpublishObjects(
  args: Record<string, unknown>,
  bucketSlug: string
): Promise<AIToolResult> {
  await api.unpublishObjects(bucketSlug, args.ids as string[]);

  return {
    success: true,
    data: {
      unpublished: (args.ids as string[]).length,
    },
  };
}

async function handleListObjectTypes(bucketSlug: string): Promise<AIToolResult> {
  const types = await api.listObjectTypes(bucketSlug);

  return {
    success: true,
    data: {
      object_types: types.map((type) => ({
        slug: type.slug,
        title: type.title,
        singular: type.singular,
        emoji: type.emoji,
      })),
    },
  };
}

// ============================================================================
// Media Handlers
// ============================================================================

async function handleListMedia(
  args: Record<string, unknown>,
  bucketSlug: string
): Promise<AIToolResult> {
  const { media, total } = await api.listMedia(bucketSlug, {
    folder: args.folder as string,
    limit: (args.limit as number) || 20,
  });

  return {
    success: true,
    data: {
      media: media.map((file) => ({
        id: file.id,
        name: file.name,
        url: file.url,
        type: file.type,
        size: file.size,
      })),
      total,
    },
  };
}

async function handleGetMedia(
  args: Record<string, unknown>,
  bucketSlug: string
): Promise<AIToolResult> {
  const media = await api.getMedia(bucketSlug, args.id as string);

  return {
    success: true,
    data: media,
  };
}

async function handleDeleteMedia(
  args: Record<string, unknown>,
  bucketSlug: string
): Promise<AIToolResult> {
  await api.deleteMedia(bucketSlug, args.ids as string[]);

  return {
    success: true,
    data: {
      deleted: (args.ids as string[]).length,
    },
  };
}

// ============================================================================
// Workflow Handlers
// ============================================================================

async function handleListWorkflows(
  args: Record<string, unknown>,
  bucketSlug: string
): Promise<AIToolResult> {
  const workflows = await api.listWorkflows(bucketSlug, {
    status: args.status as 'active' | 'draft' | 'paused',
  });

  return {
    success: true,
    data: {
      workflows: workflows.map((wf) => ({
        id: wf.id,
        name: wf.workflow_name,
        status: wf.status,
        schedule_type: wf.schedule_type,
        steps_count: wf.steps?.length || 0,
      })),
    },
  };
}

async function handleGetWorkflow(
  args: Record<string, unknown>,
  bucketSlug: string
): Promise<AIToolResult> {
  const workflow = await api.getWorkflow(bucketSlug, args.id as string);

  return {
    success: true,
    data: {
      id: workflow.id,
      name: workflow.workflow_name,
      description: workflow.description,
      status: workflow.status,
      schedule_type: workflow.schedule_type,
      steps: workflow.steps?.map((step) => ({
        agent_type: step.agent_type,
        agent_name: step.agent_name,
        emoji: step.emoji,
      })),
    },
  };
}

async function handleExecuteWorkflow(
  args: Record<string, unknown>,
  bucketSlug: string
): Promise<AIToolResult> {
  const execution = await api.executeWorkflow(bucketSlug, args.id as string, {
    user_inputs: args.inputs as Record<string, unknown>,
  });

  return {
    success: true,
    data: {
      execution_id: execution.id,
      status: execution.status,
    },
  };
}

async function handleListExecutions(
  args: Record<string, unknown>,
  bucketSlug: string
): Promise<AIToolResult> {
  const { executions, total } = await api.listExecutions(bucketSlug, {
    workflow_id: args.workflow_id as string,
    status: args.status as string,
    limit: (args.limit as number) || 10,
  });

  return {
    success: true,
    data: {
      executions: executions.map((exec) => ({
        id: exec.id,
        workflow_id: exec.workflow_id,
        status: exec.status,
        trigger_type: exec.trigger_type,
        started_at: exec.started_at,
      })),
      total,
    },
  };
}

// ============================================================================
// Agent Handlers
// ============================================================================

async function handleListAgents(bucketSlug: string): Promise<AIToolResult> {
  const agents = await api.listAgents(bucketSlug);

  return {
    success: true,
    data: {
      agents: agents.map((agent) => ({
        id: agent.id,
        name: agent.agent_name,
        type: agent.agent_type,
        emoji: agent.emoji,
        model: agent.model,
      })),
    },
  };
}

async function handleGetAgent(
  args: Record<string, unknown>,
  bucketSlug: string
): Promise<AIToolResult> {
  const agent = await api.getAgent(bucketSlug, args.id as string);

  return {
    success: true,
    data: {
      id: agent.id,
      name: agent.agent_name,
      type: agent.agent_type,
      prompt: agent.prompt,
      model: agent.model,
    },
  };
}

async function handleRunAgent(
  args: Record<string, unknown>,
  bucketSlug: string
): Promise<AIToolResult> {
  const execution = await api.runAgent(bucketSlug, args.id as string, {
    prompt: args.prompt as string,
  });

  return {
    success: true,
    data: {
      execution_id: execution.id,
      status: execution.status,
    },
  };
}

// ============================================================================
// AI Generation Handlers
// ============================================================================

async function handleGenerateText(
  args: Record<string, unknown>,
  bucketSlug: string
): Promise<AIToolResult> {
  const response = await api.generateText(bucketSlug, {
    prompt: args.prompt as string,
    max_tokens: args.max_tokens as number,
  });

  return {
    success: true,
    data: {
      text: response.text,
      usage: response.usage,
    },
  };
}

async function handleGenerateImage(
  args: Record<string, unknown>,
  bucketSlug: string
): Promise<AIToolResult> {
  const media = await api.generateImage(bucketSlug, args.prompt as string, {
    folder: args.folder as string,
    alt_text: args.alt_text as string,
  });

  return {
    success: true,
    data: {
      id: media.id,
      name: media.name,
      url: media.url,
      imgix_url: media.imgix_url,
    },
  };
}

export default { executeToolCall };
