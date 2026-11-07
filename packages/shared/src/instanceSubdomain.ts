import { z } from "zod";

const reservedSubdomains = new Set([
  "www",
  "api",
  "admin",
  "mail",
  "smtp",
  "ns1",
  "ns2",
]);

export const InstanceSubdomainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Enter a subdomain")
  .max(63, "Use at most 63 characters")
  .regex(
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/,
    "Use letters, numbers, and internal hyphens",
  )
  .refine(
    (value) => !reservedSubdomains.has(value),
    "This subdomain is reserved",
  );

export const getInstanceSubdomain = (instance: {
  id: string;
  subdomain?: string;
}) => instance.subdomain ?? instance.id;
