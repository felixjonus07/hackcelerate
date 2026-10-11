import { cn } from "@/lib/cn";

/**
 * Score against the readiness target on a 0–100 track. The fill and the target
 * tick glide when values change (what-if). The tick is ink, not saffron:
 * saffron marks actions only.
 */
export function ReadinessBar({
  score,
  readiness,
  className,
  label,
}: {
  score: number;
  readiness: number;
  className?: string;
  label?: string;
}) {
  const s = Math.max(0, Math.min(100, score));
  const r = Math.max(0, Math.min(100, readiness));
  return (
    <div
      role="img"
      aria-label={label ?? `Score ${s.toFixed(1)} of 100; target ${r}`}
      className={cn("relative mt-7", className)}
    >
      <span
        aria-hidden
        className="tabular absolute -top-6 -translate-x-1/2 text-xs font-extrabold transition-[left] duration-500 ease-[var(--ease-out-expo)]"
        style={{ left: `${r}%` }}
      >
        {r}
      </span>
      <div className="relative h-3 rounded-full bg-sand-2">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-ink-2 transition-[width] duration-500 ease-[var(--ease-out-expo)]"
          style={{ width: `${s}%` }}
        />
        <div
          aria-hidden
          className="absolute -top-1.5 h-6 w-1 -translate-x-1/2 rounded-full bg-ink ring-2 ring-card transition-[left] duration-500 ease-[var(--ease-out-expo)]"
          style={{ left: `${r}%` }}
        />
      </div>
    </div>
  );
}
