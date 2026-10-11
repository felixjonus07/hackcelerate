"use client";
import { cn } from "@/lib/cn";

export function Switch({
  checked,
  onChange,
  label,
  disabled,
  pending,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
  pending?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-busy={pending || undefined}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "press relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-act" : "bg-sand-3",
        pending && "opacity-70",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "inline-block size-5 rounded-full bg-card shadow transition-transform duration-200 ease-[var(--ease-out-expo)]",
          checked ? "translate-x-6" : "translate-x-1",
        )}
      />
    </button>
  );
}
