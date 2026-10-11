import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

/** One idea per card. Never nest cards. */
export function Card({ className, ...props }: ComponentProps<"section">) {
  return <section className={cn("min-w-0 rounded-card bg-card p-5 shadow-card sm:p-6", className)} {...props} />;
}

export function CardHeader({ title, action, hint }: { title: ReactNode; action?: ReactNode; hint?: ReactNode }) {
  return (
    <header className="mb-4 flex items-start justify-between gap-3">
      <div>
        <h2 className="text-[1.05rem] font-extrabold leading-snug">{title}</h2>
        {hint ? <p className="mt-0.5 text-sm text-ink-2">{hint}</p> : null}
      </div>
      {action}
    </header>
  );
}
