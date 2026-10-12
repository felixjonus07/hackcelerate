/**
 * Seeded demo accounts all live on one reserved, non-routable domain. Password sign-in for them follows
 * DEMO_LOGIN_ENABLED; nobody may register an address on it.
 */
export const DEMO_EMAIL_DOMAIN = "aspiredge.example";

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export const isDemoEmail = (email: string) => normalizeEmail(email).endsWith(`@${DEMO_EMAIL_DOMAIN}`);
