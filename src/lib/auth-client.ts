"use client";
import { createAuthClient } from "better-auth/react";

/** Generic OIDC providers register as social providers: use signIn.social({ provider }). */
export const authClient = createAuthClient();
