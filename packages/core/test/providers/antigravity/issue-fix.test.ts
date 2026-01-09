import { describe, expect, it } from "bun:test";
import { AntigravityProvider } from "../../../src/providers/antigravity";
import { createUnifiedRequest, createUnifiedMessage } from "../_utils/fixtures";

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

      const result = provider.transform(request, 'gemini-3-pro-preview') as any;
 
      // These fields SHOULD be at the top level of the AntigravityRequest
      expect(result.userAgent).toBe("antigravity");
      expect(result.requestId).toBe("custom-req-id");
      expect(result.requestType).toBe("agent");
      
      // Project and model should still be there as they are part of the envelope
      expect(result.project).toBe("test-project");
      expect(result.model).toBe("gemini-3-pro-preview");
      expect(result.request).toBeDefined();
    });
  });
});
