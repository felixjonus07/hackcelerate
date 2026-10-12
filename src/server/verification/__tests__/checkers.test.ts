/**
 * The GitHub, Crossref and link checkers replayed against recorded HTTP responses (real replies from
 * api.github.com and api.crossref.org, trimmed to the fields the workers read). No network is used.
 */
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadPolicyFile } from "../../policy/file";
import { loadFixture, recordedFetcher } from "../../testing/recorded-fetch";
import { decideDoi, fetchWork, matchAuthor, splitName } from "../crossref";
import { commitPattern, decideRepository, fetchRepoReport, parseRepoUrl } from "../github";
import { decideLink, fetchLink, pageNamesOwner } from "../link";

const dir = join(__dirname, "fixtures");
const policy = loadPolicyFile();
const fx = (name: string) => loadFixture(dir, name);

describe("GitHub repository check (§6.2)", () => {
  const original = fx("github-repo-original.json");
  const fork = fx("github-repo-fork.json");
  const forkName = (fork.body as { full_name: string }).full_name;
  const routes = [
    { match: /\/repos\/vercel\/next\.js$/, reply: original },
    { match: /\/repos\/vercel\/next\.js\/commits/, reply: fx("github-commits.json") },
    { match: new RegExp(`/repos/${forkName.replace("/", "\\/")}$`), reply: fork },
    { match: new RegExp(`/repos/${forkName.replace("/", "\\/")}/commits`), reply: fx("github-commits.json") },
    { match: /does-not-exist/, reply: fx("github-404.json") },
  ];
  const okLogin = "timneutkens";

  it("reads owner, creation date and commit authorship from the API", async () => {
    const { fetcher, calls } = recordedFetcher(routes);
    const r = await fetchRepoReport("https://github.com/vercel/next.js", { login: okLogin, fetcher });
    expect(r).toMatchObject({ state: "found", ownerLogin: "vercel", fork: false });
    expect(r.createdAt).toMatch(/^20\d\d-/);
    expect(r.commitTimes).toHaveLength(30);
    expect(calls[1]).toContain("author=timneutkens");
  });

  it("VERIFIED when the student's linked login authored commits in the repository", async () => {
    const { fetcher } = recordedFetcher(routes);
    const r = await fetchRepoReport("https://github.com/vercel/next.js", { login: okLogin, fetcher });
    const d = decideRepository(r, { verifiedLogin: okLogin }, "a1", policy);
    expect(d.status).toBe("VERIFIED");
    expect(d.reason).toMatch(/30 commits authored by your linked account/);
    expect(d.flags).toEqual([]);
  });

  it("LIVE_UNVERIFIED when the repository exists but the student has not linked GitHub", async () => {
    const { fetcher, calls } = recordedFetcher(routes);
    const r = await fetchRepoReport("https://github.com/vercel/next.js", { fetcher });
    expect(calls).toHaveLength(1); // no login, so no commit lookup
    expect(decideRepository(r, { verifiedLogin: null }, "a1", policy)).toMatchObject({ status: "LIVE_UNVERIFIED" });
  });

  it("UNVERIFIED when the owner is someone else and the student has no commits there", () => {
    const d = decideRepository(
      { state: "found", httpStatus: 200, ownerLogin: "someone-else", fork: false, commitTimes: [] },
      { verifiedLogin: "me" },
      "a1",
      policy,
    );
    expect(d.status).toBe("UNVERIFIED");
    expect(d.reason).toMatch(/not your linked account/);
  });

  it("VERIFIED when the student owns the repository", () => {
    const d = decideRepository(
      { state: "found", httpStatus: 200, ownerLogin: "Me", fork: false, commitTimes: [] },
      { verifiedLogin: "me" },
      "a1",
      policy,
    );
    expect(d.status).toBe("VERIFIED");
  });

  describe("forks count only with substantial own commits", () => {
    const min = policy.verification.github.fork_min_own_commits;
    const times = (n: number) => Array.from({ length: n }, (_, i) => `2026-0${1 + (i % 9)}-1${i % 9}T10:00:00Z`);
    it("a fork with enough commits of the student's own is VERIFIED", () => {
      const d = decideRepository(
        { state: "found", httpStatus: 200, ownerLogin: "me", fork: true, commitTimes: times(min) },
        { verifiedLogin: "me" },
        "a",
        policy,
      );
      expect(d.status).toBe("VERIFIED");
    });
    it("a fork with too few is UNVERIFIED, and says why", () => {
      const d = decideRepository(
        { state: "found", httpStatus: 200, ownerLogin: "me", fork: true, commitTimes: times(min - 1) },
        { verifiedLogin: "me" },
        "a",
        policy,
      );
      expect(d).toMatchObject({ status: "UNVERIFIED" });
      expect(d.reason).toMatch(new RegExp(`${min} commits`));
    });
    it("the recorded fork repository is recognised as a fork", async () => {
      const { fetcher } = recordedFetcher(routes);
      const r = await fetchRepoReport(`https://github.com/${forkName}`, { login: okLogin, fetcher });
      expect(r.fork).toBe(true);
    });
  });

  it("UNVERIFIED for a missing or private repository, with the private-repository note", async () => {
    const { fetcher } = recordedFetcher(routes);
    const r = await fetchRepoReport("https://github.com/aspiredge-test/does-not-exist-404", {
      login: okLogin,
      fetcher,
    });
    expect(r.state).toBe("not_found");
    expect(decideRepository(r, { verifiedLogin: okLogin }, "a", policy)).toMatchObject({
      status: "UNVERIFIED",
      reason: expect.stringMatching(/private/),
    });
  });

  it("an API outage or rate limit is not a verdict", async () => {
    const { fetcher } = recordedFetcher([
      { match: /./, reply: { status: 403, body: { message: "rate limit exceeded" } } },
    ]);
    expect((await fetchRepoReport("https://github.com/a/b", { fetcher })).state).toBe("error");
  });

  it("reads the owner and repo from different spellings of the URL", () => {
    expect(parseRepoUrl("https://github.com/a/b.git")).toEqual({ owner: "a", repo: "b" });
    expect(parseRepoUrl("https://example.org/a/b")).toBeNull();
  });

  describe("burst commits (§6.3) raise a flag and nothing more", () => {
    it("30 commits in one minute is flagged", () => {
      const burst = Array.from({ length: 30 }, (_, i) => new Date(Date.UTC(2026, 9, 1, 12, 0, i)).toISOString());
      const d = decideRepository(
        { state: "found", httpStatus: 200, ownerLogin: "me", fork: false, commitTimes: burst },
        { verifiedLogin: "me" },
        "repo-1",
        policy,
      );
      expect(d.flags).toEqual([{ check: "burst_commits", subjectId: "repo-1", detail: expect.any(String) }]);
      expect(d.status).toBe("VERIFIED"); // a flag never changes the status
    });
    it("most commits within 24 hours with no earlier activity is flagged", () => {
      const times = [
        ...Array.from({ length: 9 }, (_, i) => new Date(Date.UTC(2026, 9, 1, i + 1)).toISOString()),
        new Date(Date.UTC(2026, 9, 28)).toISOString(),
      ];
      expect(commitPattern(times).share24h).toBe(0.9);
      expect(commitPattern(times).hadEarlierActivity).toBe(false);
      expect(
        decideRepository(
          { state: "found", httpStatus: 200, ownerLogin: "me", fork: false, commitTimes: times },
          { verifiedLogin: "me" },
          "r",
          policy,
        ).flags,
      ).toHaveLength(1);
    });
    it("the recorded history of a real contributor is not flagged", () => {
      const times = (fx("github-commits.json").body as { commit: { author: { date: string } } }[]).map(
        (c) => c.commit.author.date,
      );
      expect(commitPattern(times).peakPerMinute).toBeLessThan(policy.integrity.burst_commits_per_minute);
      expect(
        decideRepository(
          { state: "found", httpStatus: 200, ownerLogin: "me", fork: false, commitTimes: times },
          { verifiedLogin: "me" },
          "r",
          policy,
        ).flags,
      ).toEqual([]);
    });
  });
});

describe("Crossref DOI check (§6.2)", () => {
  const routes = [
    { match: /works\/10\.1038%2Fnature14539/, reply: fx("crossref-work.json") },
    { match: /works\//, reply: fx("crossref-404.json") },
  ];
  it("matches an author's family name and given initial", async () => {
    const { fetcher } = recordedFetcher(routes);
    const r = await fetchWork("10.1038/nature14539", { fetcher });
    expect(r.title).toBe("Deep learning");
    expect(r.authors.map((a) => a.family)).toEqual(["LeCun", "Bengio", "Hinton"]);
    expect(decideDoi(r, splitName("Yann LeCun"))).toMatchObject({ status: "VERIFIED", nameVariant: false });
  });
  it("a close family name or a different given name is a variant for mentor review", async () => {
    const { fetcher } = recordedFetcher(routes);
    const r = await fetchWork("10.1038/nature14539", { fetcher });
    expect(decideDoi(r, splitName("Yann LeCunn"))).toMatchObject({ status: "SELF_REPORTED", nameVariant: true });
    expect(decideDoi(r, splitName("Marie Hinton"))).toMatchObject({ status: "SELF_REPORTED", nameVariant: true });
  });
  it("a name that is not among the authors is UNVERIFIED", async () => {
    const { fetcher } = recordedFetcher(routes);
    const r = await fetchWork("10.1038/nature14539", { fetcher });
    expect(decideDoi(r, splitName("Arjun Kumar"))).toMatchObject({ status: "UNVERIFIED", nameVariant: false });
  });
  it("an unknown DOI is UNVERIFIED; an outage is not a verdict", async () => {
    const { fetcher } = recordedFetcher(routes);
    const r = await fetchWork("10.9999/nope", { fetcher });
    expect(r.state).toBe("not_found");
    expect(decideDoi(r, splitName("Yann LeCun")).status).toBe("UNVERIFIED");
    const down = recordedFetcher([{ match: /./, reply: { status: 503, body: "" } }]);
    expect((await fetchWork("10.1038/x", { fetcher: down.fetcher })).state).toBe("error");
  });
  it("matches names across accents and case", () => {
    const authors = [{ family: "Müller", given: "Jürgen" }];
    expect(matchAuthor(authors, { given: "Jurgen", family: "MULLER" })).toBe("match");
    expect(matchAuthor([], { given: "A", family: "B" })).toBe("none");
  });
});

describe("portfolio and link check (§6.2)", () => {
  const pub = async () => ["93.184.216.34"];
  const page = (body: string, status = 200) => ({ match: /./, reply: { status, body } as never });
  const html = (s: string) => ({ status: 200, body: s, headers: { "content-type": "text/html" } });

  it("a live page that names the owner is VERIFIED", async () => {
    const { fetcher } = recordedFetcher([{ match: /./, reply: html("<h1>Arjun Kumar</h1> Product designer") }]);
    const r = await fetchLink(
      "https://portfolio.example/arjun",
      { displayName: "Arjun Kumar" },
      { fetcher, resolver: pub },
    );
    expect(decideLink(r)).toMatchObject({ status: "VERIFIED" });
  });
  it("a live page that does not name the owner is LIVE_UNVERIFIED", async () => {
    const { fetcher } = recordedFetcher([{ match: /./, reply: html("<h1>Someone Else</h1>") }]);
    const r = await fetchLink(
      "https://portfolio.example/x",
      { displayName: "Arjun Kumar" },
      { fetcher, resolver: pub },
    );
    expect(decideLink(r).status).toBe("LIVE_UNVERIFIED");
  });
  it("login-only pages become LIVE_UNVERIFIED", async () => {
    for (const reply of [
      { status: 401, body: "" },
      { status: 403, body: "" },
      html('<input type="password" name="p">'),
    ]) {
      const { fetcher } = recordedFetcher([{ match: /./, reply }]);
      const r = await fetchLink(
        "https://social.example/arjun",
        { displayName: "Arjun Kumar" },
        { fetcher, resolver: pub },
      );
      expect(r.state).toBe("login_wall");
      expect(decideLink(r).status).toBe("LIVE_UNVERIFIED");
    }
  });
  it("a redirect to a sign-in path is a login wall", async () => {
    const { fetcher } = recordedFetcher([
      {
        match: /portfolio\.example\/arjun$/,
        reply: { status: 302, body: "", headers: { location: "https://portfolio.example/login?next=/arjun" } },
      },
      { match: /login/, reply: html("sign in") },
    ]);
    const r = await fetchLink("https://portfolio.example/arjun", { displayName: "A B" }, { fetcher, resolver: pub });
    expect(r.state).toBe("login_wall");
  });
  it("a missing page is UNVERIFIED and worth retrying within the window; a server error too", async () => {
    for (const status of [404, 410, 500]) {
      const { fetcher } = recordedFetcher([page("", status)]);
      const d = decideLink(await fetchLink("https://portfolio.example/gone", {}, { fetcher, resolver: pub }));
      expect(d).toMatchObject({ status: "UNVERIFIED", retry: true });
    }
  });
  it("a link into the private network is refused without any request", async () => {
    const { fetcher, calls } = recordedFetcher([page("secret")]);
    const r = await fetchLink("http://169.254.169.254/latest/meta-data/", {}, { fetcher });
    expect(r.state).toBe("unsafe");
    expect(calls).toEqual([]);
    expect(decideLink(r)).toMatchObject({ status: "UNVERIFIED", retry: false });
  });
  it("owner matching needs both names on the page", () => {
    expect(pageNamesOwner("Arjun Kumar's work", "Arjun Kumar")).toBe(true);
    expect(pageNamesOwner("Arjun's work", "Arjun Kumar")).toBe(false);
    expect(pageNamesOwner("Kumar", "")).toBe(false);
  });
});
