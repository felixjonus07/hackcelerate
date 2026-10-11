import { describe, expect, it, vi } from "vitest";

// Mock auth session
vi.mock("@/server/auth/session", () => ({
  requireApiUser: vi.fn().mockResolvedValue({
    id: "usr-dean-02",
    role: "dean",
  }),
}));

// Mock audit log
vi.mock("@/server/audit/log", () => ({
  audit: vi.fn().mockResolvedValue(undefined),
}));

// Mock policy load
vi.mock("@/server/policy/load", () => ({
  clearPolicyCache: vi.fn(),
}));

const { mockEnqueue } = vi.hoisted(() => ({
  mockEnqueue: vi.fn().mockResolvedValue({ id: "job-123" }),
}));

vi.mock("@/server/queue", () => ({
  enqueue: mockEnqueue,
}));

// Mock db
const mockStudents = [{ id: "stu-01" }, { id: "stu-02" }, { id: "stu-03" }];
const mockPolicyDraft = {
  version: "2026.10-v2",
  status: "DRAFT",
  approvals: [
    {
      userId: "usr-registrar-01",
      role: "registrar",
      at: "2026-10-10T10:00:00Z",
    },
  ],
};

vi.mock("@/server/db", () => ({
  db: {
    select: vi.fn().mockImplementation((fields) => ({
      from: vi.fn().mockImplementation(() => {
        if (fields) {
          return Promise.resolve(mockStudents);
        }
        return {
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([mockPolicyDraft]),
          }),
        };
      }),
    })),
    transaction: vi.fn().mockImplementation(async (cb) => {
      await cb({
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(undefined),
          }),
        }),
      });
    }),
  },
}));

import { POST } from "@/app/api/v1/admin/policy/versions/[v]/activate/route";

describe("§3.3 Policy Version Activation & Re-Evaluation Trigger", () => {
  it("activates on second distinct approver and enqueues re-evaluations for all students", async () => {
    mockEnqueue.mockClear();

    const req = new Request("http://localhost:3100/api/v1/admin/policy/versions/2026.10-v2/activate", {
      method: "POST",
    });

    const res = await POST(req, { params: Promise.resolve({ v: "2026.10-v2" }) });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.status).toBe("ACTIVE");
    expect(body.approvals).toBe(2);
    expect(body.reEvaluationsQueued).toBe(3);

    // Verify evaluation queue jobs were enqueued with reason: "policy_change"
    expect(mockEnqueue).toHaveBeenCalledTimes(3);
    expect(mockEnqueue).toHaveBeenCalledWith("evaluation", {
      studentId: "stu-01",
      requestedBy: "usr-dean-02",
      reason: "policy_change",
    });
    expect(mockEnqueue).toHaveBeenCalledWith("evaluation", {
      studentId: "stu-02",
      requestedBy: "usr-dean-02",
      reason: "policy_change",
    });
    expect(mockEnqueue).toHaveBeenCalledWith("evaluation", {
      studentId: "stu-03",
      requestedBy: "usr-dean-02",
      reason: "policy_change",
    });
  });
});
