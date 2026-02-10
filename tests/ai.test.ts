/**
 * Integration tests for AI operations via the Dashboard API.
 *
 * Prerequisites:
 *   - `cosmic login` has been run
 *   - `cosmic use` has navigated to a bucket
 */

import { describe, it, expect } from 'vitest';
import { SKIP_INTEGRATION, TEST_BUCKET_SLUG } from './setup.js';
import { listModels, generateText } from '../src/api/dashboard/ai.js';

describe('AI (Dashboard API)', () => {
  it.skipIf(SKIP_INTEGRATION)('should list available models', async () => {
    const models = await listModels(TEST_BUCKET_SLUG!);

    expect(Array.isArray(models)).toBe(true);
    expect(models.length).toBeGreaterThan(0);

    // Every model should have at least an id and name
    for (const model of models) {
      expect(model.id).toBeDefined();
      expect(model.name).toBeDefined();
    }
  });

  it.skipIf(SKIP_INTEGRATION)('should generate text', async () => {
    const response = await generateText(TEST_BUCKET_SLUG!, {
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'Reply with exactly: hello world' }],
        },
      ],
      max_tokens: 50,
    });

    expect(response).toBeDefined();

    // The /ai/chat endpoint returns a streamed response as a string
    // containing SSE data events with the generated text interleaved
    const raw = typeof response === 'string' ? response : JSON.stringify(response);
    expect(raw.length).toBeGreaterThan(0);
    // The text "hello world" should be present in the response
    expect(raw.toLowerCase()).toContain('hello world');
  });
});
