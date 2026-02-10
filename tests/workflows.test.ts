/**
 * Integration tests for Workflow CRUD operations via the Dashboard API.
 *
 * Prerequisites:
 *   - `cosmic login` has been run
 *   - `cosmic use` has navigated to a bucket
 */

import { describe, it, expect, afterAll } from 'vitest';
import { SKIP_INTEGRATION, TEST_BUCKET_SLUG } from './setup.js';
import {
  listWorkflows,
  getWorkflow,
  createWorkflow,
  updateWorkflow,
  deleteWorkflow,
} from '../src/api/dashboard/workflows.js';

// Track created workflow ID for cleanup
let createdWorkflowId: string | undefined;

/**
 * The API sometimes wraps the workflow in a { workflow: {...} } envelope.
 * This helper unwraps it if needed.
 */
function unwrap(response: any): any {
  return response?.workflow || response;
}

describe('Workflows (Dashboard API)', () => {
  afterAll(async () => {
    if (SKIP_INTEGRATION || !createdWorkflowId) return;
    try {
      await deleteWorkflow(TEST_BUCKET_SLUG!, createdWorkflowId);
    } catch {
      // Best-effort cleanup
    }
  });

  it.skipIf(SKIP_INTEGRATION)('should create a workflow', async () => {
    const response = await createWorkflow(TEST_BUCKET_SLUG!, {
      workflow_name: 'CLI Test Workflow',
      description: 'Created by integration test',
      emoji: '🧪',
      status: 'draft',
      schedule_type: 'manual',
      steps: [
        {
          agent_type: 'content',
          agent_name: 'Test Step',
          name: 'Test Step',
          prompt: 'This is a test step created by the CLI integration test suite.',
          step_number: 1,
        } as any,
      ],
    });

    const workflow = unwrap(response);
    expect(workflow).toBeDefined();
    expect(workflow.id).toBeDefined();
    expect(workflow.workflow_name).toBe('CLI Test Workflow');

    createdWorkflowId = workflow.id;
  });

  it.skipIf(SKIP_INTEGRATION)('should list workflows and include the created one', async () => {
    expect(createdWorkflowId).toBeDefined();

    const workflows = await listWorkflows(TEST_BUCKET_SLUG!);

    expect(Array.isArray(workflows)).toBe(true);
    const found = workflows.find((w) => w.id === createdWorkflowId);
    expect(found).toBeDefined();
    expect(found!.workflow_name).toBe('CLI Test Workflow');
  });

  it.skipIf(SKIP_INTEGRATION)('should get a single workflow by id', async () => {
    expect(createdWorkflowId).toBeDefined();

    const response = await getWorkflow(TEST_BUCKET_SLUG!, createdWorkflowId!);
    const workflow = unwrap(response);

    expect(workflow).toBeDefined();
    expect(workflow.id).toBe(createdWorkflowId);
    expect(workflow.workflow_name).toBe('CLI Test Workflow');
    expect(workflow.steps).toBeDefined();
    expect(workflow.steps.length).toBe(1);
  });

  it.skipIf(SKIP_INTEGRATION)('should update a workflow', async () => {
    expect(createdWorkflowId).toBeDefined();

    const response = await updateWorkflow(
      TEST_BUCKET_SLUG!,
      createdWorkflowId!,
      {
        description: 'Updated by integration test',
        emoji: '✅',
      }
    );

    const workflow = unwrap(response);
    expect(workflow).toBeDefined();
    expect(workflow.workflow_name).toBe('CLI Test Workflow');
  });

  it.skipIf(SKIP_INTEGRATION)('should delete a workflow', async () => {
    expect(createdWorkflowId).toBeDefined();

    // Should not throw
    await deleteWorkflow(TEST_BUCKET_SLUG!, createdWorkflowId!);

    // Verify it's gone
    const workflows = await listWorkflows(TEST_BUCKET_SLUG!);
    const found = workflows.find((w) => w.id === createdWorkflowId);
    expect(found).toBeUndefined();

    // Clear so afterAll doesn't try again
    createdWorkflowId = undefined;
  });
});
