import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConnection } from "node:net";
import { Elysia } from "elysia";
import { MAX_PATH_RESPONSES, type PathResponse } from "shared";

process.env.AUTH_MODE = "password";
process.env.JWT_SECRET = "path-responses-test-secret";
process.env.INSTANCES_DOMAIN = "instances.example.com";
const storage = await import("../../storage");
const { instancePathResponses } = await import("../../storage/schema");
const { instancePolicies } = await import("../../config");
const { instancesRoutes } = await import("./instances");
const { issueAuthToken } = await import("../auth");
const { createApiKeyForUser } = await import("../apiKeyAuth");
const { createInstance, replaceInstance, createGuestInstance } =
  await import("../instances/service");
const { createInstancesServer } = await import("../instances/server");
const raw = "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\r\ndefault";
const override =
  'HTTP/1.1 201 Created\r\nContent-Type: application/json\r\nX-Override: yes\r\n\r\n{"matched":true}';
let dataDir = "";
let userId = "";
let token = "";
const app = new Elysia().use(instancesRoutes);

const call = (id: string, pathResponses: PathResponse[], auth = token) =>
  app.handle(
    new Request(`http://example.com/api/instances/${id}/path-responses`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        ...(auth ? { authorization: `Bearer ${auth}` } : {}),
      },
      body: JSON.stringify({ pathResponses }),
    }),
  );
const makeInstance = (pathResponses: PathResponse[] = []) => {
  const result = createInstance({ ownerId: userId, raw, pathResponses });
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};
const request = (port: number, id: string, target: string, method = "GET") =>
  new Promise<string>((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    let result = "";
    socket.setTimeout(2000, () => {
      socket.destroy();
      reject(new Error("Request timed out"));
    });
    socket.on("error", reject);
    socket.on("data", (chunk) => {
      result += chunk.toString();
    });
    socket.on("end", () => resolve(result));
    socket.on("connect", () =>
      socket.write(
        `${method} ${target} HTTP/1.1\r\nHost: ${id}.instances.example.com\r\nContent-Length: 0\r\n\r\n`,
      ),
    );
  });

describe("path-specific responses", () => {
  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "httpworkbench-paths-"));
    const initialized = storage.initDb({ dataDir, reset: true });
    if (initialized.kind === "error") throw initialized.error;
    const credentials = storage.setLocalPassword("owner", "unused-in-tests");
    userId = credentials.userId;
    token = await issueAuthToken(userId, {
      passwordRevision: credentials.revision,
    });
  });
  afterEach(() => {
    storage.closeDb();
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("matches exact paths across methods and falls back for everything else", async () => {
    const instance = makeInstance([
      { path: "/callback", raw: override },
      { path: "/a%2Fb", raw: override },
      { path: "/a/../b", raw: override },
    ]);
    const server = createInstancesServer(0);
    try {
      for (const target of [
        "/",
        "/missing.js",
        "/callback/",
        "/Callback",
        "/callback/child",
        "/a/b",
        "/b",
      ]) {
        const response = await request(server.port, instance.id, target);
        expect(response).toContain("200 OK");
        expect(response).toEndWith("default");
        expect(response).not.toContain("X-Override");
      }
      for (const target of [
        "/callback",
        "/callback?x=1",
        "/a%2Fb",
        "/a/../b",
        "http://example.com/callback?q=1",
      ]) {
        const response = await request(server.port, instance.id, target);
        expect(response).toContain("201 Created");
        expect(response).toContain("Content-Type: application/json");
        expect(response).toContain("X-Override: yes");
        expect(response).toContain("Content-Length: 16");
        expect(response).toEndWith('{"matched":true}');
      }
      expect(
        await request(server.port, instance.id, "/callback?post=1", "POST"),
      ).toContain("201 Created");
      const logs = storage.getLogsForInstancePage({
        instanceId: instance.id,
        limit: 30,
      }).logs;
      expect(logs).toHaveLength(13);
      expect(logs.every((log) => log.instanceId === instance.id)).toBe(true);
    } finally {
      server.stop(true);
    }
  });

  test("serves updated overrides immediately and restores fallback after deletion", async () => {
    const instance = makeInstance();
    const server = createInstancesServer(0);
    try {
      expect(await request(server.port, instance.id, "/callback")).toEndWith(
        "default",
      );
      expect(
        (await call(instance.id, [{ path: "/callback", raw: override }]))
          .status,
      ).toBe(200);
      expect(await request(server.port, instance.id, "/callback")).toContain(
        "201 Created",
      );
      const changed = override
        .replace("201 Created", "202 Accepted")
        .replace('{"matched":true}', "updated");
      expect(
        (await call(instance.id, [{ path: "/callback", raw: changed }])).status,
      ).toBe(200);
      expect(await request(server.port, instance.id, "/callback")).toContain(
        "202 Accepted",
      );
      expect(await request(server.port, instance.id, "/unknown")).toEndWith(
        "default",
      );
      expect((await call(instance.id, [])).status).toBe(200);
      expect(await request(server.port, instance.id, "/callback")).toEndWith(
        "default",
      );
    } finally {
      server.stop(true);
    }
  });

  test("preserves overrides when only the default response or metadata changes", () => {
    const instance = makeInstance([{ path: "/callback", raw: override }]);
    const updated = replaceInstance({
      instanceId: instance.id,
      ownerId: userId,
      raw: raw.replace("default", "changed"),
    });
    expect(updated.ok && updated.value.pathResponses).toEqual(
      instance.pathResponses,
    );
    storage.updateInstance(instance.id, (current) => ({
      ...current,
      label: "Label",
      locked: true,
      public: true,
    }));
    expect(storage.getInstanceById(instance.id)?.pathResponses).toEqual(
      instance.pathResponses,
    );
    const clone = createInstance({
      ownerId: userId,
      raw: instance.raw,
      pathResponses: instance.pathResponses,
    });
    expect(clone.ok && clone.value.pathResponses).toEqual(
      instance.pathResponses,
    );
    expect(storage.getInstanceSummariesByOwner(userId)[0]).not.toHaveProperty(
      "pathResponses",
    );
  });

  test("rejects invalid or duplicate paths, bad HTTP responses, and combined size overflow atomically", async () => {
    const instance = makeInstance([{ path: "/keep", raw: override }]);
    for (const path of [
      "",
      "relative",
      "/path?query=1",
      "/path#fragment",
      "/with space",
    ]) {
      expect((await call(instance.id, [{ path, raw: override }])).status).toBe(
        422,
      );
    }
    expect(
      (
        await call(instance.id, [
          { path: "/same", raw },
          { path: "/same", raw },
        ])
      ).status,
    ).toBe(422);
    expect(
      (
        await call(
          instance.id,
          Array.from({ length: MAX_PATH_RESPONSES + 1 }, (_, index) => ({
            path: `/${index}`,
            raw,
          })),
        )
      ).status,
    ).toBe(422);
    expect(
      (await call(instance.id, [{ path: "/bad", raw: "not HTTP" }])).status,
    ).toBe(400);
    const limit = instancePolicies.rawLimitBytes;
    instancePolicies.rawLimitBytes = new TextEncoder().encode(raw).length + 2;
    try {
      expect(
        (await call(instance.id, [{ path: "/too-large", raw: override }]))
          .status,
      ).toBe(413);
      expect(
        replaceInstance({ instanceId: instance.id, ownerId: userId, raw }).ok,
      ).toBe(false);
    } finally {
      instancePolicies.rawLimitBytes = limit;
    }
    expect(storage.getInstanceById(instance.id)?.pathResponses).toEqual(
      instance.pathResponses,
    );
  });

  test("enforces ownership and write scopes; public viewers and guests cannot modify overrides", async () => {
    const instance = makeInstance();
    storage.updateInstance(instance.id, (current) => ({
      ...current,
      public: true,
    }));
    expect((await call(instance.id, [], "")).status).toBe(401);
    const other = storage.setLocalPassword("other", "unused-in-tests");
    const otherToken = await issueAuthToken(other.userId, {
      passwordRevision: other.revision,
    });
    expect((await call(instance.id, [], otherToken)).status).toBe(403);
    const readOnly = createApiKeyForUser({
      userId,
      name: "Reader",
      scopes: ["instances:read"],
    });
    expect((await call(instance.id, [], readOnly.secret)).status).toBe(403);
    const writer = createApiKeyForUser({
      userId,
      name: "Writer",
      scopes: ["instances:write"],
    });
    expect(
      (await call(instance.id, [{ path: "/ok", raw }], writer.secret)).status,
    ).toBe(200);
    const guest = await createGuestInstance(raw);
    if (!guest.ok) throw new Error(guest.error.message);
    expect((await call(guest.value.instance.id, [])).status).toBe(403);
  });

  test("persists overrides across reopening and cascades them when an instance is deleted", () => {
    const instance = makeInstance([{ path: "/callback", raw: override }]);
    storage.closeDb();
    expect(storage.initDb({ dataDir }).kind).toBe("ok");
    expect(storage.getInstanceById(instance.id)?.pathResponses).toEqual(
      instance.pathResponses,
    );
    storage.deleteInstance(instance.id);
    expect(storage.getDb().select().from(instancePathResponses).all()).toEqual(
      [],
    );
  });
});
