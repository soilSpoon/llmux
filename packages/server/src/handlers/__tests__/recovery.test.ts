import { describe, it, expect } from 'bun:test';
import { detectRecoverableError, injectSyntheticToolResult } from '../recovery-handler';

describe('Session Recovery', () => {
  describe('detectRecoverableError', () => {
    it('should detect tool_result_missing error', () => {
      const error = {
        message: 'tool_use block must be followed by a tool_result block',
        status: 400
      };

      const result = detectRecoverableError(error);
      expect(result).toBe('tool_result_missing');
    });

    it('should detect thinking_block_order error', () => {
      const error = {
        message: 'thinking content must start with first block',
        status: 400
      };

      const result = detectRecoverableError(error);
      expect(result).toBe('thinking_block_order');
    });

    it('should return null for non-recoverable errors', () => {
      const error = {
        message: 'Internal server error',
        status: 500
      };

      const result = detectRecoverableError(error);
      expect(result).toBeNull();
    });
  });

  describe('injectSyntheticToolResult', () => {
    it('should create synthetic tool_result for missing tool responses', () => {
      const toolUseIds = ['tool_call_123', 'tool_call_456'];
      
      const syntheticResults = injectSyntheticToolResult(toolUseIds);
      
      expect(syntheticResults).toHaveLength(2);
      expect(syntheticResults[0]!.type).toBe('tool_result');
      expect(syntheticResults[0]!.tool_use_id).toBe('tool_call_123');
      expect(syntheticResults[0]!.content).toContain('cancelled');
      
      expect(syntheticResults[1]!.type).toBe('tool_result');
      expect(syntheticResults[1]!.tool_use_id).toBe('tool_call_456');
    });

    it('should return empty array for empty tool use ids', () => {
      const syntheticResults = injectSyntheticToolResult([]);
      expect(syntheticResults).toHaveLength(0);
    });
  });
});
