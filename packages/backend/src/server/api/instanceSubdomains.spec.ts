import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Elysia } from "elysia";
import * as dnsPacket from "dns-packet";

process.env.AUTH_MODE = "password";
process.env.JWT_SECRET = "instance-subdomains-test-secret";
process.env.DOMAIN = "example.com";
process.env.INSTANCES_DOMAIN = "instances.example.com";

const storage = await import("../../storage");
const { instancesRoutes } = await import("./instances");
const { issueAuthToken } = await import("../auth");
const { createApiKeyForUser } = await import("../apiKeyAuth");
const { createInstance, createGuestInstance, changeInstanceSubdomain } =
  await import("../instances/service");
const { createInstancesServer } = await import("../instances/server");
const { handleDnsRequest } = await import("../dns/server");
const { createSmtpSession } = await import("../smtp/server");

let dataDir = "";
let token = "";
let userId = "";
const app = new Elysia().use(instancesRoutes);
const raw =
  "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\r\noriginal response";
const makeInstance = () => {
  const result = createInstance({ ownerId: userId, raw });
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};
const rename = (id: string, subdomain: string, auth = token) =>
  app.handle(
    new Request(`http://example.com/api/instances/${id}/subdomain`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        ...(auth ? { authorization: `Bearer ${auth}` } : {}),
      },
      body: JSON.stringify({ subdomain }),
    }),
  );

describe("editable instance subdomains", () => {
  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "httpworkbench-subdomains-"));
    const initialized = storage.initDb({ dataDir, reset: true });
    if (initialized.kind === "error") throw initialized.error;
    const credentials = storage.setLocalPassword("admin", "unused-in-tests");
    userId = credentials.userId;
    token = await issueAuthToken(userId, {
      passwordRevision: credentials.revision,
    });
  });
  afterEach(() => {
    storage.closeDb();
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("renames HTTP traffic without changing identity, settings, response, or logs", async () => {
    const original = makeInstance();
    storage.updateInstance(original.id, (instance) => ({
      ...instance,
      label: "Keep me",
      locked: true,
      public: true,
    }));
    const server = createInstancesServer(0);
    try {
      const request = (subdomain: string) =>
        fetch(`http://127.0.0.1:${server.port}/callback`, {
          headers: { host: `${subdomain}.instances.example.com` },
        });
      expect((await request(original.id)).status).toBe(200);
      const response = await rename(original.id, " My-PoC ");
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        id: original.id,
        subdomain: "my-poc",
        raw,
        label: "Keep me",
        locked: true,
        public: true,
      });
      expect((await request(original.id)).status).toBe(400);
      const renamedResponse = await request("my-poc");
      expect(await renamedResponse.text()).toBe("original response");
      expect(storage.getInstanceById(original.id)?.subdomain).toBe("my-poc");
      expect(storage.getInstanceSummariesByOwner(userId)[0]?.subdomain).toBe(
        "my-poc",
      );
      const logs = storage.getLogsForInstancePage({
        instanceId: original.id,
        limit: 10,
      }).logs;
      expect(logs).toHaveLength(2);
      expect(logs.every((log) => log.instanceId === original.id)).toBe(true);
    } finally {
      server.stop(true);
    }
  });

  test("enforces unique names atomically and allows saving the current name", async () => {
    const first = makeInstance();
    const second = makeInstance();
    const responses = await Promise.all([
      rename(first.id, "shared-name"),
      rename(second.id, "shared-name"),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 409,
    ]);
    const owner = storage.getInstanceIdBySubdomain("shared-name");
    if (owner === undefined) throw new Error("Expected a hostname owner");
    expect((await rename(owner, "shared-name")).status).toBe(200);
    expect(storage.getInstanceById(owner)?.subdomain).toBe("shared-name");
  });

  test("requires ownership and write scope, even on a public instance", async () => {
    const instance = makeInstance();
    storage.updateInstance(instance.id, (current) => ({
      ...current,
      public: true,
    }));
    expect((await rename(instance.id, "new-name", "")).status).toBe(401);
    const other = storage.setLocalPassword("other", "unused-in-tests");
    const otherToken = await issueAuthToken(other.userId, {
      passwordRevision: other.revision,
    });
    expect((await rename(instance.id, "new-name", otherToken)).status).toBe(
      403,
    );
    const readOnly = createApiKeyForUser({
      userId,
      name: "Read only",
      scopes: ["instances:read"],
    });
    expect(
      (await rename(instance.id, "new-name", readOnly.secret)).status,
    ).toBe(403);
    const writer = createApiKeyForUser({
      userId,
      name: "Writer",
      scopes: ["instances:write"],
    });
    expect((await rename(instance.id, "new-name", writer.secret)).status).toBe(
      200,
    );
  });

  test("rejects invalid, reserved, missing, and guest hostname changes", async () => {
    const instance = makeInstance();
    for (const value of [
      "",
      "bad.name",
      "-bad",
      "bad-",
      "ns1",
      "a".repeat(64),
    ]) {
      expect((await rename(instance.id, value)).status).toBe(422);
      expect(changeInstanceSubdomain(instance.id, userId, value).ok).toBe(
        false,
      );
    }
    expect((await rename("missing", "new-name")).status).toBe(404);
    const guest = await createGuestInstance(raw);
    if (!guest.ok) throw new Error(guest.error.message);
    expect((await rename(guest.value.instance.id, "new-name")).status).toBe(
      403,
    );
  });

  test("routes DNS and SMTP by the new name and logs the permanent ID", async () => {
    const instance = makeInstance();
    expect((await rename(instance.id, "callback")).status).toBe(200);
    const captured: { instanceId: string; type: string }[] = [];
    const deps = {
      resolveInstanceId: async (subdomain: string) =>
        storage.getInstanceIdBySubdomain(subdomain),
      addLog: (log: Parameters<typeof storage.addLogWithOutcome>[0]) => {
        captured.push(log);
        return storage.addLogWithOutcome(log);
      },
      broadcastLog: () => {},
      createId: () => crypto.randomUUID(),
      now: () => Date.now(),
    };
    const response = await handleDnsRequest({
      payload: dnsPacket.encode({
        type: "query",
        id: 1,
        questions: [
          { name: "random.callback.instances.example.com", type: "A" },
        ],
      }),
      transport: "udp",
      clientAddress: "198.51.100.42",
      config: {
        instancesDomain: "instances.example.com",
        instancesAcmeChallengeDomain: "_acme-challenge.example.com",
        dnsPort: 53,
        dnsNameservers: ["ns1.example.com"],
        publicIp: "203.0.113.10",
      },
      deps,
    });
    if (response === undefined) throw new Error("Expected a DNS response");
    expect(dnsPacket.decode(response).answers?.[0]?.type).toBe("A");
    const session = createSmtpSession({
      config: { instancesDomain: "instances.example.com", smtpPort: 25 },
      clientAddress: "198.51.100.42",
      deps,
    });
    for (const line of [
      "EHLO sender.example",
      "MAIL FROM:<sender@example.com>",
      "RCPT TO:<anything@callback.instances.example.com>",
      "DATA",
      "Subject: Test",
      "",
      "message",
      ".",
    ]) {
      await session.handleLine(line);
    }
    expect(captured.map((log) => [log.type, log.instanceId])).toEqual([
      ["dns", instance.id],
      ["smtp", instance.id],
    ]);
    expect(storage.getInstanceIdBySubdomain(instance.id)).toBeUndefined();
  });
});
