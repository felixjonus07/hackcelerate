import { ButtonLink } from "@/components/ui/button";

export default function Forbidden() {
  return (
    <main className="grid min-h-dvh place-items-center px-5">
      <div className="max-w-[44ch] text-center">
        <h1 className="text-3xl font-black">This page isn't part of your role</h1>
        <p className="mt-2 text-ink-2">
          Your account can't open this view. If you think it should, ask the registrar to check your role.
        </p>
        <ButtonLink href="/sign-in" variant="secondary" className="mt-6">
          Go to sign in
        </ButtonLink>
      </div>
    </main>
  );
}
