import { describe, expect, test } from "vitest";
import {
  InstanceSubdomainSchema,
  getInstanceSubdomain,
} from "./instanceSubdomain";

describe("instance subdomains", () => {
  test("normalizes a DNS label and retains support for legacy instances", () => {
    expect(InstanceSubdomainSchema.parse(" My-PoC ")).toBe("my-poc");
    expect(InstanceSubdomainSchema.parse("a")).toBe("a");
    expect(InstanceSubdomainSchema.parse("a".repeat(63))).toHaveLength(63);
    expect(getInstanceSubdomain({ id: "original-id" })).toBe("original-id");
    expect(getInstanceSubdomain({ id: "original-id", subdomain: "poc" })).toBe(
      "poc",
    );
  });

  test.each([
    "",
    "-poc",
    "poc-",
    "two.labels",
    "under_score",
    "with space",
    "é",
    "a".repeat(64),
    "www",
    "NS1",
  ])("rejects invalid or reserved label %s", (value) => {
    expect(InstanceSubdomainSchema.safeParse(value).success).toBe(false);
  });
});
