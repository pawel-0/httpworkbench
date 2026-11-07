import {
  GUEST_OWNER_ID,
  type Instance,
  type InstanceSummary,
  type PathResponse,
} from "shared";
import { InstanceSchema } from "shared";
import {
  and,
  asc,
  count,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { getDb } from "../db";
import {
  toDomainInstance,
  toDomainInstanceSummary,
  toInstanceRow,
} from "../records";
import {
  instances,
  instanceWebhooks,
  instancePathResponses,
  logs,
} from "../schema";

const activeInstanceCondition = (now: number) =>
  or(isNull(instances.expiresAt), gt(instances.expiresAt, now));

type WebhookMutationStore = Pick<ReturnType<typeof getDb>, "delete" | "insert">;

const getActiveInstanceById = (
  id: string,
  now: number,
): Instance | undefined => {
  const row = getDb()
    .select()
    .from(instances)
    .where(and(eq(instances.id, id), activeInstanceCondition(now)))
    .get();
  return row === undefined
    ? undefined
    : toDomainInstance(
        row,
        getWebhookIdsForInstance(id),
        getPathResponsesForInstance(id),
      );
};

const getPathResponsesForInstance = (id: string): PathResponse[] =>
  getDb()
    .select({
      path: instancePathResponses.path,
      raw: instancePathResponses.raw,
    })
    .from(instancePathResponses)
    .where(eq(instancePathResponses.instanceId, id))
    .orderBy(asc(instancePathResponses.path))
    .all();

const replacePathResponses = (
  database: WebhookMutationStore,
  instanceId: string,
  responses: PathResponse[],
) => {
  database
    .delete(instancePathResponses)
    .where(eq(instancePathResponses.instanceId, instanceId))
    .run();
  if (responses.length > 0)
    database
      .insert(instancePathResponses)
      .values(responses.map((response) => ({ instanceId, ...response })))
      .run();
};

const replaceInstanceWebhooks = (
  database: WebhookMutationStore,
  instanceId: string,
  webhookIds: string[],
) => {
  database
    .delete(instanceWebhooks)
    .where(eq(instanceWebhooks.instanceId, instanceId))
    .run();
  webhookIds.forEach((webhookId, position) => {
    database
      .insert(instanceWebhooks)
      .values({ instanceId, webhookId, position })
      .run();
  });
};

export function addInstance(instance: Instance): Instance {
  const parsed = InstanceSchema.parse({
    ...instance,
    pathResponses: instance.pathResponses ?? [],
  });
  getDb().transaction(
    (tx) => {
      tx.insert(instances).values(toInstanceRow(parsed)).run();
      replaceInstanceWebhooks(tx, parsed.id, parsed.webhookIds);
      replacePathResponses(tx, parsed.id, parsed.pathResponses ?? []);
    },
    { behavior: "immediate" },
  );
  return parsed;
}

export function addGuestInstance(instance: Instance): Instance {
  const parsed = InstanceSchema.parse({ ...instance, pathResponses: [] });
  if (parsed.ownerId !== GUEST_OWNER_ID || parsed.webhookIds.length !== 0) {
    throw new Error("Invalid guest instance");
  }
  getDb().insert(instances).values(toInstanceRow(parsed)).run();
  return parsed;
}

export function getInstanceSummariesByOwner(
  ownerId: string,
): InstanceSummary[] {
  const rows = getDb()
    .select({
      id: instances.id,
      ownerId: instances.ownerId,
      createdAt: instances.createdAt,
      expiresAt: instances.expiresAt,
      label: instances.label,
      isPublic: instances.isPublic,
      isLocked: instances.isLocked,
      logCount: count(logs.id),
    })
    .from(instances)
    .leftJoin(logs, eq(logs.instanceId, instances.id))
    .where(
      and(eq(instances.ownerId, ownerId), activeInstanceCondition(Date.now())),
    )
    .groupBy(instances.id)
    .orderBy(asc(instances.createdAt), asc(instances.id))
    .all();

  return rows.map(toDomainInstanceSummary);
}

export function getInstanceSummariesByIds(
  ids: string[],
  ownerId: string,
): InstanceSummary[] {
  if (ids.length === 0) {
    return [];
  }

  const rows = getDb()
    .select({
      id: instances.id,
      ownerId: instances.ownerId,
      createdAt: instances.createdAt,
      expiresAt: instances.expiresAt,
      label: instances.label,
      isPublic: instances.isPublic,
      isLocked: instances.isLocked,
      logCount: count(logs.id),
    })
    .from(instances)
    .leftJoin(logs, eq(logs.instanceId, instances.id))
    .where(
      and(
        inArray(instances.id, ids),
        eq(instances.ownerId, ownerId),
        activeInstanceCondition(Date.now()),
      ),
    )
    .groupBy(instances.id)
    .all();

  const summariesById = new Map(
    rows.map((row) => {
      const summary = toDomainInstanceSummary(row);
      return [summary.id, summary] as const;
    }),
  );
  return ids.flatMap((id) => {
    const summary = summariesById.get(id);
    return summary === undefined ? [] : [summary];
  });
}

export function countActiveInstancesByOwner(ownerId: string): number {
  return (
    getDb()
      .select({ count: count() })
      .from(instances)
      .where(
        and(
          eq(instances.ownerId, ownerId),
          activeInstanceCondition(Date.now()),
        ),
      )
      .get()?.count ?? 0
  );
}

export function getInstanceById(id: string): Instance | undefined {
  return getActiveInstanceById(id, Date.now());
}

export type ServableInstance = Pick<Instance, "id" | "raw"> & {
  responsePath?: string | null;
};

export type InstanceAccessMetadata = Pick<
  Instance,
  "id" | "ownerId" | "createdAt" | "public"
>;

export function getServableInstanceById(
  id: string,
  path?: string,
): ServableInstance | undefined {
  if (path !== undefined) {
    return getDb()
      .select({
        id: instances.id,
        raw: sql<string>`coalesce(${instancePathResponses.raw}, ${instances.raw})`,
        responsePath: instancePathResponses.path,
      })
      .from(instances)
      .leftJoin(
        instancePathResponses,
        and(
          eq(instancePathResponses.instanceId, instances.id),
          eq(instancePathResponses.path, path),
        ),
      )
      .where(and(eq(instances.id, id), activeInstanceCondition(Date.now())))
      .get();
  }
  return getDb()
    .select({ id: instances.id, raw: instances.raw })
    .from(instances)
    .where(and(eq(instances.id, id), activeInstanceCondition(Date.now())))
    .get();
}

export function hasActiveInstance(id: string): boolean {
  return (
    getDb()
      .select({ id: instances.id })
      .from(instances)
      .where(and(eq(instances.id, id), activeInstanceCondition(Date.now())))
      .get() !== undefined
  );
}

export function getInstanceAccessMetadata(
  id: string,
): InstanceAccessMetadata | undefined {
  return getDb()
    .select({
      id: instances.id,
      ownerId: instances.ownerId,
      createdAt: instances.createdAt,
      public: instances.isPublic,
    })
    .from(instances)
    .where(and(eq(instances.id, id), activeInstanceCondition(Date.now())))
    .get();
}

export function getWebhookIdsForInstance(instanceId: string): string[] {
  return getDb()
    .select({ webhookId: instanceWebhooks.webhookId })
    .from(instanceWebhooks)
    .where(eq(instanceWebhooks.instanceId, instanceId))
    .orderBy(asc(instanceWebhooks.position))
    .all()
    .map(({ webhookId }) => webhookId);
}

export function getActiveWebhookIdsForInstance(
  instanceId: string,
  now = Date.now(),
): string[] {
  return getDb()
    .select({ webhookId: instanceWebhooks.webhookId })
    .from(instanceWebhooks)
    .innerJoin(instances, eq(instances.id, instanceWebhooks.instanceId))
    .where(
      and(
        eq(instanceWebhooks.instanceId, instanceId),
        activeInstanceCondition(now),
      ),
    )
    .orderBy(asc(instanceWebhooks.position))
    .all()
    .map(({ webhookId }) => webhookId);
}

export function updateInstance(
  id: string,
  updater: (instance: Instance) => Instance,
): Instance | undefined {
  const current = getActiveInstanceById(id, Date.now());
  if (current === undefined) {
    return undefined;
  }

  const updated = updater(current);
  const parsed = InstanceSchema.parse(updated);
  getDb().transaction(
    (tx) => {
      tx.update(instances)
        .set(toInstanceRow(parsed))
        .where(eq(instances.id, id))
        .run();
      replaceInstanceWebhooks(tx, id, parsed.webhookIds);
      replacePathResponses(tx, id, parsed.pathResponses ?? []);
    },
    { behavior: "immediate" },
  );
  return parsed;
}

export function deleteInstance(id: string): void {
  getDb().delete(instances).where(eq(instances.id, id)).run();
}

export function deleteUnlockedInstancesByOwner(ownerId: string): number {
  return getDb()
    .delete(instances)
    .where(and(eq(instances.ownerId, ownerId), eq(instances.isLocked, false)))
    .returning({ id: instances.id })
    .all().length;
}

export function removeExpiredInstances(now: number): string[] {
  const expiredCondition = and(
    isNotNull(instances.expiresAt),
    lte(instances.expiresAt, now),
  );
  const rows = getDb()
    .select({ id: instances.id })
    .from(instances)
    .where(expiredCondition)
    .orderBy(asc(instances.expiresAt), asc(instances.id))
    .all();

  const removedIds = rows.map((row) => row.id);
  if (removedIds.length === 0) {
    return [];
  }

  getDb().delete(instances).where(expiredCondition).run();

  return removedIds;
}
