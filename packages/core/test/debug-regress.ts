
import { transform } from "../src/providers/antigravity/request";

// Mock fixtures helpers since we can't import them easily if they are not exported or path is annoying
// Actually we can import from relative path if we place this file in test/
// The command cwd is packages/core

const unifiedRequest = {
  messages: [
    {
      role: "tool",
      parts: [
        {
          type: "tool_result",
          toolResult: {
            toolCallId: "call-123",
            content: '{"temp": 72}',
          },
        },
      ],
    },
  ],
  // other required fields
  system: undefined,
  tools: undefined,
  config: undefined,
  thinking: undefined,
  metadata: undefined
};

console.log("Running debug transformation...");
try {
    const result = transform(unifiedRequest as any, 'gemini-2.0-flash');
    console.log("Result content part[0]:", JSON.stringify(result.request.contents![0]!.parts[0], null, 2));
} catch (e) {
    console.error("Error:", e);
}
