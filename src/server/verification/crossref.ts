/** DOI check via Crossref works lookup with author-name match (§6.2). */
import { env } from "../env";

export async function checkDoi(
  doi: string,
  authorFamilyName: string,
): Promise<{ ok: boolean; title?: string; reason?: string }> {
  const clean = doi.replace(/^https?:\/\/(dx\.)?doi\.org\//, "");
  const res = await fetch(
    `https://api.crossref.org/works/${encodeURIComponent(clean)}${env.CROSSREF_MAILTO ? `?mailto=${env.CROSSREF_MAILTO}` : ""}`,
    { signal: AbortSignal.timeout(10_000) },
  );
  if (!res.ok) return { ok: false, reason: `Crossref ${res.status}` };
  const body = (await res.json()) as {
    message: { title?: string[]; author?: { family?: string }[] };
  };
  const match = body.message.author?.some((a) => a.family?.toLowerCase() === authorFamilyName.toLowerCase()) ?? false;
  return {
    ok: match,
    title: body.message.title?.[0],
    reason: match ? undefined : "Author name not matched — flagged for mentor review",
  };
}
