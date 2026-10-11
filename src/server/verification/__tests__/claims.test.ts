import { describe, expect, it } from "vitest";
import { claimKeyFor, doiFrom, textHashFor } from "../claims";

describe("claim keys (§6.3 duplicate claim)", () => {
  it("makes the same repository the same key whatever the spelling", () => {
    const keys = [
      "https://github.com/Octo/Repo",
      "http://www.github.com/octo/repo/",
      "https://github.com/octo/repo.git",
      "https://github.com/octo/repo/tree/main",
    ].map((url) => claimKeyFor({ url }));
    expect(new Set(keys)).toEqual(new Set(["github:octo/repo"]));
  });
  it("normalises a DOI from a URL", () => {
    expect(claimKeyFor({ url: "https://doi.org/10.1038/NATURE14539" })).toBe("doi:10.1038/nature14539");
    expect(doiFrom("https://dx.doi.org/10.1038/nature14539")).toBe("10.1038/nature14539");
  });
  it("uses a certificate id and issuer when given", () => {
    expect(claimKeyFor({ details: { certificateId: " ABC-123 ", issuer: "Figma" } })).toBe("cert:figma:abc-123");
  });
  it("returns null when nothing is claimed", () => {
    expect(claimKeyFor({ url: "https://example.org/portfolio" })).toBeNull();
    expect(claimKeyFor({})).toBeNull();
  });
});

describe("text hashes (§6.3 reused text)", () => {
  const text = "A mobile app that helps rural farmers plan irrigation with weather data.";
  it("ignores case, spacing and punctuation", () => {
    expect(textHashFor(text)).toBe(textHashFor(`  ${text.toUpperCase().replace(/\./, "!!")}  `));
  });
  it("differs for different text", () => {
    expect(textHashFor(text)).not.toBe(textHashFor(`${text} Built with React.`));
  });
  it("ignores short descriptions, which prove nothing", () => {
    expect(textHashFor("Final year project")).toBeNull();
    expect(textHashFor(null)).toBeNull();
  });
});
