import { AlertTriangle, ArrowDownRight, ArrowRight, ArrowUpRight, CircleCheck, CircleDot, Clock } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { GAP_STAFF, GAP_STUDENT, type GapLevel, TREND_SHORT } from "@/lib/labels";

const tone = {
  low: "bg-low-bg text-low",
  mod: "bg-mod-bg text-mod",
  crit: "bg-crit-bg text-crit",
  neutral: "bg-sand-2 text-ink-2",
} as const;

export function Tag({
  children,
  kind = "neutral",
  icon,
  className,
}: {
  children: ReactNode;
  kind?: keyof typeof tone;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[0.8rem] font-bold leading-none",
        tone[kind],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

const GAP_KIND: Record<GapLevel, keyof typeof tone> = {
  LOW: "low",
  MODERATE: "mod",
  CRITICAL: "crit",
};
const GAP_ICON: Record<GapLevel, ReactNode> = {
  LOW: <CircleCheck aria-hidden className="size-3.5" />,
  MODERATE: <CircleDot aria-hidden className="size-3.5" />,
  CRITICAL: <AlertTriangle aria-hidden className="size-3.5" />,
};

/** AEG level: text + icon + colour, never colour alone (§12.4). */
export function GapTag({ level, audience = "student" }: { level: GapLevel; audience?: "student" | "staff" }) {
  return (
    <Tag kind={GAP_KIND[level]} icon={GAP_ICON[level]}>
      {audience === "student" ? GAP_STUDENT[level] : GAP_STAFF[level]}
    </Tag>
  );
}

export function TrendTag({ trend }: { trend: string }) {
  const icon =
    trend === "IMPROVING" ? (
      <ArrowUpRight aria-hidden className="size-3.5" />
    ) : trend === "WORSENING" ? (
      <ArrowDownRight aria-hidden className="size-3.5" />
    ) : trend === "STABLE" ? (
      <ArrowRight aria-hidden className="size-3.5" />
    ) : (
      <Clock aria-hidden className="size-3.5" />
    );
  return (
    <Tag kind={trend === "WORSENING" ? "crit" : trend === "IMPROVING" ? "low" : "neutral"} icon={icon}>
      {TREND_SHORT[trend] ?? trend}
    </Tag>
  );
}
