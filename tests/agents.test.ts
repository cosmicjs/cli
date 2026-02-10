/**
 * Integration tests for Agent operations via the Dashboard API.
 * Read-only: lists and gets agents without triggering executions.
 *
 * Prerequisites:
 *   - `cosmic login` has been run
 *   - `cosmic use` has navigated to a bucket
 */

import { describe, it, expect } from 'vitest';
import { SKIP_INTEGRATION, TEST_BUCKET_SLUG } from './setup.js';
import { listAgents, getAgent } from '../src/api/dashboard/agents.js';

describe('Agents (Dashboard API)', () => {
  let firstAgentId: string | undefined;

  it.skipIf(SKIP_INTEGRATION)('should list agents', async () => {
    const agents = await listAgents(TEST_BUCKET_SLUG!);

    expect(Array.isArray(agents)).toBe(true);

    // If there are agents, verify they have expected fields
    if (agents.length > 0) {
      const agent = agents[0];
      expect(agent.id).toBeDefined();
      expect(agent.agent_name).toBeDefined();
      expect(agent.agent_type).toBeDefined();
      firstAgentId = agent.id;
    }
  });

  it.skipIf(SKIP_INTEGRATION)('should get a single agent by id', async () => {
    if (!firstAgentId) {
      // No agents in bucket -- skip gracefully
      return;
    }

    const agent = await getAgent(TEST_BUCKET_SLUG!, firstAgentId);

    expect(agent).toBeDefined();
    expect(agent.id).toBe(firstAgentId);
    expect(agent.agent_name).toBeDefined();
    expect(agent.agent_type).toBeDefined();
    expect(agent.prompt).toBeDefined();
  });
});
