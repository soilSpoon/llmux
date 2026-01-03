import { describe, expect, test } from "bun:test";
import "../../../test/setup";
import {
	ensureThinkingSignatures,
	type UnifiedRequestBody,
} from "../signature-integration";

describe("Signature Integration - TDD (Gemini vs Claude)", () => {
	const TEST_SIGNATURE = "a".repeat(60);

	describe("Gemini Models", () => {
		test("should PRESERVE thinking blocks for Gemini models", () => {
			const sessionKey = "test-gemini-preserve";
			const requestBody: UnifiedRequestBody = {
				contents: [
					{
						role: "model",
						parts: [
							{
								thought: true,
								text: "Thinking...",
								thought_signature: TEST_SIGNATURE,
							},
							{ text: "Hello" },
						],
					},
				],
			};

			ensureThinkingSignatures(requestBody, sessionKey, "gemini-3-pro-high");

			const parts = requestBody.contents?.[0]?.parts as any[];
			expect(parts.some(p => p.thought === true)).toBe(true);
			expect(parts.find(p => p.thought === true)?.thought_signature).toBe(TEST_SIGNATURE);
		});

		test("should standardize on thought_signature (snake_case) for Gemini", () => {
			const sessionKey = "test-gemini-snake-case";
			const requestBody: UnifiedRequestBody = {
				contents: [
					{
						role: "model",
						parts: [
							{
								thought: true,
								text: "Thinking...",
								thoughtSignature: TEST_SIGNATURE, // camelCase input
							},
						],
					},
				],
			};

			ensureThinkingSignatures(requestBody, sessionKey, "gemini-3-pro-high");

			const parts = requestBody.contents?.[0]?.parts as any[];
			const thoughtPart = parts.find(p => p.thought === true);
			expect(thoughtPart).toBeDefined();
			expect(thoughtPart.thought_signature).toBe(TEST_SIGNATURE);
			// It's okay if thoughtSignature remains, but thought_signature MUST be there
		});

		test("should NOT strip signatures from tool_use parts for Gemini", () => {
			const sessionKey = "test-gemini-tool-signature";
			const requestBody: UnifiedRequestBody = {
				contents: [
					{
						role: "model",
						parts: [
							{
								thought: true,
								text: "Thinking...",
								thought_signature: TEST_SIGNATURE,
							},
							{
								type: "tool_use",
								id: "call-1",
								name: "bash",
								input: { cmd: "ls" },
								thought_signature: TEST_SIGNATURE,
							},
						],
					},
				],
			};

			ensureThinkingSignatures(requestBody, sessionKey, "gemini-3-pro-high");

			const parts = requestBody.contents?.[0]?.parts as any[];
			const toolPart = parts.find(p => p.type === "tool_use");
			expect(toolPart).toBeDefined();
			expect(toolPart.thought_signature).toBe(TEST_SIGNATURE);
		});
	});

	describe("Claude Models", () => {
		test("should STRIP thinking blocks for Claude models (existing strategy)", () => {
			const sessionKey = "test-claude-strip";
			const requestBody: UnifiedRequestBody = {
				contents: [
					{
						role: "model",
						parts: [
							{
								thought: true,
								text: "Thinking...",
								thoughtSignature: TEST_SIGNATURE,
							},
							{ text: "Hello" },
						],
					},
				],
			};

			ensureThinkingSignatures(requestBody, sessionKey, "claude-opus-4-5-thinking");

			const parts = requestBody.contents?.[0]?.parts as any[];
			expect(parts.some(p => p.thought === true)).toBe(false);
		});

		test("should strip residual signatures for Claude models", () => {
			const sessionKey = "test-claude-residual";
			const requestBody: UnifiedRequestBody = {
				contents: [
					{
						role: "model",
						parts: [
							{ text: "Hello", thoughtSignature: TEST_SIGNATURE },
						],
					},
				],
			};

			ensureThinkingSignatures(requestBody, sessionKey, "claude-opus-4-5-thinking");

			const parts = requestBody.contents?.[0]?.parts as any[];
			expect(parts[0].thoughtSignature).toBeUndefined();
			expect(parts[0].thought_signature).toBeUndefined();
		});
	});
});
