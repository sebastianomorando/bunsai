import { describe, expect, test } from "bun:test";
import {
  parseAssetListQuery,
  parseAssetMetadataInput,
} from "./assetManagement";
describe("asset library validation", () => {
  test("bounds pagination and whitelists filters and sorting", () => {
    const query = (value: string) =>
      parseAssetListQuery(new URL("https://example.test/api/assets?" + value));
    expect(
      query("limit=12&offset=24&type=image&sortBy=size&sortDir=asc").offset,
    ).toBe(24);
    for (const invalid of [
      "limit=101",
      "limit=-1",
      "offset=100001",
      "offset=1.5",
      "sortBy=size;DROP TABLE assets",
      "sortDir=sideways",
      "type=secret",
      "q=" + "a".repeat(101),
      "q=%00",
    ])
      expect(() => query(invalid)).toThrow();
    expect(query("q=%25_%27").q).toBe("%_'");
  });
  test("metadata accepts only bounded display fields and an optimistic revision", () => {
    const valid = { title: " Name ", filename: "photo.png", version: "123" };
    expect(parseAssetMetadataInput(valid)).toEqual({
      title: "Name",
      filename: "photo.png",
      version: "123",
    });
    for (const field of [
      "storage_key",
      "storage_backend",
      "uploaded_by",
      "mimeType",
      "url",
      "size",
    ])
      expect(() =>
        parseAssetMetadataInput({ ...valid, [field]: "injected" }),
      ).toThrow();
    for (const filename of [
      "../x",
      "a/b",
      "a\\b",
      "a\n.txt",
      "",
      "x".repeat(256),
    ])
      expect(() => parseAssetMetadataInput({ ...valid, filename })).toThrow();
    for (const version of [undefined, null, 1, "1 OR true", "-1"])
      expect(() => parseAssetMetadataInput({ ...valid, version })).toThrow();
    expect(() =>
      parseAssetMetadataInput({ ...valid, title: "Header\r\nx" }),
    ).toThrow();
  });
});
