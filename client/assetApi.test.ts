import { afterEach, expect, test } from "bun:test";
import { fetchAssets, updateAsset } from "./api";
import { assetsState, pendingState, sessionState } from "./state";
const original = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = original;
  sessionState.value = null;
  assetsState.value = [];
  pendingState.value = false;
});
test("asset responses from a previous account cannot populate the library", async () => {
  let resolve!: (response: Response) => void;
  globalThis.fetch = (() =>
    new Promise<Response>((r) => (resolve = r))) as unknown as typeof fetch;
  sessionState.value = { userId: "old", expiresAt: null };
  const pending = fetchAssets();
  sessionState.value = { userId: "new", expiresAt: null };
  resolve(Response.json({ items: [{ id: "private-old" }] }));
  await pending;
  expect(assetsState.value).toEqual([]);
});
test("a late filtered asset query cannot overwrite a newer query", async () => {
  const resolves: Array<(response: Response) => void> = [];
  globalThis.fetch = (() =>
    new Promise<Response>((r) => resolves.push(r))) as unknown as typeof fetch;
  sessionState.value = { userId: "same", expiresAt: null };
  const first = fetchAssets({ q: "first" }),
    second = fetchAssets({ q: "second" });
  resolves[1]!(Response.json({ items: [{ id: "latest" }] }));
  await second;
  resolves[0]!(Response.json({ items: [{ id: "stale" }] }));
  await first;
  expect(assetsState.value[0]?.id).toBe("latest");
});
test("a late metadata update cannot replace a new account asset", async () => {
  let resolve!: (response: Response) => void;
  globalThis.fetch = (() =>
    new Promise<Response>((r) => (resolve = r))) as unknown as typeof fetch;
  sessionState.value = { userId: "old", expiresAt: null };
  const pending = updateAsset("id", {
    title: null,
    filename: "file",
    version: "1",
  });
  sessionState.value = { userId: "new", expiresAt: null };
  resolve(Response.json({ id: "id", filename: "old-file" }));
  await pending;
  expect(assetsState.value).toEqual([]);
});
