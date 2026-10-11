/** Portfolio / live link check (§6.2): a live page without owner proof is LIVE_UNVERIFIED. */
export async function checkLink(
  url: string,
  ownerName?: string,
): Promise<{ live: boolean; ownerMatched: boolean; status?: number }> {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { live: false, ownerMatched: false, status: res.status };
    const html = ownerName ? (await res.text()).slice(0, 200_000).toLowerCase() : "";
    return {
      live: true,
      ownerMatched: Boolean(ownerName && html.includes(ownerName.toLowerCase())),
      status: res.status,
    };
  } catch {
    return { live: false, ownerMatched: false };
  }
}
