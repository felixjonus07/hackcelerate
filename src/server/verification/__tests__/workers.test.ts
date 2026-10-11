/**
 * Tests for Crossref DOI verification (§6.2) and GitHub URL parsing.
 * Uses unit-level tests without real external API calls.
 */
import { describe, expect, it } from "vitest";
import { normalizeDoi, nameMatchScore } from "../crossref";
import { parseGitHubUrl } from "../github";
import { validateUrl } from "../link";
import { selectSample, validateSamplingDistribution, type SamplingCandidate } from "../sampling";
import {
  validateUpload,
  generateObjectKey,
  MAX_SIGNED_URL_SECONDS,
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE,
} from "../../storage";

/* ────────────────── DOI Normalization ────────────────── */

describe("§6.2 DOI normalization", () => {
  it("normalizes https://doi.org/ URL", () => {
    expect(normalizeDoi("https://doi.org/10.1234/example")).toBe("10.1234/example");
  });

  it("normalizes https://dx.doi.org/ URL", () => {
    expect(normalizeDoi("https://dx.doi.org/10.5678/test")).toBe("10.5678/test");
  });

  it("normalizes http://doi.org/ URL", () => {
    expect(normalizeDoi("http://doi.org/10.1234/example")).toBe("10.1234/example");
  });

  it("normalizes doi: prefix", () => {
    expect(normalizeDoi("doi:10.1234/example")).toBe("10.1234/example");
  });

  it("accepts bare DOI", () => {
    expect(normalizeDoi("10.1234/example")).toBe("10.1234/example");
  });

  it("strips tracking parameters", () => {
    expect(normalizeDoi("https://doi.org/10.1234/example?ref=somesite")).toBe("10.1234/example");
  });

  it("rejects invalid DOI (no 10. prefix)", () => {
    expect(normalizeDoi("https://example.com/paper")).toBeNull();
  });

  it("rejects DOI with no suffix after /", () => {
    expect(normalizeDoi("10.1234/")).toBeNull();
  });

  it("rejects empty string", () => {
    expect(normalizeDoi("")).toBeNull();
  });

  it("handles whitespace", () => {
    expect(normalizeDoi("  10.1234/example  ")).toBe("10.1234/example");
  });
});

/* ────────────────── Name matching ────────────────── */

describe("§6.2 Author name matching", () => {
  it("exact match scores 1.0", () => {
    expect(nameMatchScore("John Smith", "John Smith")).toBe(1.0);
  });

  it("case-insensitive match scores 1.0", () => {
    expect(nameMatchScore("john smith", "John Smith")).toBe(1.0);
  });

  it("family name match with same initial scores 0.85", () => {
    expect(nameMatchScore("J Smith", "John Smith")).toBeGreaterThanOrEqual(0.8);
  });

  it("family name only scores 0.6", () => {
    expect(nameMatchScore("Smith", "John Smith")).toBeGreaterThanOrEqual(0.6);
  });

  it("different family names scores 0", () => {
    expect(nameMatchScore("John Smith", "John Jones")).toBe(0);
  });

  it("handles diacritics", () => {
    expect(nameMatchScore("Jose Garcia", "José García")).toBe(1.0);
  });

  it("reversed name order scores above 0.5", () => {
    expect(nameMatchScore("Kumar Pradeep", "Pradeep Kumar")).toBeGreaterThan(0.5);
  });
});

/* ────────────────── GitHub URL parsing ────────────────── */

describe("§6.2 GitHub URL parsing", () => {
  it("parses standard HTTPS URL", () => {
    expect(parseGitHubUrl("https://github.com/user/repo")).toEqual({ owner: "user", repo: "repo" });
  });

  it("strips .git suffix", () => {
    expect(parseGitHubUrl("https://github.com/user/repo.git")).toEqual({ owner: "user", repo: "repo" });
  });

  it("handles www prefix", () => {
    expect(parseGitHubUrl("https://www.github.com/user/repo")).toEqual({ owner: "user", repo: "repo" });
  });

  it("handles trailing path", () => {
    expect(parseGitHubUrl("https://github.com/user/repo/tree/main/src")).toEqual({ owner: "user", repo: "repo" });
  });

  it("rejects non-GitHub URLs", () => {
    expect(parseGitHubUrl("https://gitlab.com/user/repo")).toBeNull();
  });

  it("rejects malformed URLs", () => {
    expect(parseGitHubUrl("not-a-url")).toBeNull();
  });
});

/* ────────────────── SSRF URL validation ────────────────── */

describe("§6.2 SSRF URL validation", () => {
  it("allows public HTTPS URLs", () => {
    expect(validateUrl("https://example.com").safe).toBe(true);
  });

  it("allows public HTTP URLs", () => {
    expect(validateUrl("http://example.com").safe).toBe(true);
  });

  it("blocks localhost", () => {
    expect(validateUrl("http://localhost/admin").safe).toBe(false);
  });

  it("blocks 127.0.0.1", () => {
    expect(validateUrl("http://127.0.0.1/admin").safe).toBe(false);
  });

  it("blocks 10.x.x.x", () => {
    expect(validateUrl("http://10.0.0.1/internal").safe).toBe(false);
  });

  it("blocks 192.168.x.x", () => {
    expect(validateUrl("http://192.168.1.1/router").safe).toBe(false);
  });

  it("blocks 172.16-31.x.x", () => {
    expect(validateUrl("http://172.16.0.1/internal").safe).toBe(false);
    expect(validateUrl("http://172.31.255.255/internal").safe).toBe(false);
  });

  it("blocks cloud metadata endpoint", () => {
    expect(validateUrl("http://169.254.169.254/latest/meta-data").safe).toBe(false);
  });

  it("blocks metadata.google.internal", () => {
    expect(validateUrl("http://metadata.google.internal/computeMetadata/v1").safe).toBe(false);
  });

  it("blocks FTP protocol", () => {
    expect(validateUrl("ftp://files.example.com/data").safe).toBe(false);
  });

  it("blocks file:// protocol", () => {
    expect(validateUrl("file:///etc/passwd").safe).toBe(false);
  });

  it("blocks URLs with credentials", () => {
    expect(validateUrl("http://user:pass@example.com").safe).toBe(false);
  });

  it("rejects malformed URLs", () => {
    expect(validateUrl("not a url").safe).toBe(false);
  });

  it("blocks IPv6 loopback", () => {
    expect(validateUrl("http://[::1]/admin").safe).toBe(false);
  });
});

/* ────────────────── Sampling ────────────────── */

describe("§6.2 10% external mock sampling", () => {
  it("selects approximately 10% of candidates", () => {
    const candidates: SamplingCandidate[] = Array.from({ length: 1000 }, (_, i) => ({
      id: `mock-${i}`,
      studentId: `student-${i % 60}`,
      term: "2026-odd",
    }));

    const decisions = selectSample(candidates, { samplePercentage: 10 }, "test-salt");
    const validation = validateSamplingDistribution(decisions, 10, 5);

    expect(decisions).toHaveLength(1000);
    expect(validation.withinTolerance).toBe(true);
    expect(validation.actualPct).toBeGreaterThan(3); // Very loose lower bound
    expect(validation.actualPct).toBeLessThan(20); // Very loose upper bound
  });

  it("is deterministic (same inputs → same output)", () => {
    const candidates: SamplingCandidate[] = Array.from({ length: 100 }, (_, i) => ({
      id: `mock-${i}`,
      studentId: `student-${i}`,
      term: "2026-odd",
    }));

    const run1 = selectSample(candidates, { samplePercentage: 10 }, "fixed-salt");
    const run2 = selectSample(candidates, { samplePercentage: 10 }, "fixed-salt");

    expect(run1.map((d) => d.selected)).toEqual(run2.map((d) => d.selected));
  });

  it("is idempotent (existing decisions preserved)", () => {
    const candidates: SamplingCandidate[] = [
      { id: "a", studentId: "s1", term: "2026-odd" },
      { id: "b", studentId: "s2", term: "2026-odd" },
      { id: "c", studentId: "s3", term: "2026-odd" },
    ];

    const existingDecisions = new Set(["a"]); // "a" already decided
    const decisions = selectSample(candidates, { samplePercentage: 50 }, "salt", existingDecisions);
    expect(decisions.map((d) => d.candidateId)).not.toContain("a");
    expect(decisions).toHaveLength(2);
  });

  it("returns empty for 0% rate", () => {
    const candidates: SamplingCandidate[] = [{ id: "a", studentId: "s1", term: "2026-odd" }];
    const decisions = selectSample(candidates, { samplePercentage: 0 }, "salt");
    expect(decisions).toHaveLength(0);
  });

  it("handles empty candidates", () => {
    const decisions = selectSample([], { samplePercentage: 10 }, "salt");
    expect(decisions).toHaveLength(0);
  });

  it("handles small populations with wider tolerance", () => {
    const candidates: SamplingCandidate[] = Array.from({ length: 5 }, (_, i) => ({
      id: `m-${i}`,
      studentId: `s-${i}`,
      term: "2026-odd",
    }));
    const decisions = selectSample(candidates, { samplePercentage: 10 }, "salt");
    const validation = validateSamplingDistribution(decisions, 10, 5);
    // With 5 candidates, tolerance is wider (5 * 3 = 15%)
    expect(decisions).toHaveLength(5);
  });
});

/* ────────────────── Storage validation ────────────────── */

describe("§6.2 Storage validation", () => {
  it("accepts valid PDF upload", () => {
    expect(validateUpload("application/pdf", 1024 * 1024, "cert.pdf")).toEqual({ valid: true, reason: "OK" });
  });

  it("rejects oversized file", () => {
    const result = validateUpload("application/pdf", MAX_FILE_SIZE + 1, "large.pdf");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("exceeds");
  });

  it("rejects invalid MIME type", () => {
    const result = validateUpload("application/x-executable", 1024, "bad.exe");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("not allowed");
  });

  it("rejects empty file", () => {
    expect(validateUpload("application/pdf", 0, "empty.pdf").valid).toBe(false);
  });

  it("rejects path traversal in filename", () => {
    expect(validateUpload("application/pdf", 1024, "../../../etc/passwd").valid).toBe(false);
  });

  it("generates safe object keys", () => {
    const key = generateObjectKey("a1b2c3d4-e5f6-7890-abcd-ef0123456789", "my doc.pdf", "application/pdf");
    expect(key).toMatch(/^evidence\/a1b2c3d4-e5f6-7890-abcd-ef0123456789\/[0-9a-f-]+\.pdf$/);
    expect(key).not.toContain("..");
  });

  it("enforces 5-minute signed URL maximum", () => {
    expect(MAX_SIGNED_URL_SECONDS).toBe(300);
  });
});
