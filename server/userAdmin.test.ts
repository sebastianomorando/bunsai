import { describe, expect, test } from "bun:test";
import {
  accountFields,
  inviteFields,
  invitationToken,
  userAdminFields,
} from "./userAdmin";
import {
  createInvitationToken,
  hashInvitationToken,
  invitationMessage,
  invitationUrl,
} from "./invitations";
describe("user management input and invitation security", () => {
  test("strict fields reject privilege injection and normalize identity", () => {
    expect(() =>
      userAdminFields({ token: "x", role: "admin" }, ["token"]),
    ).toThrow();
    expect(
      accountFields({
        username: " user ",
        email: " USER@EXAMPLE.TEST ",
        isActive: true,
      }),
    ).toMatchObject({
      username: "user",
      email: "user@example.test",
      role: "user",
    });
    for (const input of [
      { username: "ab", email: "a@example.test", isActive: true },
      { username: "valid", email: "bad", isActive: true },
      { username: "valid", email: "a@example.test", isActive: "true" },
      {
        username: "valid",
        email: "a@example.test",
        isActive: true,
        role: "root",
      },
    ])
      expect(() => accountFields(input)).toThrow();
    expect(() =>
      inviteFields({ email: "a@example.test", locale: "xx" }),
    ).toThrow();
  });
  test("tokens contain 256 bits of randomness and only hashes are persisted", () => {
    const a = createInvitationToken(),
      b = createInvitationToken();
    expect(a).not.toBe(b);
    expect(invitationToken(a)).toBe(a);
    expect(hashInvitationToken(a)).toHaveLength(64);
    for (const input of ["", null, "a".repeat(42), "a".repeat(44), "<script>"])
      expect(() => invitationToken(input)).toThrow();
  });
  test("links use fragments and escape HTML", () => {
    const old = process.env.APP_URL;
    try {
      process.env.APP_URL = "http://localhost:3030";
      const url = invitationUrl(createInvitationToken());
      expect(new URL(url).search).toBe("");
      expect(new URL(url).pathname).toBe("/accept-invitation");
      expect(
        invitationMessage('https://example.test/"<test>', "en").html,
      ).toContain("&quot;&lt;test&gt;");
    } finally {
      if (old === undefined) delete process.env.APP_URL;
      else process.env.APP_URL = old;
    }
  });
});
