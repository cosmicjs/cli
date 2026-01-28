/**
 * AI Tool Definitions
 * Tools available for the AI to call during chat
 */

import type { AITool } from '../types.js';

/**
 * Get all tool definitions for the AI
 */
export function getToolDefinitions(): AITool[] {
  return [
    // Object tools
    {
      name: 'list_objects',
      description: 'List content objects in the current bucket. Use this to show posts, pages, or any content type.',
      parameters: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            description: 'The object type slug to filter by (e.g., "posts", "pages")',
          },
          status: {
            type: 'string',
            enum: ['published', 'draft', 'any'],
            description: 'Filter by status',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of objects to return (default: 10)',
          },
        },
      },
    },
    {
      name: 'get_object',
      description: 'Get details of a specific object by ID',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'The object ID',
          },
        },
        required: ['id'],
      },
    },
    {
      name: 'create_object',
      description: 'Create a new content object',
      parameters: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            description: 'The object type slug (e.g., "posts")',
          },
          title: {
            type: 'string',
            description: 'The object title',
          },
          content: {
            type: 'string',
            description: 'The object content (markdown or HTML)',
          },
          status: {
            type: 'string',
            enum: ['published', 'draft'],
            description: 'The object status',
          },
          metadata: {
            type: 'object',
            description: 'Additional metadata fields',
          },
        },
        required: ['type', 'title'],
      },
    },
    {
      name: 'update_object',
      description: 'Update an existing object',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'The object ID to update',
          },
          title: {
            type: 'string',
            description: 'New title',
          },
          content: {
            type: 'string',
            description: 'New content',
          },
          status: {
            type: 'string',
            enum: ['published', 'draft'],
            description: 'New status',
          },
          metadata: {
            type: 'object',
            description: 'Updated metadata fields',
          },
        },
        required: ['id'],
      },
    },
    {
      name: 'delete_objects',
      description: 'Delete one or more objects by ID',
      parameters: {
        type: 'object',
        properties: {
          ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of object IDs to delete',
          },
        },
        required: ['ids'],
      },
    },
    {
      name: 'publish_objects',
      description: 'Publish one or more draft objects',
      parameters: {
        type: 'object',
        properties: {
          ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of object IDs to publish',
          },
        },
        required: ['ids'],
      },
    },
    {
      name: 'unpublish_objects',
      description: 'Unpublish one or more published objects (move to draft)',
      parameters: {
        type: 'object',
        properties: {
          ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of object IDs to unpublish',
          },
        },
        required: ['ids'],
      },
    },
    {
      name: 'list_object_types',
      description: 'List all object types (content types) in the bucket',
      parameters: {
        type: 'object',
        properties: {},
      },
    },

    // Media tools
    {
      name: 'list_media',
      description: 'List media files in the bucket',
      parameters: {
        type: 'object',
        properties: {
          folder: {
            type: 'string',
            description: 'Filter by folder name',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of files to return',
          },
        },
      },
    },
    {
      name: 'get_media',
      description: 'Get details of a specific media file',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'The media ID',
          },
        },
        required: ['id'],
      },
    },
    {
      name: 'delete_media',
      description: 'Delete media files by ID',
      parameters: {
        type: 'object',
        properties: {
          ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of media IDs to delete',
          },
        },
        required: ['ids'],
      },
    },

    // Workflow tools
    {
      name: 'list_workflows',
      description: 'List AI workflows in the bucket',
      parameters: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['active', 'draft', 'paused'],
            description: 'Filter by status',
          },
        },
      },
    },
    {
      name: 'get_workflow',
      description: 'Get details of a specific workflow',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'The workflow ID',
          },
        },
        required: ['id'],
      },
    },
    {
      name: 'execute_workflow',
      description: 'Execute a workflow',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'The workflow ID to execute',
          },
          inputs: {
            type: 'object',
            description: 'User input values for the workflow',
          },
        },
        required: ['id'],
      },
    },
    {
      name: 'list_executions',
      description: 'List workflow executions',
      parameters: {
        type: 'object',
        properties: {
          workflow_id: {
            type: 'string',
            description: 'Filter by workflow ID',
          },
          status: {
            type: 'string',
            description: 'Filter by status',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of executions to return',
          },
        },
      },
    },

    // Agent tools
    {
      name: 'list_agents',
      description: 'List AI agents in the bucket',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'get_agent',
      description: 'Get details of a specific agent',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'The agent ID',
          },
        },
        required: ['id'],
      },
    },
    {
      name: 'run_agent',
      description: 'Run an AI agent',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'The agent ID to run',
          },
          prompt: {
            type: 'string',
            description: 'Optional prompt override',
          },
        },
        required: ['id'],
      },
    },

    // AI generation tools
    {
      name: 'generate_text',
      description: 'Generate text using AI',
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'The prompt for text generation',
          },
          max_tokens: {
            type: 'number',
            description: 'Maximum tokens to generate',
          },
        },
        required: ['prompt'],
      },
    },
    {
      name: 'generate_image',
      description: 'Generate an image using AI and save to media library',
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'The prompt describing the image to generate',
          },
          folder: {
            type: 'string',
            description: 'Folder to save the image in',
          },
          alt_text: {
            type: 'string',
            description: 'Alt text for the image',
          },
        },
        required: ['prompt'],
      },
    },
  ];
}

export { executeToolCall } from './handlers.js';

export default { getToolDefinitions };
