import {
  GUEST_INSTANCE_RAW_LIMIT_BYTES,
  GUEST_INSTANCE_TTL_MS,
  GUEST_MAX_ACTIVE_INSTANCES,
  GUEST_OWNER_ID,
  InstanceSubdomainSchema,
  resolveDomain,
  type Instance,
} from "shared";
import { dnsConfig, instancePolicies } from "../../config";
import {
  addInstance,
  addGuestInstance,
  countActiveInstancesByOwner,
  getInstanceById,
  getWebhooksByOwner,
  updateInstance,
  setInstanceSubdomain,
  isInstanceIdentifierTaken,
} from "../../storage";
import { issueGuestManagementToken } from "../guestAccess";
import { generateInstanceID, validateStaticRaw } from "../utils";

type InstanceServiceErrorCode =
  | "invalid_raw"
  | "invalid_webhooks"
  | "instance_limit"
  | "invalid_subdomain"
  | "subdomain_taken"
  | "not_found"
  | "forbidden";

export type InstanceServiceError = {
  code: InstanceServiceErrorCode;
  message: string;
  status: number;
};

export type InstanceServiceResult<T> =
  { ok: true; value: T } | { ok: false; error: InstanceServiceError };

const fail = (
  code: InstanceServiceErrorCode,
  message: string,
  status: number,
): InstanceServiceResult<never> => ({
  ok: false,
  error: { code, message, status },
});

const validateWebhookIds = (
  ownerId: string,
  webhookIds: string[],
): InstanceServiceResult<string[]> => {
  if (webhookIds.length === 0) {
    return { ok: true, value: [] };
  }

  if (new Set(webhookIds).size !== webhookIds.length) {
    return fail("invalid_webhooks", "Invalid webhook selection", 400);
  }

  const ownedIds = new Set(
    getWebhooksByOwner(ownerId).map((webhook) => webhook.id),
  );
  if (webhookIds.some((webhookId) => !ownedIds.has(webhookId))) {
    return fail("invalid_webhooks", "Invalid webhook selection", 400);
  }
  return { ok: true, value: webhookIds };
};

const validateRaw = (raw: string): InstanceServiceResult<string> => {
  const result = validateStaticRaw(raw);
  return result.ok
    ? { ok: true, value: result.raw }
    : fail("invalid_raw", result.error, result.status);
};

const rawEncoder = new TextEncoder();

const validateGuestRaw = (raw: string): InstanceServiceResult<string> => {
  if (rawEncoder.encode(raw).length > GUEST_INSTANCE_RAW_LIMIT_BYTES) {
    return fail("invalid_raw", "Guest response exceeds 1MB limit", 413);
  }
  return validateRaw(raw);
};

const generateAvailableInstanceId = () => {
  let id = generateInstanceID();
  while (isInstanceIdentifierTaken(id)) id = generateInstanceID();
  return id;
};

export const changeInstanceSubdomain = (
  instanceId: string,
  ownerId: string,
  value: string,
): InstanceServiceResult<Instance> => {
  const owned = getOwnedInstance(instanceId, ownerId);
  if (!owned.ok) return owned;
  if (ownerId === GUEST_OWNER_ID)
    return fail("forbidden", "Guest hostnames cannot be changed", 403);
  const parsed = InstanceSubdomainSchema.safeParse(value);
  if (!parsed.success)
    return fail(
      "invalid_subdomain",
      parsed.error.issues[0]?.message ?? "Invalid subdomain",
      400,
    );
  const appHost = resolveDomain(Bun.env.DOMAIN);
  if (appHost === `${parsed.data}.${dnsConfig.instancesDomain}`) {
    return fail(
      "invalid_subdomain",
      "This subdomain is reserved for the dashboard",
      400,
    );
  }
  try {
    const updated = setInstanceSubdomain(instanceId, parsed.data);
    return updated === undefined
      ? fail("not_found", "Not found", 404)
      : { ok: true, value: updated };
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("UNIQUE constraint failed: instances.subdomain")
    ) {
      return fail("subdomain_taken", "This subdomain is already in use", 409);
    }
    throw error;
  }
};

export const getOwnedInstance = (
  instanceId: string,
  ownerId: string,
): InstanceServiceResult<Instance> => {
  const instance = getInstanceById(instanceId);
  if (instance === undefined) {
    return fail("not_found", "Not found", 404);
  }
  if (instance.ownerId !== ownerId) {
    return fail("forbidden", "Forbidden", 403);
  }
  return { ok: true, value: instance };
};

type CreateInstanceInput = {
  ownerId: string;
  raw: string;
  webhookIds?: string[];
  label?: string;
  ttlMs?: number;
};

export const createInstance = (
  input: CreateInstanceInput,
): InstanceServiceResult<Instance> => {
  const raw = validateRaw(input.raw);
  if (!raw.ok) {
    return raw;
  }

  const webhookIds = validateWebhookIds(input.ownerId, input.webhookIds ?? []);
  if (!webhookIds.ok) {
    return webhookIds;
  }

  if (
    instancePolicies.maxInstancesPerOwner !== undefined &&
    countActiveInstancesByOwner(input.ownerId) >=
      instancePolicies.maxInstancesPerOwner
  ) {
    return fail("instance_limit", "Instance limit reached", 403);
  }

  const now = Date.now();
  const ttlMs = input.ttlMs ?? instancePolicies.defaultTtlMs;
  const expiresAt = ttlMs === undefined ? undefined : now + ttlMs;

  return {
    ok: true,
    value: addInstance({
      id: generateAvailableInstanceId(),
      ownerId: input.ownerId,
      createdAt: now,
      expiresAt,
      webhookIds: webhookIds.value,
      label: input.label,
      public: false,
      locked: false,
      raw: raw.value,
    }),
  };
};

type UpdateInstanceInput = {
  instanceId: string;
  ownerId: string;
  raw: string;
  webhookIds?: string[];
};

export const replaceInstance = (
  input: UpdateInstanceInput,
): InstanceServiceResult<Instance> => {
  const owned = getOwnedInstance(input.instanceId, input.ownerId);
  if (!owned.ok) {
    return owned;
  }

  const raw = validateRaw(input.raw);
  if (!raw.ok) {
    return raw;
  }

  const webhookIds =
    input.webhookIds === undefined
      ? ({ ok: true, value: owned.value.webhookIds } as const)
      : validateWebhookIds(input.ownerId, input.webhookIds);
  if (!webhookIds.ok) {
    return webhookIds;
  }

  const updated = updateInstance(input.instanceId, (instance) => ({
    ...instance,
    raw: raw.value,
    webhookIds: webhookIds.value,
  }));

  return updated === undefined
    ? fail("not_found", "Not found", 404)
    : { ok: true, value: updated };
};

export const createGuestInstance = async (
  raw: string,
): Promise<InstanceServiceResult<{ instance: Instance; token: string }>> => {
  const validatedRaw = validateGuestRaw(raw);
  if (!validatedRaw.ok) {
    return validatedRaw;
  }
  if (
    countActiveInstancesByOwner(GUEST_OWNER_ID) >= GUEST_MAX_ACTIVE_INSTANCES
  ) {
    return fail("instance_limit", "Guest instance limit reached", 503);
  }

  const now = Date.now();
  const expiresAt = now + GUEST_INSTANCE_TTL_MS;
  const instanceId = generateAvailableInstanceId();
  const token = await issueGuestManagementToken(
    { id: instanceId, createdAt: now },
    expiresAt,
  );
  const instance = addGuestInstance({
    id: instanceId,
    ownerId: GUEST_OWNER_ID,
    createdAt: now,
    expiresAt,
    webhookIds: [],
    public: false,
    locked: false,
    raw: validatedRaw.value,
  });
  return {
    ok: true,
    value: { instance, token },
  };
};

export const replaceGuestInstance = (
  instanceId: string,
  raw: string,
): InstanceServiceResult<Instance> => {
  const owned = getOwnedInstance(instanceId, GUEST_OWNER_ID);
  if (!owned.ok) {
    return owned;
  }
  const validatedRaw = validateGuestRaw(raw);
  if (!validatedRaw.ok) {
    return validatedRaw;
  }
  const updated = updateInstance(instanceId, (instance) => ({
    ...instance,
    raw: validatedRaw.value,
    webhookIds: [],
  }));
  return updated === undefined
    ? fail("not_found", "Not found", 404)
    : { ok: true, value: updated };
};
