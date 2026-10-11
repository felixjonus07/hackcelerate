import { cn } from "@/lib/cn";

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-2xl bg-sand-2", className)} />;
}

export function CardSkeleton({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div aria-hidden className={cn("rounded-card bg-card p-6 shadow-card", className)}>
      <Skeleton className="mb-5 h-4 w-1/3" />
      {Array.from({ length: lines }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder rows
        <Skeleton key={i} className="mb-3 h-3.5 w-full last:w-2/3" />
      ))}
    </div>
  );
}

export function PageSkeleton() {
  return (
    <output aria-label="Loading" className="grid gap-5 lg:grid-cols-2">
      <Skeleton className="h-9 w-2/3 lg:col-span-2" />
      <CardSkeleton lines={4} />
      <CardSkeleton lines={4} />
      <CardSkeleton lines={3} />
      <CardSkeleton lines={3} />
    </output>
  );
}
