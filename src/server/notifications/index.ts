/**
 * Notification service (§10.1): weekly digests by email and opt-in WhatsApp
 * templates. Phase 8. Only APPROVED interventions may be dispatched.
 */
export interface Notifier {
  send(
    to: { userId: string; channel: "email" | "whatsapp" },
    template: string,
    vars: Record<string, string>,
  ): Promise<void>;
}

export const notifier: Notifier = {
  async send() {
    throw new Error("Notifications are not configured yet (PLAN.md Phase 8)");
  },
};
