/**
 * Authorization matrix (§15.1: "zero failures"). Every `/api/v1` endpoint is called by every role and by a
 * signed-out client, against the real server. The expected roles come from the same registry the route
 * handlers read (`src/server/api/access.ts`), so a role added to a route without a registry row cannot slip by.
 *
 * Denied by role: 403 from the framework's forbidden interrupt (no JSON error body).
 * Allowed by role: never 401; a 403 is allowed only when it is the handler's own JSON answer about the record
 * (for example "not assigned to this student"), which proves the role check passed.
 */
import { type APIRequestContext, expect, request, test } from "@playwright/test";
import { ENDPOINTS } from "../src/server/api/access";
import { STAFF_ROLES } from "../src/server/auth/roles";
import type { Role } from "../src/server/db/schema/enums";
import { DEMO_PASSWORD } from "./helpers";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const ACCOUNTS: Record<Role, string> = {
  student: "student@aspiredge.example",
  faculty_mentor: "mentor@aspiredge.example",
  class_advisor: "advisor@aspiredge.example",
  placement_officer: "placement@aspiredge.example",
  ecell_coordinator: "ecell@aspiredge.example",
  hod: "hod@aspiredge.example",
  dean: "dean@aspiredge.example",
  registrar: "registrar@aspiredge.example",
  auditor: "auditor@aspiredge.example",
  sports_officer: "sports@aspiredge.example",
  alumni_mentor: "alumni@aspiredge.example",
};
const ROLES = ["student", ...STAFF_ROLES] as Role[];
const DUMMY = "00000000-0000-4000-8000-000000000000";

let ip = 0;
async function client(email?: string): Promise<APIRequestContext> {
  ip += 1;
  const ctx = await request.newContext({
    baseURL: BASE,
    extraHTTPHeaders: { origin: BASE, "x-forwarded-for": `10.88.${process.pid % 250}.${ip % 250}` },
  });
  if (email) {
    const r = await ctx.post("/api/auth/sign-in/email", { data: { email, password: DEMO_PASSWORD } });
    expect(r.ok(), `sign-in as ${email}`).toBe(true);
  }
  return ctx;
}

const urlFor = (path: string) => path.replace(/\{[^}]+\}/g, DUMMY);

async function call(ctx: APIRequestContext, e: (typeof ENDPOINTS)[number]) {
  const url = urlFor(e.path);
  const opts = { data: e.body, maxRedirects: 0, failOnStatusCode: false };
  if (e.method === "GET") return ctx.get(url, opts);
  if (e.method === "POST") return ctx.post(url, opts);
  if (e.method === "PUT") return ctx.put(url, opts);
  return ctx.patch(url, opts);
}

const isHandlerJson403 = async (r: Awaited<ReturnType<typeof call>>) => {
  try {
    return (await r.json())?.error?.code === "forbidden";
  } catch {
    return false;
  }
};

test.describe("authorization matrix", () => {
  test("every endpoint answers 401 to a signed-out client", async () => {
    const ctx = await client();
    for (const e of ENDPOINTS) {
      const r = await call(ctx, e);
      expect(r.status(), `${e.method} ${e.path} signed out`).toBe(401);
    }
    await ctx.dispose();
  });

  for (const role of ROLES) {
    test(`${role}: allowed endpoints pass the role check, the rest are 403`, async () => {
      const ctx = await client(ACCOUNTS[role]);
      const failures: string[] = [];
      for (const e of ENDPOINTS) {
        const allowed = e.roles === "any" || e.roles.includes(role);
        const r = await call(ctx, e);
        const s = r.status();
        if (allowed) {
          if (s === 401 || s >= 500) failures.push(`${e.method} ${e.path}: allowed role got ${s}`);
          else if (s === 403 && !(await isHandlerJson403(r)))
            failures.push(`${e.method} ${e.path}: allowed role was stopped by the role check`);
        } else if (s !== 403) failures.push(`${e.method} ${e.path}: denied role got ${s}, expected 403`);
        else if (await isHandlerJson403(r))
          failures.push(`${e.method} ${e.path}: denied role reached the handler (403 came from the record check)`);
      }
      await ctx.dispose();
      expect(failures, failures.join("\n")).toEqual([]);
    });
  }
});
