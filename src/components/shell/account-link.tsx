import { ShieldCheck } from "lucide-react";
import Link from "next/link";

export function AccountLink() {
  return (
    <Link
      href="/account/security"
      className="press inline-flex size-9 items-center justify-center rounded-full text-ink-2 hover:bg-sand-2 hover:text-ink"
      aria-label="Account security"
      title="Account security"
    >
      <ShieldCheck aria-hidden className="size-4" />
    </Link>
  );
}
