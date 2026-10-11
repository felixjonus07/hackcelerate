/** A student's link must never let the server reach our own network (§6.2 portfolio check). */
import { describe, expect, it } from "vitest";
import { type Fetcher, safeFetch } from "../http";
import { assertPublicUrl, isPrivateAddress, UnsafeUrlError } from "../ssrf";

describe("private addresses", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "0.0.0.0",
    "100.64.0.1",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "::",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "::ffff:7f00:1",
    "64:ff9b::192.168.0.1",
    "not-an-ip",
  ])("%s is private", (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });
  it.each([
    "8.8.8.8",
    "1.1.1.1",
    "172.15.0.1",
    "172.32.0.1",
    "93.184.216.34",
    "2606:4700:4700::1111",
    "::ffff:8.8.8.8",
  ])("%s is public", (ip) => {
    expect(isPrivateAddress(ip)).toBe(false);
  });
});

const publicDns = async () => ["93.184.216.34"];

describe("assertPublicUrl", () => {
  it("accepts an ordinary https link", async () => {
    await expect(assertPublicUrl("https://example.org/portfolio", publicDns)).resolves.toBeInstanceOf(URL);
  });
  it.each([
    "ftp://example.org/x",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "gopher://example.org",
    "https://user:pw@example.org/",
    "http://localhost/admin",
    "http://app.localhost/",
    "https://printer.local/",
    "http://metadata.internal/",
    "http://127.0.0.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/",
    "https://example.org:8443/",
    "http://example.org:22/",
    "not a url",
  ])("refuses %s", async (url) => {
    await expect(assertPublicUrl(url, publicDns)).rejects.toBeInstanceOf(UnsafeUrlError);
  });
  it("refuses a name that resolves to a private address, or to nothing", async () => {
    await expect(assertPublicUrl("https://rebind.example/", async () => ["10.0.0.5"])).rejects.toThrow(/private/);
    await expect(assertPublicUrl("https://mixed.example/", async () => ["93.184.216.34", "127.0.0.1"])).rejects.toThrow(
      /private/,
    );
    await expect(assertPublicUrl("https://nowhere.example/", async () => [])).rejects.toThrow(/does not resolve/);
  });
});

describe("safeFetch", () => {
  const reply = (status: number, location?: string, body = ""): Response =>
    new Response(body, { status, headers: location ? { location } : undefined });

  it("follows a redirect to another public host", async () => {
    const fetcher: Fetcher = async (u) =>
      u.startsWith("https://a.example") ? reply(302, "https://b.example/home") : reply(200, undefined, "hello");
    const r = await safeFetch("https://a.example/", { fetcher, resolver: publicDns, readBody: true });
    expect(r).toMatchObject({ status: 200, finalUrl: "https://b.example/home", body: "hello" });
  });
  it("refuses a redirect into the private network", async () => {
    const fetcher: Fetcher = async () => reply(302, "http://169.254.169.254/latest/meta-data/");
    await expect(
      safeFetch("https://a.example/", {
        fetcher,
        resolver: async (h) => (h === "a.example" ? ["93.184.216.34"] : ["169.254.169.254"]),
      }),
    ).rejects.toBeInstanceOf(UnsafeUrlError);
  });
  it("gives up after too many redirects", async () => {
    const fetcher: Fetcher = async () => reply(302, "https://a.example/again");
    await expect(safeFetch("https://a.example/", { fetcher, resolver: publicDns })).rejects.toThrow(
      /Too many redirects/,
    );
  });
  it("reads at most a bounded part of the body", async () => {
    const fetcher: Fetcher = async () => reply(200, undefined, "x".repeat(500_000));
    const r = await safeFetch("https://a.example/", { fetcher, resolver: publicDns, readBody: true });
    expect(r.body.length).toBe(200_000);
  });
});
