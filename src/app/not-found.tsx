import { ButtonLink } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-5">
      <div className="max-w-[44ch] text-center">
        <h1 className="text-3xl font-black">We couldn't find that page</h1>
        <p className="mt-2 text-ink-2">The link may be old, or the record may have moved.</p>
        <ButtonLink href="/" variant="secondary" className="mt-6">
          Back to start
        </ButtonLink>
      </div>
    </main>
  );
}
