import { describe, expect, test } from "vitest";
import {
  PathResponsesSchema,
  ResponsePathSchema,
  MAX_PATH_RESPONSES,
} from "./pathResponses";

describe("path response contracts", () => {
  test.each(["/", "/callback", "/Callback/", "/a%2Fb", "/a/../b", "//double"])(
    "preserves an exact path: %s",
    (path) => {
      expect(ResponsePathSchema.parse(path)).toBe(path);
    },
  );
  test.each([
    "",
    "relative",
    "/with space",
    "/line\nbreak",
    "/trailing\n",
    "/control\u0000",
    "/path?query=1",
    "/path#fragment",
    "/" + "a".repeat(2048),
  ])("rejects invalid path: %s", (path) => {
    expect(ResponsePathSchema.safeParse(path).success).toBe(false);
  });
  test("rejects duplicates and too many paths, but keeps case distinct", () => {
    const entry = { path: "/callback", raw: "response" };
    expect(PathResponsesSchema.safeParse([entry, entry]).success).toBe(false);
    expect(
      PathResponsesSchema.safeParse([entry, { ...entry, path: "/Callback" }])
        .success,
    ).toBe(true);
    expect(
      PathResponsesSchema.safeParse(
        Array.from({ length: MAX_PATH_RESPONSES + 1 }, (_, index) => ({
          ...entry,
          path: `/${index}`,
        })),
      ).success,
    ).toBe(false);
  });
});
