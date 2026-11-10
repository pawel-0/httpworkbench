import { describe, expect, it } from "vitest";
import { getLogSummary } from "./getLogSummary";

describe("getLogSummary", () => {
  it("keeps the HTTP method and request target including query parameters", () => {
    expect(
      getLogSummary({
        type: "http",
        raw: "POST /test%20path?q=1 HTTP/1.1\r\nHost: example.com",
      }),
    ).toBe("POST /test%20path?q=1");
  });
  it("summarizes DNS query types and names", () => {
    for (const type of ["A", "AAAA", "MX"]) {
      expect(
        getLogSummary({
          type: "dns",
          raw: `QNAME: demo.example.com\nQTYPE: ${type}\nQCLASS: IN`,
        }),
      ).toBe(`${type} demo.example.com`);
    }
  });
  it("puts the SMTP recipient before the sender and preserves empty senders", () => {
    expect(
      getLogSummary({
        type: "smtp",
        raw: "MAIL FROM: <>\r\nRCPT TO: <recipient@example.com>\r\n\r\nSubject: Test",
      }),
    ).toBe("To: <recipient@example.com> · From: <>");
  });
  it("does not mistake message content for an SMTP envelope", () => {
    expect(
      getLogSummary({
        type: "smtp",
        raw: "CLIENT: 192.0.2.1\n\nMAIL FROM: <forged@example.com>\nRCPT TO: <body@example.com>",
      }),
    ).toBe("SMTP message");
  });
  it("handles missing and malformed fields", () => {
    expect(getLogSummary({ type: "http", raw: "invalid" })).toBe(
      "HTTP request",
    );
    expect(getLogSummary({ type: "dns", raw: "QTYPE: TXT" })).toBe("TXT");
    expect(getLogSummary({ type: "dns", raw: "" })).toBe("DNS query");
    expect(
      getLogSummary({ type: "smtp", raw: "RCPT TO: <only@example.com>" }),
    ).toBe("To: <only@example.com>");
  });
});
