"use client";
/** Registrar tools on /admin/users: add a staff member, and change one account. Each action is audited server side. */
import { useActionState, useEffect, useRef } from "react";
import { addStaffUser, changeUserRole, signOutUserEverywhere, toggleUserAccount } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";

type RoleOption = { value: string; label: string };
type Result = { ok: boolean; message: string } | null;

const field = "h-11 rounded-field border border-line bg-card px-3.5 text-base font-normal";

function Message({ state }: { state: Result }) {
  if (!state) return null;
  return state.ok ? (
    <output className="block text-sm font-semibold text-low">{state.message}</output>
  ) : (
    <p role="alert" className="text-sm font-semibold text-crit">
      {state.message}
    </p>
  );
}

export function AddStaffForm({ roles }: { roles: RoleOption[] }) {
  const [state, action, pending] = useActionState(addStaffUser, null);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) form.current?.reset();
  }, [state]);
  return (
    <form ref={form} action={action} className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5 text-sm font-bold">
          Full name
          <input name="name" required minLength={2} maxLength={80} autoComplete="off" className={field} />
        </label>
        <label className="grid gap-1.5 text-sm font-bold">
          Email
          <input name="email" type="email" required maxLength={254} autoComplete="off" className={field} />
        </label>
        <label className="grid gap-1.5 text-sm font-bold">
          Role
          <select name="role" required defaultValue="" className={field}>
            <option value="" disabled>
              Choose a role
            </option>
            {roles.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1.5 text-sm font-bold">
          First password
          <input
            name="password"
            type="password"
            required
            minLength={12}
            maxLength={128}
            autoComplete="new-password"
            className={field}
          />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Adding…" : "Add staff member"}
        </Button>
        <Message state={state} />
      </div>
    </form>
  );
}

/** One form per account so a single message line reports the last action. */
export function UserActions({
  id,
  role,
  off,
  isStudent,
  roles,
}: {
  id: string;
  role: string;
  off: boolean;
  isStudent: boolean;
  roles: RoleOption[];
}) {
  const [state, action, pending] = useActionState(async (_prev: Result, form: FormData): Promise<Result> => {
    const intent = form.get("intent");
    if (intent === "role") return changeUserRole(null, form);
    if (intent === "toggle") return toggleUserAccount(null, form);
    return signOutUserEverywhere(null, form);
  }, null);
  return (
    <form action={action} className="grid gap-2 lg:justify-items-end">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="off" value={off ? "no" : "yes"} />
      <div className="flex flex-wrap items-center gap-2 lg:justify-end">
        {isStudent ? null : (
          <>
            <select
              name="role"
              defaultValue={role}
              aria-label="Role"
              className="h-9 rounded-field border border-line bg-card px-3 text-sm"
            >
              {roles.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
            <Button type="submit" name="intent" value="role" variant="secondary" size="sm" disabled={pending}>
              Save role
            </Button>
          </>
        )}
        <Button
          type="submit"
          name="intent"
          value="toggle"
          variant={off ? "secondary" : "danger"}
          size="sm"
          disabled={pending}
        >
          {off ? "Turn on" : "Turn off"}
        </Button>
        <Button type="submit" name="intent" value="signout" variant="ghost" size="sm" disabled={pending}>
          Sign out everywhere
        </Button>
      </div>
      <Message state={state} />
    </form>
  );
}
