"use client";
import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { authClient } from "@/lib/auth-client";

export function SignOutButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await authClient.signOut();
          router.replace("/sign-in?reason=signed_out");
        })
      }
      className="press inline-flex size-9 items-center justify-center rounded-full text-ink-2 hover:bg-sand-2 hover:text-ink"
      aria-label="Sign out"
      title="Sign out"
    >
      <LogOut aria-hidden className="size-4" />
    </button>
  );
}
