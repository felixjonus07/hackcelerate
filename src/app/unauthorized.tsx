import { ButtonLink } from "@/components/ui/button";

export default function Unauthorized() {
  return (
    <main className="grid min-h-dvh place-items-center px-5">
      <div className="max-w-[44ch] text-center">
        <h1 className="text-3xl font-black">Please sign in</h1>
        <p className="mt-2 text-ink-2">Your session has ended or you haven't signed in yet.</p>
        <ButtonLink href="/sign-in" className="mt-6">
          Sign in
        </ButtonLink>
      </div>
    </main>
  );
}
