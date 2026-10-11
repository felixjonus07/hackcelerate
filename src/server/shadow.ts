/**
 * Shadow mode (§16.2). The system scores every student in the pilot cohort, but its outputs are visible only to
 * the project team; mentors and students see nothing of it, and nothing is dispatched. The project team compares
 * the system's personas and routes with what mentors actually did (§15.4, `rules/agreement.ts`).
 */
import { env } from "./env";

export const shadowMode = env.SHADOW_MODE;

const team = new Set(
  env.PROJECT_TEAM_EMAILS.split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
);

export function isProjectTeam(user: { email: string }): boolean {
  return team.has(user.email.toLowerCase());
}

/** In shadow mode only the project team may see outputs; otherwise everyone allowed by their role may. */
export function mayViewOutputs(user: { email: string }, shadow = shadowMode): boolean {
  return !shadow || isProjectTeam(user);
}
