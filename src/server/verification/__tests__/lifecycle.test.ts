/**
 * Tests for the evidence lifecycle (§6.1).
 * Uses a mock transaction layer to test the authoritative transition function
 * without a live database.
 */
import { describe, expect, it } from "vitest";
import type { VerificationStatus } from "../../policy/schema";
import { VERIFICATION_STATUSES } from "../../policy/schema";
import { canTransition, LifecycleError, TRANSITIONS, type TransitionDeps, transitionArtifact } from "../lifecycle";

/* ──────────────── Mock DB for testing ──────────────── */

interface MockArtifact {
  id: string;
  status: VerificationStatus;
  verifiedAt: Date | null;
}

interface MockEvent {
  id: string;
  artifactId: string;
  fromStatus: VerificationStatus | null;
  toStatus: VerificationStatus;
  actorUserId: string | null;
  actorKind: string;
  reason: string;
}

function _createMockDeps(artifacts: MockArtifact[]): {
  deps: TransitionDeps;
  getArtifact: (id: string) => MockArtifact | undefined;
  getEvents: () => MockEvent[];
} {
  const store = new Map(artifacts.map((a) => [a.id, { ...a }]));
  const events: MockEvent[] = [];
  let eventCounter = 0;
  let locked = new Set<string>();

  const deps: TransitionDeps = {
    db: {
      async transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
        const tx = {
          select() {
            return {
              from() {
                return {
                  where(condition: unknown) {
                    return {
                      for() {
                        return {
                          limit(_n: number) {
                            // Parse the condition to find the artifact ID
                            // In our mock, we pass the condition through
                            const allArtifacts = Array.from(store.values());
                            // The condition is opaque; we use a hack to extract the ID
                            const condStr = String(condition);
                            const found = allArtifacts.find((a) => condStr.includes(a.id));
                            if (found && locked.has(found.id)) {
                              throw new Error("Row already locked (concurrent access)");
                            }
                            if (found) locked.add(found.id);
                            return found ? [found] : [];
                          },
                        };
                      },
                    };
                  },
                };
              },
            };
          },
          update() {
            return {
              set(values: Partial<MockArtifact>) {
                return {
                  where(condition: unknown) {
                    return {
                      returning(_cols: unknown) {
                        // Find matching artifact and apply update
                        const condStr = String(condition);
                        for (const [id, art] of store) {
                          if (condStr.includes(id) && condStr.includes(art.status)) {
                            if (values.status) art.status = values.status as VerificationStatus;
                            if (values.verifiedAt !== undefined) art.verifiedAt = values.verifiedAt as Date | null;
                            return [{ id }];
                          }
                        }
                        return []; // Concurrency failure
                      },
                    };
                  },
                };
              },
            };
          },
          insert() {
            return {
              values(vals: Omit<MockEvent, "id">) {
                return {
                  returning(_cols: unknown) {
                    const id = `evt-${++eventCounter}`;
                    events.push({ id, ...vals } as MockEvent);
                    return [{ id }];
                  },
                };
              },
            };
          },
        };

        try {
          return await fn(tx);
        } finally {
          locked = new Set<string>();
        }
      },
    },
    // Mock table references — the actual column access is handled by our mock tx
    artifacts: {
      id: { name: "id" },
      status: { name: "status" },
    } as unknown as TransitionDeps["artifacts"],
    artifactStatusEvents: {
      id: { name: "id" },
    } as unknown as TransitionDeps["artifactStatusEvents"],
  };

  return {
    deps,
    getArtifact: (id) => store.get(id),
    getEvents: () => [...events],
  };
}

/* ────────── Simple mock deps that work with string matching ────────── */

function _simpleMockDeps(initial: { id: string; status: VerificationStatus }[]) {
  const artifacts = initial.map((a) => ({
    id: a.id,
    status: a.status,
    verifiedAt: null as Date | null,
  }));
  const events: MockEvent[] = [];
  let eventCounter = 0;

  const deps: TransitionDeps = {
    db: {
      async transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
        const tx = {
          select() {
            return {
              from() {
                return {
                  where() {
                    return {
                      for() {
                        return {
                          limit() {
                            // Will be overridden per-test
                            return [];
                          },
                        };
                      },
                    };
                  },
                };
              },
            };
          },
          update() {
            return {
              set() {
                return {
                  where() {
                    return {
                      returning() {
                        return [];
                      },
                    };
                  },
                };
              },
            };
          },
          insert() {
            return {
              values(vals: Omit<MockEvent, "id">) {
                return {
                  returning() {
                    const id = `evt-${++eventCounter}`;
                    events.push({ id, ...vals } as MockEvent);
                    return [{ id }];
                  },
                };
              },
            };
          },
        };
        return fn(tx);
      },
    },
    artifacts: {} as TransitionDeps["artifacts"],
    artifactStatusEvents: {} as TransitionDeps["artifactStatusEvents"],
  };

  return { deps, artifacts, events };
}

/* ────────────────── Tests ────────────────── */

describe("§6.1 Transition table", () => {
  it("allows all specified transitions", () => {
    // SUBMITTED → UNDER_CHECK
    expect(canTransition("SUBMITTED", "UNDER_CHECK")).toBe(true);
    // UNDER_CHECK → VERIFIED, LIVE_UNVERIFIED, SELF_REPORTED, UNVERIFIED, ATTESTED, REJECTED
    expect(canTransition("UNDER_CHECK", "VERIFIED")).toBe(true);
    expect(canTransition("UNDER_CHECK", "LIVE_UNVERIFIED")).toBe(true);
    expect(canTransition("UNDER_CHECK", "SELF_REPORTED")).toBe(true);
    expect(canTransition("UNDER_CHECK", "UNVERIFIED")).toBe(true);
    expect(canTransition("UNDER_CHECK", "ATTESTED")).toBe(true);
    expect(canTransition("UNDER_CHECK", "REJECTED")).toBe(true);
    // ATTESTED → REJECTED, STALE
    expect(canTransition("ATTESTED", "REJECTED")).toBe(true);
    expect(canTransition("ATTESTED", "STALE")).toBe(true);
    // VERIFIED → STALE
    expect(canTransition("VERIFIED", "STALE")).toBe(true);
    // STALE → VERIFIED, UNVERIFIED
    expect(canTransition("STALE", "VERIFIED")).toBe(true);
    expect(canTransition("STALE", "UNVERIFIED")).toBe(true);
    // LIVE_UNVERIFIED → VERIFIED, STALE, UNVERIFIED
    expect(canTransition("LIVE_UNVERIFIED", "VERIFIED")).toBe(true);
    expect(canTransition("LIVE_UNVERIFIED", "STALE")).toBe(true);
    expect(canTransition("LIVE_UNVERIFIED", "UNVERIFIED")).toBe(true);
    // SELF_REPORTED → UNDER_CHECK, ATTESTED, REJECTED
    expect(canTransition("SELF_REPORTED", "UNDER_CHECK")).toBe(true);
    expect(canTransition("SELF_REPORTED", "ATTESTED")).toBe(true);
    expect(canTransition("SELF_REPORTED", "REJECTED")).toBe(true);
    // UNVERIFIED → SUBMITTED
    expect(canTransition("UNVERIFIED", "SUBMITTED")).toBe(true);
    // REJECTED → SUBMITTED
    expect(canTransition("REJECTED", "SUBMITTED")).toBe(true);
  });

  it("rejects all prohibited transitions", () => {
    // A student can't skip straight to VERIFIED
    expect(canTransition("SUBMITTED", "VERIFIED")).toBe(false);
    expect(canTransition("SUBMITTED", "ATTESTED")).toBe(false);
    expect(canTransition("SUBMITTED", "REJECTED")).toBe(false);
    // VERIFIED can't go back to SUBMITTED directly
    expect(canTransition("VERIFIED", "SUBMITTED")).toBe(false);
    expect(canTransition("VERIFIED", "UNDER_CHECK")).toBe(false);
    expect(canTransition("VERIFIED", "REJECTED")).toBe(false);
    // ATTESTED can't go to VERIFIED
    expect(canTransition("ATTESTED", "VERIFIED")).toBe(false);
    expect(canTransition("ATTESTED", "SUBMITTED")).toBe(false);
    // Self-referential transitions
    for (const s of VERIFICATION_STATUSES) {
      expect(canTransition(s, s)).toBe(false);
    }
  });

  it("covers every status as a source", () => {
    for (const s of VERIFICATION_STATUSES) {
      expect(TRANSITIONS[s]).toBeDefined();
      expect(Array.isArray(TRANSITIONS[s])).toBe(true);
      expect(TRANSITIONS[s].length).toBeGreaterThan(0);
    }
  });

  it("ensures every target status is a valid VerificationStatus", () => {
    for (const [_from, targets] of Object.entries(TRANSITIONS)) {
      for (const to of targets) {
        expect(VERIFICATION_STATUSES).toContain(to);
      }
    }
  });
});

describe("§6.1 transitionArtifact()", () => {
  /** A working mock that supports one artifact. */
  function workingMock(status: VerificationStatus = "SUBMITTED") {
    const artifactId = "art-001";
    const artifact = { id: artifactId, status, verifiedAt: null as Date | null };
    const events: MockEvent[] = [];
    let eventCounter = 0;

    const deps: TransitionDeps = {
      db: {
        async transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
          const tx = {
            select() {
              return {
                from() {
                  return {
                    where() {
                      return {
                        for() {
                          return {
                            limit() {
                              return [{ ...artifact }];
                            },
                          };
                        },
                      };
                    },
                  };
                },
              };
            },
            update() {
              return {
                set(values: { status?: string; verifiedAt?: Date }) {
                  return {
                    where() {
                      return {
                        returning() {
                          // Simulate conditional update succeeding
                          if (values.status) artifact.status = values.status as VerificationStatus;
                          if (values.verifiedAt !== undefined) artifact.verifiedAt = values.verifiedAt;
                          return [{ id: artifactId }];
                        },
                      };
                    },
                  };
                },
              };
            },
            insert() {
              return {
                values(vals: Omit<MockEvent, "id">) {
                  return {
                    returning() {
                      const id = `evt-${++eventCounter}`;
                      events.push({ id, ...vals } as MockEvent);
                      return [{ id }];
                    },
                  };
                },
              };
            },
          };
          return fn(tx);
        },
      },
      artifacts: {
        id: { name: "id" },
        status: { name: "status" },
      } as unknown as TransitionDeps["artifacts"],
      artifactStatusEvents: {
        id: { name: "id" },
      } as unknown as TransitionDeps["artifactStatusEvents"],
    };

    return { deps, artifact, events, artifactId };
  }

  it("valid transition: SUBMITTED → UNDER_CHECK by system", async () => {
    const { deps, artifact, events, artifactId } = workingMock("SUBMITTED");
    const result = await transitionArtifact(
      {
        artifactId,
        toStatus: "UNDER_CHECK",
        actorId: "verification-worker",
        actorKind: "system",
        reason: "Queued for automatic check",
      },
      deps,
    );
    expect(result.fromStatus).toBe("SUBMITTED");
    expect(result.toStatus).toBe("UNDER_CHECK");
    expect(artifact.status).toBe("UNDER_CHECK");
    expect(events).toHaveLength(1);
    expect(events[0].fromStatus).toBe("SUBMITTED");
    expect(events[0].toStatus).toBe("UNDER_CHECK");
    expect(events[0].reason).toBe("Queued for automatic check");
  });

  it("valid transition: UNDER_CHECK → VERIFIED sets verifiedAt", async () => {
    const { deps, artifact, artifactId } = workingMock("UNDER_CHECK");
    await transitionArtifact(
      {
        artifactId,
        toStatus: "VERIFIED",
        actorId: "github-worker",
        actorKind: "system",
        reason: "GitHub API confirmed repository ownership",
      },
      deps,
    );
    expect(artifact.status).toBe("VERIFIED");
    expect(artifact.verifiedAt).toBeInstanceOf(Date);
  });

  it("valid transition: UNDER_CHECK → ATTESTED by reviewer", async () => {
    const { deps, artifact, events, artifactId } = workingMock("UNDER_CHECK");
    await transitionArtifact(
      {
        artifactId,
        toStatus: "ATTESTED",
        actorId: "user-mentor-1",
        actorKind: "reviewer",
        reason: "Certificate verified against original",
      },
      deps,
    );
    expect(artifact.status).toBe("ATTESTED");
    expect(events[0].actorKind).toBe("reviewer");
  });

  it("rejects invalid transition: SUBMITTED → VERIFIED", async () => {
    const { deps, artifactId } = workingMock("SUBMITTED");
    await expect(
      transitionArtifact(
        {
          artifactId,
          toStatus: "VERIFIED",
          actorId: "system",
          actorKind: "system",
          reason: "test",
        },
        deps,
      ),
    ).rejects.toThrow(LifecycleError);

    try {
      await transitionArtifact(
        {
          artifactId,
          toStatus: "VERIFIED",
          actorId: "system",
          actorKind: "system",
          reason: "test",
        },
        deps,
      );
    } catch (e) {
      expect((e as LifecycleError).code).toBe("INVALID_TRANSITION");
    }
  });

  it("rejects missing reason", async () => {
    const { deps, artifactId } = workingMock("SUBMITTED");
    await expect(
      transitionArtifact(
        {
          artifactId,
          toStatus: "UNDER_CHECK",
          actorId: "system",
          actorKind: "system",
          reason: "",
        },
        deps,
      ),
    ).rejects.toThrow(LifecycleError);

    try {
      await transitionArtifact(
        { artifactId, toStatus: "UNDER_CHECK", actorId: "system", actorKind: "system", reason: "   " },
        deps,
      );
    } catch (e) {
      expect((e as LifecycleError).code).toBe("MISSING_REASON");
    }
  });

  it("rejects unauthorized actor: student cannot set VERIFIED", async () => {
    const { deps, artifactId } = workingMock("UNDER_CHECK");
    await expect(
      transitionArtifact(
        {
          artifactId,
          toStatus: "VERIFIED",
          actorId: "student-1",
          actorKind: "student",
          reason: "I say it's verified",
        },
        deps,
      ),
    ).rejects.toThrow(LifecycleError);

    try {
      await transitionArtifact(
        { artifactId, toStatus: "VERIFIED", actorId: "student-1", actorKind: "student", reason: "I say it's verified" },
        deps,
      );
    } catch (e) {
      expect((e as LifecycleError).code).toBe("UNAUTHORIZED_ACTOR");
    }
  });

  it("rejects unauthorized actor: student cannot set ATTESTED", async () => {
    const { deps, artifactId } = workingMock("UNDER_CHECK");
    try {
      await transitionArtifact(
        { artifactId, toStatus: "ATTESTED", actorId: "student-1", actorKind: "student", reason: "self attest" },
        deps,
      );
      expect.fail("Should have thrown");
    } catch (e) {
      expect((e as LifecycleError).code).toBe("UNAUTHORIZED_ACTOR");
    }
  });

  it("rejects missing artifact", async () => {
    const deps: TransitionDeps = {
      db: {
        async transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
          const tx = {
            select() {
              return {
                from() {
                  return {
                    where() {
                      return {
                        for() {
                          return {
                            limit() {
                              return []; // Not found
                            },
                          };
                        },
                      };
                    },
                  };
                },
              };
            },
          };
          return fn(tx);
        },
      },
      artifacts: { id: {}, status: {} } as unknown as TransitionDeps["artifacts"],
      artifactStatusEvents: { id: {} } as unknown as TransitionDeps["artifactStatusEvents"],
    };

    try {
      await transitionArtifact(
        { artifactId: "nonexistent", toStatus: "UNDER_CHECK", actorId: "system", actorKind: "system", reason: "test" },
        deps,
      );
      expect.fail("Should have thrown");
    } catch (e) {
      expect((e as LifecycleError).code).toBe("ARTIFACT_NOT_FOUND");
    }
  });

  it("rejects concurrent modification via expectedFromStatus", async () => {
    // Artifact is UNDER_CHECK but caller expected SUBMITTED
    const { deps, artifactId } = workingMock("UNDER_CHECK");
    try {
      await transitionArtifact(
        {
          artifactId,
          toStatus: "VERIFIED",
          actorId: "system",
          actorKind: "system",
          reason: "test",
          expectedFromStatus: "SUBMITTED",
        },
        deps,
      );
      expect.fail("Should have thrown");
    } catch (e) {
      expect((e as LifecycleError).code).toBe("CONCURRENT_MODIFICATION");
    }
  });

  it("rejects already-in-target-status (idempotent guard)", async () => {
    const { deps, artifactId } = workingMock("VERIFIED");
    try {
      await transitionArtifact(
        { artifactId, toStatus: "VERIFIED", actorId: "system", actorKind: "system", reason: "recheck" },
        deps,
      );
      expect.fail("Should have thrown");
    } catch (e) {
      expect((e as LifecycleError).code).toBe("ALREADY_IN_TARGET_STATUS");
    }
  });

  it("recheck lifecycle: VERIFIED → STALE → UNVERIFIED", async () => {
    const { deps, artifact, events, artifactId } = workingMock("VERIFIED");

    // First failed recheck: VERIFIED → STALE
    await transitionArtifact(
      { artifactId, toStatus: "STALE", actorId: "recheck-worker", actorKind: "system", reason: "Recheck failed (1st)" },
      deps,
    );
    expect(artifact.status).toBe("STALE");

    // Second failed recheck: STALE → UNVERIFIED
    await transitionArtifact(
      {
        artifactId,
        toStatus: "UNVERIFIED",
        actorId: "recheck-worker",
        actorKind: "system",
        reason: "Recheck failed (2nd)",
      },
      deps,
    );
    expect(artifact.status).toBe("UNVERIFIED");
    expect(events).toHaveLength(2);
  });

  it("recheck recovery: STALE → VERIFIED after successful recheck", async () => {
    const { deps, artifact, artifactId } = workingMock("STALE");
    await transitionArtifact(
      { artifactId, toStatus: "VERIFIED", actorId: "recheck-worker", actorKind: "system", reason: "Recheck passed" },
      deps,
    );
    expect(artifact.status).toBe("VERIFIED");
    expect(artifact.verifiedAt).toBeInstanceOf(Date);
  });

  it("student resubmit: REJECTED → SUBMITTED", async () => {
    const { deps, artifact, artifactId } = workingMock("REJECTED");
    await transitionArtifact(
      {
        artifactId,
        toStatus: "SUBMITTED",
        actorId: "student-1",
        actorKind: "student",
        reason: "Resubmitted with new evidence",
      },
      deps,
    );
    expect(artifact.status).toBe("SUBMITTED");
  });

  it("student resubmit: UNVERIFIED → SUBMITTED", async () => {
    const { deps, artifact, artifactId } = workingMock("UNVERIFIED");
    await transitionArtifact(
      { artifactId, toStatus: "SUBMITTED", actorId: "student-1", actorKind: "student", reason: "Resubmitted" },
      deps,
    );
    expect(artifact.status).toBe("SUBMITTED");
  });

  it("login-wall lifecycle: UNDER_CHECK → LIVE_UNVERIFIED", async () => {
    const { deps, artifact, artifactId } = workingMock("UNDER_CHECK");
    await transitionArtifact(
      {
        artifactId,
        toStatus: "LIVE_UNVERIFIED",
        actorId: "link-worker",
        actorKind: "system",
        reason: "Login wall detected",
      },
      deps,
    );
    expect(artifact.status).toBe("LIVE_UNVERIFIED");
  });

  it("SELF_REPORTED → ATTESTED by reviewer", async () => {
    const { deps, artifact, artifactId } = workingMock("SELF_REPORTED");
    await transitionArtifact(
      { artifactId, toStatus: "ATTESTED", actorId: "mentor-1", actorKind: "reviewer", reason: "Document verified" },
      deps,
    );
    expect(artifact.status).toBe("ATTESTED");
  });

  it("creates audit event with all required fields", async () => {
    const { deps, events, artifactId } = workingMock("SUBMITTED");
    const result = await transitionArtifact(
      {
        artifactId,
        toStatus: "UNDER_CHECK",
        actorId: "verification-worker",
        actorKind: "system",
        reason: "Starting check",
      },
      deps,
    );
    expect(events).toHaveLength(1);
    const evt = events[0];
    expect(evt.artifactId).toBe(artifactId);
    expect(evt.fromStatus).toBe("SUBMITTED");
    expect(evt.toStatus).toBe("UNDER_CHECK");
    expect(evt.reason).toBe("Starting check");
    expect(result.auditEventId).toBe(evt.id);
  });
});
