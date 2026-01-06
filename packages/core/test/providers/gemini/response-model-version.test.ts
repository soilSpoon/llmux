import { describe, expect, it } from "bun:test";
import {
  parseResponse,
  transformResponse,
} from "../../../src/providers/gemini/response";
import type { GeminiResponse } from "../../../src/providers/gemini/types";
import { createUnifiedResponse } from "../_utils/fixtures";

describe("Gemini Response - Model Version", () => {
  describe("parseResponse", () => {
    it("should map modelVersion to model", () => {
      const gemini: GeminiResponse = {
        candidates: [
          {
            content: { role: "model", parts: [{ text: "Hi" }] },
            finishReason: "STOP",
          },
        ],
        modelVersion: "gemini-1.5-pro",
      };

      const result = parseResponse(gemini);
      expect(result.model).toBe("gemini-1.5-pro");
    });
  });

  describe("transformResponse", () => {
    it("should map model to modelVersion", () => {
      const unified = createUnifiedResponse({
        model: "gemini-1.5-pro",
      });

      const result = transformResponse(unified);
      expect(result.modelVersion).toBe("gemini-1.5-pro");
    });
  });
});
