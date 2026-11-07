# Path response overrides

An instance's default raw HTTP response remains the fallback for all incoming
requests. Signed-in owners can configure up to 50 exact paths with their own
complete raw responses, including status, headers, and body.

For example, configure `/callback` to return JSON with an `X-Callback` header
and `/script.js` to return JavaScript. Requests to other paths continue to use
the default response.

## Editing

The instance details panel contains **Default response** and **Path overrides**.
Use **Add path** to create an override; its response initially copies the
currently saved default. Edit or remove existing overrides from the list.
Removing an override restores fallback behavior for that path.

Saving a path response does not save unsaved edits in the default-response
editor. Likewise, saving the default or changing instance metadata preserves
existing overrides. Cloning an instance copies its overrides. Public viewers
can inspect the configuration but cannot change it; guest instances continue
to serve their default response.

## Matching

- Matching is exact and case-sensitive: `/callback`, `/Callback`, and
  `/callback/` are different paths.
- Query strings are ignored: `/callback?token=123` matches `/callback`.
- A rule for `/` overrides only the root path.
- Every HTTP method uses the same path rule; methods are not filters.
- Paths are compared as received by the application, without percent-decoding,
  collapsing slashes, or resolving dot segments. `/a%2Fb` differs from `/a/b`.
  Browsers and proxies can normalize paths before forwarding them.
- There are no prefix, wildcard, or regex rules in this version.

Paths must start with `/`, be at most 2048 characters long, and contain no
whitespace, control characters, query string, or fragment. Duplicate paths are
rejected. The existing instance response-size limit applies to the combined
default response and all overrides, measured in UTF-8 bytes.

Requests are logged under the same instance regardless of which response is
selected. DNS and SMTP handling is unchanged. Proxies may cache responses;
configure their caching appropriately when testing updates to response content.

## API and MCP

Authenticated create and update requests accept an optional `pathResponses`
array. Each entry is `{ "path": "/callback", "raw": "HTTP/1.1 ..." }`. Omit
this field on update to preserve existing overrides; send `[]` to remove them.
The MCP `create_instance` and `update_instance` tools accept the same field.

To change only the overrides, use the permanent instance ID and an API key
with `instances:write`:

```http
PATCH /api/instances/abcd1234/path-responses
Authorization: Bearer <API key>
Content-Type: application/json

{
  "pathResponses": [
    {
      "path": "/callback",
      "raw": "HTTP/1.1 201 Created\r\nContent-Type: application/json\r\nX-Callback: yes\r\n\r\n{\"ok\":true}"
    }
  ]
}
```

This replaces the override list and returns the updated instance. Detail
responses include `pathResponses`; lightweight instance summaries omit raw
response content. Invalid paths, duplicate rules, or malformed responses are
rejected without changing existing data.

## Storage

Migration `0008_path_response_overrides` adds a separate table keyed by instance
ID and path. Existing instances start with no overrides and keep their default
behavior. Overrides are removed automatically when their instance is deleted.
