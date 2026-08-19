import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { describeError, consumeLastCapturedError } from "./error-capture";

describe("error capture utility", () => {
  describe("describeError", () => {
    it("should format simple string errors", () => {
      expect(describeError("Plain string error")).toBe("Plain string error");
    });

    it("should format normal Error objects with stack trace", () => {
      const err = new Error("Standard error");
      const desc = describeError(err);
      expect(desc).toContain("Error: Standard error");
    });

    it("should format nested errors with cause chains", () => {
      const cause = new Error("Root cause");
      const err = new Error("Wrapper error", { cause });
      const desc = describeError(err);
      expect(desc).toContain("Wrapper error");
      expect(desc).toContain("caused by: Error: Root cause");
    });

    it("should describe custom status fields on error", () => {
      const err = new Error("Not Found") as Error & { status?: number };
      err.status = 404;
      const desc = describeError(err);
      expect(desc).toContain("status 404");
    });
  });

  describe("consumeLastCapturedError", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should capture and consume console.error errors", () => {
      // Trigger a captured error by logging an error
      const mockErr = new Error("Test captured error");
      console.error(mockErr);

      const consumed = consumeLastCapturedError();
      expect(consumed).toBe(mockErr);

      // Once consumed, it should return undefined
      expect(consumeLastCapturedError()).toBeUndefined();
    });

    it("should expire captured error after TTL (5000ms)", () => {
      const mockErr = new Error("Expired error");
      console.error(mockErr);

      // Fast-forward time by 5001ms
      vi.advanceTimersByTime(5001);

      const consumed = consumeLastCapturedError();
      expect(consumed).toBeUndefined();
    });
  });
});
