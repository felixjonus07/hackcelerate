"use client";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { changePassword } from "../actions";

const field = "h-11 rounded-field border border-line bg-card px-3.5 text-base font-normal";

export function PasswordForm() {
  const [state, action, pending] = useActionState(changePassword, null);
  return (
    <form action={action} className="grid max-w-[640px] gap-3 sm:grid-cols-3">
      <label className="grid gap-1.5 text-sm font-bold">
        Current password
        <input name="currentPassword" type="password" required autoComplete="current-password" className={field} />
      </label>
      <label className="grid gap-1.5 text-sm font-bold">
        New password
        <input
          name="newPassword"
          type="password"
          required
          minLength={12}
          maxLength={128}
          autoComplete="new-password"
          className={field}
        />
      </label>
      <label className="grid gap-1.5 text-sm font-bold">
        Repeat new password
        <input
          name="confirm"
          type="password"
          required
          minLength={12}
          maxLength={128}
          autoComplete="new-password"
          className={field}
        />
      </label>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Changing…" : "Change password"}
        </Button>
        {state ? (
          <output className={cn("text-sm font-semibold", state.ok ? "text-low" : "text-crit")}>{state.message}</output>
        ) : null}
      </div>
    </form>
  );
}
