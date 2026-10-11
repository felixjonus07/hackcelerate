/** The access registry and the route files must agree: no endpoint without a row, no row without an endpoint, no role list written inline. */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { ACCESS_MATRIX } from "../../consent/matrix";
import { ENDPOINTS, rolesOf } from "../access";

const ROOT = join(process.cwd(), "src/app/api/v1");
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : f === "route.ts" ? [p] : [];
  });
const routes = files(ROOT).map((f) => ({
  file: f,
  path: `/api/v1/${relative(ROOT, f)
    .replace(/\\/g, "/")
    .replace(/\/route\.ts$/, "")}`.replace(/\[(\w+)\]/g, "{$1}"),
  src: readFileSync(f, "utf8"),
}));
const methodsIn = (src: string) => [...src.matchAll(/export const (GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1]);

describe("API access registry", () => {
  it("lists every route file, with the methods it exports", () => {
    for (const r of routes) {
      const rows = ENDPOINTS.filter(
        (e) => e.path.replace(/\{(\w+)\}/g, (_, n) => `{${n}}`) === r.path || normalise(e.path) === normalise(r.path),
      );
      expect(rows.length, `no registry row for ${r.path}`).toBeGreaterThan(0);
      expect(rows.map((x) => x.method).sort(), r.path).toEqual(methodsIn(r.src).sort());
    }
  });

  it("has no row without a route", () => {
    const known = new Set(routes.map((r) => normalise(r.path)));
    for (const e of ENDPOINTS) expect(known.has(normalise(e.path)), e.path).toBe(true);
  });

  it("route handlers take their roles from the registry, never an inline list", () => {
    for (const r of routes.filter((x) => !x.file.replace(/\\/g, "/").includes("/students/me/"))) {
      const inline = r.src.match(/requireApiUser\((?!rolesOf\("[a-z-]+"\)\))[^)]*\)/);
      expect(inline, `${r.path}: ${inline?.[0]}`).toBeNull();
    }
  });

  it("every id used by a route exists", () => {
    for (const r of routes)
      for (const m of r.src.matchAll(/rolesOf\("([a-z-]+)"\)/g)) expect(() => rolesOf(m[1])).not.toThrow();
  });

  it("matches the roles in the access matrix: only the policy editor roles reach policy, only the auditor-side reach the audit report", () => {
    const policyViewers = Object.entries(ACCESS_MATRIX.policy_configuration)
      .filter(([, a]) => a !== "no")
      .map(([r]) => r)
      .sort();
    expect([...(rolesOf("policy-list") ?? [])].sort()).toEqual(
      ["auditor", "dean", "hod", "registrar"].filter((r) => policyViewers.includes(r)),
    );
    expect(rolesOf("policy-create")).toEqual(["registrar"]); // only the registrar edits (§13.1)
    expect(rolesOf("ingestion")).toEqual(["registrar"]);
    expect(rolesOf("audit-report")).not.toContain("registrar");
  });
});

/** `{id}`, `{v}` and `{category}` are all just placeholders. */
function normalise(p: string) {
  return p.replace(/\{\w+\}/g, "{}");
}
