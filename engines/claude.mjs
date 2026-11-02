// The Claude engine: the Claude library's query, given the app's options as they are.
import { query } from '@anthropic-ai/claude-agent-sdk';

export function start({ options, input, canUseTool, stderr }) {
  return query({ prompt: input, options: { ...options, canUseTool, stderr } });
}
