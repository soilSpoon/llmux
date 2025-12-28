import { describe, expect, it } from "bun:test";
import { normalizeBashArguments } from "../../src/handlers/bash-normalization";

describe("normalizeBashArguments", () => {
  describe("when tool is not Bash", () => {
    it("should return args unchanged for other tools", () => {
      const args = { cmd: "git status" };
      const result = normalizeBashArguments("ReadFile", args);
      expect(result).toEqual({ cmd: "git status" });
      expect(result).not.toHaveProperty("command");
    });
  });

  describe("when tool is Bash", () => {
    it("should normalize cmd to command (case-insensitive tool name)", () => {
      const args = { cmd: "git diff", cwd: "/home/user" };
      const result = normalizeBashArguments("Bash", args);
      expect(result.command).toBe("git diff");
      expect(result.cmd).toBe("git diff");
      expect(result.cwd).toBe("/home/user");
    });

    it("should normalize cmd to command for lowercase bash", () => {
      const args = { cmd: "ls -la" };
      const result = normalizeBashArguments("bash", args);
      expect(result.command).toBe("ls -la");
    });

    it("should normalize code to command when cmd is absent", () => {
      const args = { code: "echo hello", timeout: 5000 };
      const result = normalizeBashArguments("Bash", args);
      expect(result.command).toBe("echo hello");
      expect(result.code).toBe("echo hello");
    });

    it("should prefer cmd over code when both are present", () => {
      const args = { cmd: "git status", code: "echo wrong" };
      const result = normalizeBashArguments("Bash", args);
      expect(result.command).toBe("git status");
    });

    it("should not overwrite existing command", () => {
      const args = { command: "original", cmd: "should not be used" };
      const result = normalizeBashArguments("Bash", args);
      expect(result.command).toBe("original");
    });

    it("should return args unchanged when no normalization is needed", () => {
      const args = { command: "git push" };
      const result = normalizeBashArguments("Bash", args);
      expect(result).toEqual({ command: "git push" });
    });

    it("should handle empty args object", () => {
      const args = {};
      const result = normalizeBashArguments("Bash", args);
      expect(result).toEqual({});
      expect(result).not.toHaveProperty("command");
    });

    it("should not mutate the original args object", () => {
      const original = { cmd: "git log" };
      const result = normalizeBashArguments("Bash", original);
      expect(original).not.toHaveProperty("command");
      expect(result.command).toBe("git log");
    });
  });
});
