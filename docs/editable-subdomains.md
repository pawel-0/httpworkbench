# Editable instance hostnames

An instance has a permanent internal `id` and a separate `subdomain`. New
instances initially use the same random value for both. Changing the subdomain
preserves the response, label, webhooks, visibility, lock state, expiry, logs,
dashboard URL, API references, and WebSocket subscription.

In the instance details panel, edit the left-hand part of the hostname. The
deployment's domain suffix is fixed. Save and discard buttons appear when the
text changes. Enter saves, Escape discards, and clicking elsewhere leaves the
edit unsaved. Copy always copies the currently active hostname.

Names are normalized to lowercase and may contain 1–63 ASCII letters, numbers,
or hyphens. They must begin and end with a letter or number. Infrastructure
names `www`, `api`, `admin`, `mail`, `smtp`, `ns1`, and `ns2` are reserved, as is
the dashboard's hostname when it lies inside the interaction domain.

Only an authenticated owner with write access can change a hostname. Guest
instances and read-only viewers cannot edit it. A database unique index enforces
global uniqueness, including concurrent save attempts. An expired instance's
name remains reserved until the expired instance is removed.

Saving immediately removes the old hostname from this instance; no alias or
redirect is created. DNS caches can retain earlier answers until their TTL
expires. Requests and messages already accepted before a rename retain the
same permanent instance ID.

## API

Use the permanent instance ID in the URL:

```http
PATCH /api/instances/abcd1234/subdomain
Authorization: Bearer <API key with instances:write>
Content-Type: application/json

{"subdomain":"my-poc"}
```

The response is the updated instance, including `id: "abcd1234"` and
`subdomain: "my-poc"`. A duplicate subdomain returns HTTP 409. Listing, detail,
and MCP responses include the saved subdomain; hostnames and URLs use that
value. HTTP, DNS, and SMTP interactions resolve the subdomain to the permanent
ID before recording logs. Instance-management endpoints continue to use `id`.

## Existing installations

Migration `0008_editable_instance_subdomains` adds the subdomain column,
initializes existing instances from their IDs, and creates its unique index.
Existing hostnames therefore continue to work after the upgrade. As with other
database migrations, test upgrades using a database copy before switching
between old and new application versions.
