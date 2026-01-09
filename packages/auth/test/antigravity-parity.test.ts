import { describe, expect, test, afterEach, mock } from "bun:test";
import type { OAuthCredential } from "../src/types";

const originalFetch = global.fetch;

function createMockFetch(
  handler: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>
) {
  return mock(handler) as unknown as typeof fetch;
}

describe("Antigravity Parity Features", () => {
    afterEach(() => {
        global.fetch = originalFetch;
        mock.restore();
    });

    test("onboardManagedProject calls /v1internal:onboardUser with valid payload", async () => {
        let capturedBody: any;
        global.fetch = createMockFetch(async (url, options) => {
            if (url.toString().includes("onboardUser")) {
                capturedBody = JSON.parse(options?.body as string);
                return new Response(JSON.stringify({ done: true, response: { cloudaicompanionProject: { id: "onboarded-project" } } }), { status: 200 });
            }
            return new Response("Not Found", { status: 404 });
        });

        const { onboardManagedProject } = await import("../src/providers/antigravity-oauth");

        const result = await onboardManagedProject("access_token", "PAID", "my-project");
        
        expect(result).toBe("onboarded-project");
        expect(capturedBody).toBeDefined();
        expect(capturedBody.tierId).toBe("PAID");
        expect(capturedBody.cloudaicompanionProject).toBe("my-project");
    });

    test("Project Context Caching prevents duplicate API calls", async () => {
        let callCount = 0;
        global.fetch = createMockFetch(async (url, _options) => {
            if (url.toString().includes("loadCodeAssist")) {
                callCount++;
                return new Response(JSON.stringify({ cloudaicompanionProject: "cached-project" }), { status: 200 });
            }
            return new Response("Not Found", { status: 404 });
        });

        const { fetchAntigravityProjectID } = await import("../src/providers/antigravity-oauth");
        
        // First call
        const id1 = await fetchAntigravityProjectID("token_1");
        expect(id1).toBe("cached-project");

        const id2 = await fetchAntigravityProjectID("token_1");
        expect(id2).toBe("cached-project");
        
        expect(callCount).toBe(1); 
    });

    test("Refresh Token handles 3 parts including managedProjectId", async () => {
        global.fetch = createMockFetch(async (url) => {
             if (url.toString().includes("oauth2.googleapis.com/token")) {
                 return new Response(JSON.stringify({ access_token: "new_access", expires_in: 3600 }), { status: 200 });
             }
             return new Response("{}", { status: 200 });
        });

        const { refreshAntigravityToken } = await import("../src/providers/antigravity-oauth");
        
        const credential: OAuthCredential = {
            type: "oauth",
            accessToken: "old",
            refreshToken: "refresh_token|project_id|managed_project_id",
            expiresAt: Date.now()
        };

        const result = await refreshAntigravityToken(credential);

        // Expect it to split correctly and verify managed project id preservation
        expect(result.accessToken).toBe("new_access");
        expect(result.refreshToken).toBe("refresh_token|project_id|managed_project_id");
    });

    test("Metadata includes duetProject when project ID is available", async () => {
        let capturedBody: any;
        global.fetch = createMockFetch(async (url, options) => {
            if (url.toString().includes("loadCodeAssist")) {
                capturedBody = JSON.parse(options?.body as string);
                return new Response(JSON.stringify({ cloudaicompanionProject: "proj" }), { status: 200 });
            }
            return new Response("{}", { status: 200 });
        });

        const { loadManagedProject } = await import("../src/providers/antigravity-oauth");
        
        await loadManagedProject("token", "my-duet-project");

        expect(capturedBody.metadata.duetProject).toBe("my-duet-project");
    });
});
