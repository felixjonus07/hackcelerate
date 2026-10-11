"use client";
/** Digest channels (§10.1): email is on by default; WhatsApp is off until the person adds their own number. */
import { useState, useTransition } from "react";
import { savePreference } from "@/app/account/actions";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/cn";

export function NotificationPreferences({
  email,
  whatsapp,
  phone,
}: {
  email: boolean;
  whatsapp: boolean;
  phone: string | null;
}) {
  const [pending, start] = useTransition();
  const [emailOn, setEmailOn] = useState(email);
  const [waOn, setWaOn] = useState(whatsapp);
  const [number, setNumber] = useState(phone ?? "");
  const [msg, setMsg] = useState<{ ok: boolean; message: string } | null>(null);

  const save = (channel: "email" | "whatsapp", on: boolean, p?: string) =>
    start(async () => {
      const r = await savePreference(channel, on, p);
      setMsg(r);
      if (r.ok) (channel === "email" ? setEmailOn : setWaOn)(on);
    });

  return (
    <Card>
      <CardHeader title="Weekly summary" hint="One short message a week, never one per event." />
      <div className="grid gap-3">
        <div className="flex items-center justify-between gap-4 rounded-2xl bg-sand px-4 py-3">
          <span className="font-semibold">Email</span>
          <Switch
            label="Send my weekly summary by email"
            checked={emailOn}
            pending={pending}
            onChange={(v) => save("email", v)}
          />
        </div>
        <div className="grid gap-3 rounded-2xl bg-sand px-4 py-3">
          <div className="flex items-center justify-between gap-4">
            <span className="font-semibold">WhatsApp</span>
            <Switch
              label="Send my weekly summary on WhatsApp"
              checked={waOn}
              pending={pending}
              onChange={(v) => (v ? setWaOn(true) : save("whatsapp", false))}
            />
          </div>
          {waOn ? (
            <div className="flex flex-wrap items-end gap-3">
              <label className="grid gap-1.5 text-sm font-bold">
                Your WhatsApp number
                <input
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={number}
                  onChange={(e) => setNumber(e.target.value)}
                  placeholder="+91 …"
                  className="tabular h-11 w-56 rounded-field border border-line bg-card px-3.5 text-base font-normal"
                />
              </label>
              <Button size="sm" disabled={pending || !number} onClick={() => save("whatsapp", true, number)}>
                Save number
              </Button>
            </div>
          ) : null}
          <p className="text-sm text-ink-2">
            Off unless you turn it on. Only your number is stored, and only while it is on.
          </p>
        </div>
        {msg ? (
          <output className={cn("text-sm font-semibold", msg.ok ? "text-low" : "text-crit")}>{msg.message}</output>
        ) : null}
      </div>
    </Card>
  );
}
