import { describe, expect, it } from "bun:test";
import { AntigravityProvider } from "../../../src/providers/antigravity";
import { createUnifiedRequest, createUnifiedMessage } from "../_utils/fixtures";
import { isAntigravityProviderRequest } from "../../../src/formats/gemini/antigravity/types";

describe("AntigravityProvider Issue Fix (TDD)", () => {
  const provider = new AntigravityProvider();

  describe("transform()", () => {
    it("should NOT include userAgent and requestId in the request body", () => {
      const request = createUnifiedRequest({
        messages: [createUnifiedMessage("user", "Hello")],
        metadata: {
          project: "test-project",
          requestId: "custom-req-id"
        }
      });

      const result = provider.transform(request, 'gemini-3-pro-preview');
      if (!isAntigravityProviderRequest(result)) throw new Error('Expected AntigravityProviderRequest');
  
      // These fields should be in the wrapper, not in the inner request
      expect(result.userAgent).toBe("antigravity");
      expect(result.requestId).toBe("custom-req-id");
      
      // Project and model should still be there
      expect(result.project).toBe("test-project");
      expect(result.model).toBe("gemini-3-pro-preview");
      expect(result.request).toBeDefined();
    });
  });
});
