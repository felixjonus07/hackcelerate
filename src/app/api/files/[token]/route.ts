import { connection } from "next/server";
import { readLocalObject, readLocalToken, storageKind } from "@/server/storage";

/**
 * GET /api/files/{token} — the development stand-in for an expiring bucket link (§13.3). The token is
 * issued only after the caller was authorized for the file and is an HMAC of the key and its expiry.
 * With a real bucket configured this route is off and links point at the bucket directly.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  await connection();
  if (storageKind !== "local") return new Response("Not found", { status: 404 });
  const link = readLocalToken((await ctx.params).token);
  if (!link) return new Response("This link has expired", { status: 410, headers: { "Cache-Control": "no-store" } });
  const body = await readLocalObject(link.key);
  if (!body) return new Response("Not found", { status: 404 });
  const head = body.subarray(0, 4);
  const type = head[0] === 0x25 ? "application/pdf" : head[0] === 0x89 ? "image/png" : "image/jpeg";
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": type,
      "Content-Disposition": "inline",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
