/**
 * Shared Route Handler wrapper for /api/v1 (§11): consistent JSON errors,
 * Zod validation errors → 400, access denials → 403. Next.js auth interrupts
 * (unauthorized/forbidden) are rethrown so the framework handles them.
 */
import "server-only";
import { unstable_rethrow } from "next/navigation";
import { ZodError } from "zod";
import { logger } from "../logger";
import { AccessDenied } from "../services/students";

export function json(data: unknown, init?: ResponseInit) {
  return Response.json(data, init);
}

export function apiError(status: number, code: string, message: string) {
  return Response.json({ error: { code, message } }, { status });
}

export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (err) {
      unstable_rethrow(err);
      if (err instanceof ZodError)
        return apiError(400, "invalid_request", err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
      if (err instanceof AccessDenied) return apiError(403, "forbidden", err.message);
      logger.error({ err: String(err) }, "api error");
      return apiError(500, "internal_error", "Something went wrong");
    }
  };
}
