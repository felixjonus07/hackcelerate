/** Resolves the authenticated student for /students/me/* (path ids are ignored, §11). */
import "server-only";
import { eq } from "drizzle-orm";
import { requireApiUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { students } from "@/server/db/schema";
import { AccessDenied } from "@/server/services/students";

export async function meStudent() {
  const user = await requireApiUser(["student"]);
  const [student] = await db.select().from(students).where(eq(students.userId, user.id)).limit(1);
  if (!student) throw new AccessDenied("No student record is linked to this account");
  return { user, student };
}
