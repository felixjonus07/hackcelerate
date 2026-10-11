import { describe, expect, it } from "vitest";
import { emailKey } from "../lockout";

describe("lockout key", () => {
  it("normalises case and whitespace so variants share one counter", () => {
    expect(emailKey(" Mentor@AspirEdge.example ")).toBe(emailKey("mentor@aspiredge.example"));
  });
  it("never stores the raw email", () => {
    expect(emailKey("mentor@aspiredge.example")).not.toContain("mentor");
    expect(emailKey("mentor@aspiredge.example")).toMatch(/^[0-9a-f]{32}$/);
  });
});
