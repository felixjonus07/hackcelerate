import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

/** Shown in place of outputs while the pilot runs in shadow mode (§16.2). */
export function ShadowHold() {
  return (
    <Card>
      <EmptyState title="Your passport is being prepared">
        This pilot is still being checked by the project team before results reach students and mentors. Nothing about
        you has been shared or sent.
      </EmptyState>
    </Card>
  );
}
