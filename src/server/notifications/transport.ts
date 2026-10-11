/**
 * Delivery (§10.1). In-app notices need no transport. Email goes to an outbox file in development or a
 * webhook relay when configured; WhatsApp uses the Business Cloud API with a pre-approved template and
 * only for a person who opted in. A message that cannot be delivered is marked FAILED, never retried blindly.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { env } from "../env";
import { WHATSAPP_TEMPLATES } from "./templates";

export interface Delivery {
  to: string;
  title: string;
  body: string;
  template: string;
  vars?: Record<string, string | number>;
}

export interface Transport {
  channel: "email" | "whatsapp";
  send(d: Delivery): Promise<{ ok: boolean; detail: string }>;
}

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

/** Development: write each message to `.local-data/outbox` so it can be read without a mail server. */
export const outboxTransport: Transport = {
  channel: "email",
  async send(d) {
    const dir = join(process.cwd(), ".local-data", "outbox");
    await mkdir(dir, { recursive: true });
    const file = join(dir, `${Date.now()}-${d.template}.json`);
    await writeFile(file, JSON.stringify(d, null, 2));
    return { ok: true, detail: file };
  },
};

/** Production: POST the message to a relay you control (an email provider's HTTP API, an SMTP gateway). */
export function webhookTransport(url: string, fetcher: Fetcher = fetch): Transport {
  return {
    channel: "email",
    async send(d) {
      const res = await fetcher(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(d),
        signal: AbortSignal.timeout(10_000),
      });
      return { ok: res.ok, detail: `relay answered ${res.status}` };
    },
  };
}

/** Body of a WhatsApp Business Cloud API template message (https://developers.facebook.com/docs/whatsapp/cloud-api). */
export function whatsappPayload(d: Delivery) {
  const t = WHATSAPP_TEMPLATES[d.template];
  if (!t) return null;
  return {
    messaging_product: "whatsapp",
    to: d.to.replace(/[^\d]/g, ""),
    type: "template",
    template: {
      name: t.name,
      language: { code: t.language },
      components: t.variables.length
        ? [{ type: "body", parameters: t.variables.map((k) => ({ type: "text", text: String(d.vars?.[k] ?? "") })) }]
        : [],
    },
  };
}

export function whatsappTransport(phoneId: string, token: string, fetcher: Fetcher = fetch): Transport {
  return {
    channel: "whatsapp",
    async send(d) {
      const body = whatsappPayload(d);
      if (!body) return { ok: false, detail: `${d.template} has no approved WhatsApp template` };
      const res = await fetcher(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
      return { ok: res.ok, detail: `WhatsApp answered ${res.status}` };
    },
  };
}

export function configuredTransports(): Transport[] {
  const out: Transport[] = [
    env.NOTIFY_EMAIL_WEBHOOK_URL ? webhookTransport(env.NOTIFY_EMAIL_WEBHOOK_URL) : outboxTransport,
  ];
  if (env.WHATSAPP_PHONE_ID && env.WHATSAPP_TOKEN)
    out.push(whatsappTransport(env.WHATSAPP_PHONE_ID, env.WHATSAPP_TOKEN));
  return out;
}
