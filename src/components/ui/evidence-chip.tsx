import { BadgeCheck, CircleSlash, Clock, Link2, PenLine, RotateCcw, Signature } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { VERIFICATION_LABELS } from "@/lib/labels";

/**
 * One verification vocabulary across every screen (surface brief → Unresolved):
 * the icon names the state, the colour only reinforces it.
 */
const MAP: Record<string, { icon: ReactNode; cls: string }> = {
  VERIFIED: {
    icon: <BadgeCheck aria-hidden className="size-4" />,
    cls: "text-low",
  },
  ATTESTED: {
    icon: <Signature aria-hidden className="size-4" />,
    cls: "text-low",
  },
  LIVE_UNVERIFIED: {
    icon: <Link2 aria-hidden className="size-4" />,
    cls: "text-mod",
  },
  SELF_REPORTED: {
    icon: <PenLine aria-hidden className="size-4" />,
    cls: "text-ink-2",
  },
  SUBMITTED: {
    icon: <Clock aria-hidden className="size-4" />,
    cls: "text-ink-2",
  },
  UNDER_CHECK: {
    icon: <Clock aria-hidden className="size-4" />,
    cls: "text-ink-2",
  },
  STALE: {
    icon: <RotateCcw aria-hidden className="size-4" />,
    cls: "text-mod",
  },
  UNVERIFIED: {
    icon: <CircleSlash aria-hidden className="size-4" />,
    cls: "text-crit",
  },
  REJECTED: {
    icon: <CircleSlash aria-hidden className="size-4" />,
    cls: "text-crit",
  },
};

export function EvidenceChip({ status, className }: { status: string; className?: string }) {
  const m = MAP[status] ?? MAP.SUBMITTED;
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-sm font-bold", m.cls, className)}>
      {m.icon}
      {VERIFICATION_LABELS[status] ?? status}
    </span>
  );
}
