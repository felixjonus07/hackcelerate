import Link from "next/link";
import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "md" | "sm";

const base =
  "press inline-flex items-center justify-center gap-2 rounded-full font-bold whitespace-nowrap select-none disabled:cursor-not-allowed disabled:opacity-50";
const variants: Record<Variant, string> = {
  // Saffron appears only where something can be pressed.
  primary: "bg-act text-act-ink hover:bg-act-hover shadow-[0_6px_16px_-8px_var(--act)]",
  secondary: "bg-sand-2 text-ink hover:bg-sand-3",
  ghost: "text-ink hover:bg-sand-2",
  danger: "bg-card text-crit ring-1 ring-inset ring-line hover:bg-crit-bg",
};
const sizes: Record<Size, string> = {
  md: "h-11 px-5 text-[0.95rem]",
  sm: "h-9 px-4 text-sm",
};

export function buttonClass(variant: Variant = "primary", size: Size = "md", className?: string) {
  return cn(base, variants[variant], sizes[size], className);
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: Variant; size?: Size }) {
  return <button type="button" className={buttonClass(variant, size, className)} {...props} />;
}

export function ButtonLink({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link className={buttonClass(variant, size, className)} {...props} />;
}
