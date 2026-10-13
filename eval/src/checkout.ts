/**
 * Checkout / user creation.
 *
 * FILE B — the caller component. This file is CORRECT; it is the consumer
 * that exposes the bug in FILE A through its test.
 *
 * It depends on validator.ts (normalizeEmail) — that dependency edge is the
 * one the message bus must route across during the prototype's revision
 * round.
 */

import { normalizeEmail } from "./validator.js";

export interface User {
  id: string;
  email: string;
}

export function createUser(rawEmail: string): User {
  const email = normalizeEmail(rawEmail);

  // normalizeEmail is documented to return null for invalid input. A correct
  // validator lets this branch handle it gracefully; the seeded bug in
  // validator.ts turns this into a thrown TypeError instead.
  if (email == null) {
    throw new Error(`Invalid email address: ${rawEmail}`);
  }

  return { id: email, email };
}