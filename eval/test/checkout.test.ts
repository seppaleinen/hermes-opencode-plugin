/**
 * Tests for the checkout / user-creation path.
 *
 * These are the repo's OWN tests — they are the ground truth for the
 * prototype's diagnosis PASS. The harness must NOT see held-out tests; these
 * are exactly the tests the harness runs and reasons over.
 */

import { describe, it, expect } from "vitest";
import { createUser } from "../src/checkout.js";

describe("createUser", () => {
  it("normalizes a valid email", () => {
    const user = createUser("  Foo@Example.COM  ");
    expect(user.email).toBe("foo@example.com");
    expect(user.id).toBe("foo@example.com");
  });

  it("rejects an email with no '@' with a clean Error, not a crash", () => {
    // The seeded bug in validator.ts turns this into a thrown TypeError
    // (null dereference inside normalizeEmail). A correct validator returns
    // null, so createUser throws its own descriptive Error instead.
    expect(() => createUser("not-an-email")).toThrow(Error);
    expect(() => createUser("not-an-email")).not.toThrow(TypeError);
  });
});