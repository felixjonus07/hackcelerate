import type { ReactNode } from "react";

/** Empty states teach the interface (§12.3 empty/error column). */
export function EmptyState({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-2xl bg-sand px-5 py-6 text-center">
      <p className="font-extrabold">{title}</p>
      <div className="mx-auto mt-1 max-w-[46ch] text-sm text-ink-2">{children}</div>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}
