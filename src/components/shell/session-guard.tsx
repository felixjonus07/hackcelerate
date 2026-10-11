"use client";
/**
 * Session timeout guard (§13.2). Mirrors the server's idle timeout in the
 * browser: warns before sign-out, lets the user stay signed in, and signs out
 * every open tab together when time runs out. The server remains the authority
 * — it revokes idle sessions on the next request regardless of this component.
 */
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

interface Timing {
  idleSeconds: number;
  warningSeconds: number;
  expiresAt: string;
}

type Message = { type: "activity"; deadline: number } | { type: "signout"; reason: string };

const HEARTBEAT_MIN_GAP_MS = 60_000;
const CHANNEL = "aspiredge-session";

const fmt = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export function SessionGuard({ timing }: { timing: Timing }) {
  const router = useRouter();
  const pathname = usePathname();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const stayRef = useRef<HTMLButtonElement>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const deadlineRef = useRef(Date.now() + timing.idleSeconds * 1000);
  const lastBeatRef = useRef(Date.now());
  const endingRef = useRef(false);
  const absoluteEnd = new Date(timing.expiresAt).getTime();
  const [remaining, setRemaining] = useState<number | null>(null);

  const end = useCallback(
    async (reason: string, broadcast = true) => {
      if (endingRef.current) return;
      endingRef.current = true;
      if (broadcast) channelRef.current?.postMessage({ type: "signout", reason } satisfies Message);
      await authClient.signOut().catch(() => undefined);
      router.replace(`/sign-in?reason=${reason}`);
    },
    [router],
  );

  const extend = useCallback((deadline: number) => {
    deadlineRef.current = deadline;
    setRemaining(null);
    if (dialogRef.current?.open) dialogRef.current.close();
  }, []);

  const heartbeat = useCallback(async () => {
    lastBeatRef.current = Date.now();
    const res = await fetch("/api/session/heartbeat", { method: "POST", cache: "no-store" }).catch(() => null);
    if (!res) return;
    if (res.status === 401) return end("idle");
    const body = (await res.json()) as { idleSeconds: number };
    const deadline = Date.now() + body.idleSeconds * 1000;
    extend(deadline);
    channelRef.current?.postMessage({ type: "activity", deadline } satisfies Message);
  }, [end, extend]);

  // Every navigation reaches the server, which renews the idle window.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on route change only
  useEffect(() => {
    lastBeatRef.current = Date.now();
    extend(Date.now() + timing.idleSeconds * 1000);
  }, [pathname, timing.idleSeconds, extend]);

  // Keep every open tab in step: activity in one extends all; sign-out in one ends all.
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel(CHANNEL);
    channelRef.current = ch;
    ch.onmessage = (e: MessageEvent<Message>) => {
      if (e.data.type === "activity") extend(Math.max(deadlineRef.current, e.data.deadline));
      if (e.data.type === "signout") end(e.data.reason, false);
    };
    return () => ch.close();
  }, [end, extend]);

  // Real user activity on the page renews the server window (throttled).
  useEffect(() => {
    const onActivity = () => {
      if (dialogRef.current?.open) return; // during the warning, only the explicit button extends
      if (Date.now() - lastBeatRef.current > HEARTBEAT_MIN_GAP_MS) heartbeat();
    };
    const events = ["pointerdown", "keydown", "scroll", "touchstart"] as const;
    for (const ev of events) window.addEventListener(ev, onActivity, { passive: true });
    return () => {
      for (const ev of events) window.removeEventListener(ev, onActivity);
    };
  }, [heartbeat]);

  // Countdown: warn before the idle deadline or absolute expiry, then sign out.
  useEffect(() => {
    const id = window.setInterval(() => {
      const now = Date.now();
      const idleLeft = deadlineRef.current - now;
      const absoluteLeft = absoluteEnd - now;
      const left = Math.min(idleLeft, absoluteLeft);
      if (left <= 0) {
        end(absoluteLeft <= idleLeft ? "expired" : "idle");
        return;
      }
      if (left <= timing.warningSeconds * 1000) {
        setRemaining(left);
        if (!dialogRef.current?.open) {
          dialogRef.current?.showModal();
          // The safe choice takes focus; Enter keeps the user signed in.
          stayRef.current?.focus();
        }
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [absoluteEnd, timing.warningSeconds, end]);

  const absoluteSoon = absoluteEnd - Date.now() <= timing.warningSeconds * 1000;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="session-warning-title"
      aria-describedby="session-warning-body"
      className="m-auto w-[min(440px,calc(100vw-2rem))] rounded-card bg-card p-6 text-ink shadow-lift backdrop:bg-ink/40"
      onCancel={(e) => e.preventDefault()}
    >
      <h2 id="session-warning-title" className="text-xl font-extrabold">
        {absoluteSoon ? "Your session is ending" : "Are you still there?"}
      </h2>
      <p id="session-warning-body" className="mt-2 text-ink-2">
        {absoluteSoon
          ? "This session has reached its time limit. Save anything you're typing; you'll need to sign in again."
          : "To protect student data, you'll be signed out soon because there's been no activity."}
      </p>
      <p className="tabular mt-4 text-[2rem] font-black leading-none" aria-live="polite" aria-atomic="true">
        {remaining != null ? fmt(remaining) : ""}
      </p>
      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={() => end("signed_out")}>
          Sign out now
        </Button>
        {!absoluteSoon ? (
          <Button ref={stayRef} onClick={() => heartbeat()}>
            Stay signed in
          </Button>
        ) : null}
      </div>
    </dialog>
  );
}
