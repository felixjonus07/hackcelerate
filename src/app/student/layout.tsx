import { AppShell } from "@/components/shell/app-shell";

export default function StudentLayout({ children }: { children: React.ReactNode }) {
  return <AppShell area="student">{children}</AppShell>;
}
