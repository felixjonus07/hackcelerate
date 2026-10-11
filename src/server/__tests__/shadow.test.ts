/** Shadow mode (§16.2): outputs only for the project team, and nothing dispatched. */
import { describe, expect, it } from "vitest";
import { mayViewOutputs } from "../shadow";

describe("who may see outputs", () => {
  it("everyone allowed by their role, when shadow mode is off", () => {
    expect(mayViewOutputs({ email: "mentor@x.org" }, false)).toBe(true);
  });
  it("only the project team, when it is on", () => {
    expect(mayViewOutputs({ email: "mentor@x.org" }, true)).toBe(false);
  });
});
