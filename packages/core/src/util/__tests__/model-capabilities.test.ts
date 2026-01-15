import { describe, expect, it, beforeEach, afterAll } from "bun:test";
import {
  extractThinkingTier,
  hasThinkingTierSuffix,
  isGemini3WithTierSuffix,
  isZeroCostModel,
  normalizeReasoningEffort,
  supportsThinking,
  ZERO_COST_MODELS,
} from "../model-capabilities";

describe("model-capabilities", () => {
  describe("hasThinkingTierSuffix", () => {
    it("should return true for models with tier suffixes", () => {
      expect(hasThinkingTierSuffix("model-high")).toBe(true);
      expect(hasThinkingTierSuffix("model-medium")).toBe(true);
      expect(hasThinkingTierSuffix("model-low")).toBe(true);
    });

    it("should return false for models without tier suffixes", () => {
      expect(hasThinkingTierSuffix("model")).toBe(false);
      expect(hasThinkingTierSuffix("model-other")).toBe(false);
    });
  });

  describe("isGemini3WithTierSuffix", () => {
    it("should return true for Gemini 3 with tier suffix", () => {
      expect(isGemini3WithTierSuffix("gemini-3-pro-high")).toBe(true);
      expect(isGemini3WithTierSuffix("gemini-3-flash-medium")).toBe(true);
    });

    it("should return false for non-Gemini or no tier suffix", () => {
      expect(isGemini3WithTierSuffix("gemini-3-pro")).toBe(false);
      expect(isGemini3WithTierSuffix("gpt-4-high")).toBe(false);
    });
  });

  describe("extractThinkingTier", () => {
    it("should extract tier from model name", () => {
      expect(extractThinkingTier("model-high")).toBe("high");
      expect(extractThinkingTier("model-medium")).toBe("medium");
      expect(extractThinkingTier("model-low")).toBe("low");
    });

    it("should return undefined for no tier suffix", () => {
      expect(extractThinkingTier("model")).toBeUndefined();
      expect(extractThinkingTier("model-other")).toBeUndefined();
    });
  });

  describe("supportsThinking", () => {
    it("should return false for Gemini 3 with tier suffix", () => {
      expect(supportsThinking("gemini-3-pro-high")).toBe(false);
    });

    it("should return true for Claude thinking models", () => {
      expect(supportsThinking("claude-opus-thinking", true, true)).toBe(true);
    });

    it("should return true for Gemini 3 without tier suffix", () => {
      expect(supportsThinking("gemini-3-pro")).toBe(true);
    });
  });

  describe("normalizeReasoningEffort", () => {
    describe("undefined effort", () => {
      it("should return undefined when effort is undefined", () => {
        expect(normalizeReasoningEffort("gpt-5.1")).toBeUndefined();
        expect(normalizeReasoningEffort("gpt-5-pro")).toBeUndefined();
        expect(normalizeReasoningEffort("unknown-model")).toBeUndefined();
      });
    });

    describe("gpt-5.1 models", () => {
      it("should support none, low, medium, high", () => {
        expect(normalizeReasoningEffort("gpt-5.1", "none")).toBe("none");
        expect(normalizeReasoningEffort("gpt-5.1", "low")).toBe("low");
        expect(normalizeReasoningEffort("gpt-5.1", "medium")).toBe("medium");
        expect(normalizeReasoningEffort("gpt-5.1", "high")).toBe("high");
      });

      it("should fallback to undefined for unsupported values", () => {
        expect(normalizeReasoningEffort("gpt-5.1", "minimal")).toBeUndefined();
        expect(normalizeReasoningEffort("gpt-5.1", "xhigh")).toBeUndefined();
      });

      it("should fallback to undefined for invalid values", () => {
        expect(normalizeReasoningEffort("gpt-5.1", "invalid")).toBeUndefined();
        expect(normalizeReasoningEffort("gpt-5.1", "")).toBeUndefined();
      });

      it("should work with gpt-5.1 variants", () => {
        expect(normalizeReasoningEffort("gpt-5.1-turbo", "high")).toBe("high");
        expect(normalizeReasoningEffort("gpt-5.1-mini", "low")).toBe("low");
      });
    });

    describe("gpt-5-pro models", () => {
      it("should only support high", () => {
        expect(normalizeReasoningEffort("gpt-5-pro", "high")).toBe("high");
      });

      it("should fallback to high for unsupported values", () => {
        expect(normalizeReasoningEffort("gpt-5-pro", "low")).toBe("high");
        expect(normalizeReasoningEffort("gpt-5-pro", "medium")).toBe("high");
        expect(normalizeReasoningEffort("gpt-5-pro", "none")).toBe("high");
        expect(normalizeReasoningEffort("gpt-5-pro", "minimal")).toBe("high");
        expect(normalizeReasoningEffort("gpt-5-pro", "xhigh")).toBe("high");
      });

      it("should work with gpt-5-pro variants", () => {
        expect(normalizeReasoningEffort("gpt-5-pro-128k", "low")).toBe("high");
      });
    });

    describe("gpt-5.1-codex-max models", () => {
      it("should support all effort levels", () => {
        expect(normalizeReasoningEffort("gpt-5.1-codex-max", "none")).toBe("none");
        expect(normalizeReasoningEffort("gpt-5.1-codex-max", "minimal")).toBe("minimal");
        expect(normalizeReasoningEffort("gpt-5.1-codex-max", "low")).toBe("low");
        expect(normalizeReasoningEffort("gpt-5.1-codex-max", "medium")).toBe("medium");
        expect(normalizeReasoningEffort("gpt-5.1-codex-max", "high")).toBe("high");
        expect(normalizeReasoningEffort("gpt-5.1-codex-max", "xhigh")).toBe("xhigh");
      });

      it("should work with codex-max variants", () => {
        expect(normalizeReasoningEffort("gpt-5.1-codex-max-128k", "xhigh")).toBe("xhigh");
        expect(normalizeReasoningEffort("gpt-5.1-codex-max-plus", "minimal")).toBe("minimal");
      });

      it("should fallback to undefined for invalid values", () => {
        expect(normalizeReasoningEffort("gpt-5.1-codex-max", "invalid")).toBeUndefined();
      });
    });

    describe("unknown models", () => {
      it("should support low, medium, high for unknown models", () => {
        expect(normalizeReasoningEffort("unknown-model", "low")).toBe("low");
        expect(normalizeReasoningEffort("unknown-model", "medium")).toBe("medium");
        expect(normalizeReasoningEffort("unknown-model", "high")).toBe("high");
      });

      it("should fallback to undefined for unsupported values", () => {
        expect(normalizeReasoningEffort("unknown-model", "none")).toBeUndefined();
        expect(normalizeReasoningEffort("unknown-model", "minimal")).toBeUndefined();
        expect(normalizeReasoningEffort("unknown-model", "xhigh")).toBeUndefined();
      });
    });
  });

  describe("isZeroCostModel", () => {
    // Save original state
    const originalModels = [...ZERO_COST_MODELS];

    beforeEach(() => {
      ZERO_COST_MODELS.length = 0;
    });

    afterAll(() => {
      // Restore original state
      ZERO_COST_MODELS.length = 0;
      ZERO_COST_MODELS.push(...originalModels);
    });

    it("should return false for non-zero cost models", () => {
      expect(isZeroCostModel("gpt-4")).toBe(false);
      expect(isZeroCostModel("claude-3")).toBe(false);
    });

    it("should return true for zero cost models", () => {
      ZERO_COST_MODELS.push("internal-model-free");
      expect(isZeroCostModel("internal-model-free")).toBe(true);
    });

    it("should handle multiple zero cost models", () => {
      ZERO_COST_MODELS.push("model-a", "model-b");
      expect(isZeroCostModel("model-a")).toBe(true);
      expect(isZeroCostModel("model-b")).toBe(true);
      expect(isZeroCostModel("model-c")).toBe(false);
    });
  });
});
