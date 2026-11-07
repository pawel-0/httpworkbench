import { describe, expect, test } from "bun:test";
import {
  getRequestPath,
  adjustContentLength,
  getHeaderValue,
  parseInstanceIdFromHost,
  stripInternalHeaders,
} from "./utils";

describe("getRequestPath", () => {
  test("ignores query strings without normalizing path bytes", () => {
    for (const path of ["/", "/Callback/", "/a%2Fb", "/a/../b", "//double"]) {
      expect(
        getRequestPath(
          `GET ${path}?q=/other HTTP/1.1\r\nHost: example.com\r\n\r\n`,
        ),
      ).toBe(path);
    }
    expect(getRequestPath("POST /callback HTTP/1.0\r\n\r\n")).toBe("/callback");
  });
  test("supports absolute-form requests and falls back for non-path targets", () => {
    expect(
      getRequestPath("GET http://example.com/a/../b?x=1 HTTP/1.1\r\n\r\n"),
    ).toBe("/a/../b");
    expect(getRequestPath("GET https://example.com?x=1 HTTP/1.1\r\n\r\n")).toBe(
      "/",
    );
    expect(getRequestPath("OPTIONS * HTTP/1.1\r\n\r\n")).toBeUndefined();
    expect(
      getRequestPath("CONNECT example.com:443 HTTP/1.1\r\n\r\n"),
    ).toBeUndefined();
    expect(getRequestPath("malformed request")).toBeUndefined();
  });
});

describe("parseInstanceIdFromHost", () => {
  test("extracts the instance id from an instances subdomain host", () => {
    expect(
      parseInstanceIdFromHost(
        "demo.instances.example.com",
        "instances.example.com",
      ),
    ).toEqual({
      kind: "ok",
      instanceId: "demo",
    });
  });

  test("uses the last host label before instances domain as instance id", () => {
    expect(
      parseInstanceIdFromHost(
        "team.demo.instances.example.com",
        "instances.example.com",
      ),
    ).toEqual({
      kind: "ok",
      instanceId: "demo",
    });
  });

  test("ignores a host port when extracting the instance id", () => {
    expect(
      parseInstanceIdFromHost(
        "demo.instances.example.com:443",
        "instances.example.com",
      ),
    ).toEqual({
      kind: "ok",
      instanceId: "demo",
    });
  });

  test("returns an error when host does not belong to instances subdomain", () => {
    expect(
      parseInstanceIdFromHost("demo.api.example.com", "instances.example.com"),
    ).toEqual({
      kind: "error",
      error: "Host does not end with instances domain",
    });
  });

  test("returns an error when instance id is missing", () => {
    expect(
      parseInstanceIdFromHost("instances.example.com", "instances.example.com"),
    ).toEqual({
      kind: "error",
      error: "Host is empty",
    });
  });
});

describe("stripInternalHeaders", () => {
  test("removes selected headers case-insensitively", () => {
    const rawRequest = [
      "GET / HTTP/1.1",
      "Host: demo.instances.example.com",
      "X-Internal-Real-IP: 127.0.0.1",
      "x-internal-debug-id: test",
      "",
      "",
    ].join("\r\n");

    const stripped = stripInternalHeaders(rawRequest, [
      "x-internal-real-ip",
      "x-internal-debug-id",
    ]);

    expect(stripped).not.toContain("X-Internal-Real-IP");
    expect(stripped).not.toContain("x-internal-debug-id");
    expect(stripped).toContain("Host: demo.instances.example.com");
  });
});

describe("getHeaderValue", () => {
  test("reads header values case-insensitively", () => {
    const rawRequest = [
      "GET / HTTP/1.1",
      "HOST: demo.instances.example.com",
      "X-Test: value",
      "",
      "",
    ].join("\r\n");

    expect(getHeaderValue(rawRequest, "host")).toBe(
      "demo.instances.example.com",
    );
    expect(getHeaderValue(rawRequest, "x-test")).toBe("value");
  });

  test("reads headers from partial requests without a header terminator", () => {
    const rawRequest =
      "POST / HTTP/1.1\r\nHost: demo.instances.example.com\r\nContent-Length: 42";

    expect(getHeaderValue(rawRequest, "host")).toBe(
      "demo.instances.example.com",
    );
  });
});

describe("adjustContentLength", () => {
  test("updates content-length to the body byte size", () => {
    const body = "hello🙂";
    const raw = [
      "HTTP/1.1 200 OK",
      "Content-Type: text/plain",
      "Content-Length: 0",
      "",
      body,
    ].join("\r\n");

    const adjusted = adjustContentLength(raw);
    const expectedLength = new TextEncoder().encode(body).length;

    expect(adjusted).toContain(`Content-Length: ${expectedLength}`);
  });

  test("preserves LF line endings inside the body", () => {
    const body =
      "<!doctype html>\n<html>\n<body>\nline1\nline2\n</body>\n</html>";
    const raw = ["HTTP/1.1 200 OK", "Content-Type: text/html", "", body].join(
      "\r\n",
    );

    const adjusted = adjustContentLength(raw);

    expect(adjusted.endsWith(body)).toBe(true);
    expect(adjusted).toContain(
      `Content-Length: ${new TextEncoder().encode(body).length}`,
    );
  });

  test("supports LF-delimited headers without rewriting the body", () => {
    const body = "hello\nworld";
    const raw = ["HTTP/1.1 200 OK", "Content-Type: text/plain", "", body].join(
      "\n",
    );

    const adjusted = adjustContentLength(raw);

    expect(adjusted.endsWith(body)).toBe(true);
    expect(adjusted).toContain(
      `Content-Length: ${new TextEncoder().encode(body).length}`,
    );
  });

  test("returns raw response unchanged if no body separator exists", () => {
    const raw = "HTTP/1.1 204 No Content\r\nContent-Length: 0";
    expect(adjustContentLength(raw)).toBe(raw);
  });
});
