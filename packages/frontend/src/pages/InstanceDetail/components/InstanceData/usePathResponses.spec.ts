import { describe, expect, test, vi } from "vitest";
import { effectScope, nextTick, ref } from "vue";
import type { Instance, PathResponse } from "shared";
import { usePathResponses } from "./usePathResponses";

const fixture = (id = "abcd1234"): Instance => ({
  id,
  ownerId: "owner",
  createdAt: 1,
  public: false,
  locked: false,
  webhookIds: [],
  raw: "default response",
  pathResponses: [{ path: "/existing", raw: "existing response" }],
});

const setup = () => {
  const instance = ref(fixture());
  const editable = ref(true);
  const persist = vi.fn(async (id: string, responses: PathResponse[]) => {
    const updated = { ...instance.value, id, pathResponses: responses };
    instance.value = updated;
    return updated;
  });
  const scope = effectScope();
  const editor = scope.run(() => usePathResponses(instance, editable, persist));
  if (editor === undefined) throw new Error("Expected an editor scope");
  return { ...editor, instance, editable, persist, stop: () => scope.stop() };
};

describe("path response editor", () => {
  test("starts from the default and saves a new override without mutating the default", async () => {
    const editor = setup();
    editor.open();
    expect(editor.raw.value).toBe("default response");
    expect(editor.canSave.value).toBe(false);
    editor.path.value = "/callback";
    editor.raw.value = "custom response";
    await editor.save();
    expect(editor.persist).toHaveBeenCalledWith("abcd1234", [
      { path: "/existing", raw: "existing response" },
      { path: "/callback", raw: "custom response" },
    ]);
    expect(editor.instance.value.raw).toBe("default response");
    expect(editor.visible.value).toBe(false);
    editor.stop();
  });
  test("renames an existing path and removes its old entry", async () => {
    const editor = setup();
    editor.open({ path: "/existing", raw: "existing response" });
    expect(editor.canSave.value).toBe(false);
    editor.path.value = "/renamed";
    await editor.save();
    expect(editor.persist).toHaveBeenCalledWith("abcd1234", [
      { path: "/renamed", raw: "existing response" },
    ]);
    await editor.remove("/renamed");
    expect(editor.instance.value.pathResponses).toEqual([]);
    editor.stop();
  });
  test("blocks duplicates, invalid paths, and read-only viewers", async () => {
    const editor = setup();
    editor.open();
    editor.path.value = "/existing";
    expect(editor.canSave.value).toBe(false);
    expect(editor.error.value).toContain("already exists");
    editor.path.value = "/path?query=1";
    await editor.save();
    expect(editor.persist).not.toHaveBeenCalled();
    editor.path.value = "/valid";
    editor.editable.value = false;
    await editor.save();
    await editor.remove("/existing");
    expect(editor.persist).not.toHaveBeenCalled();
    editor.stop();
  });
  test("preserves failed edits and retries after the user corrects the response", async () => {
    const editor = setup();
    editor.open();
    editor.path.value = "/callback";
    editor.raw.value = "invalid raw";
    await nextTick();
    editor.persist.mockRejectedValueOnce(new Error("Invalid HTTP response"));
    await editor.save();
    expect(editor.visible.value).toBe(true);
    expect(editor.raw.value).toBe("invalid raw");
    expect(editor.error.value).toBe("Invalid HTTP response");
    editor.raw.value = "corrected response";
    await nextTick();
    await editor.save();
    expect(editor.visible.value).toBe(false);
    editor.stop();
  });
  test("canceling does not persist, and switching instances clears the old editor", async () => {
    const editor = setup();
    editor.open();
    editor.path.value = "/unsaved";
    editor.raw.value = "unsaved response";
    editor.visible.value = false;
    expect(editor.persist).not.toHaveBeenCalled();
    editor.open({ path: "/existing", raw: "existing response" });
    expect(editor.raw.value).toBe("existing response");
    editor.instance.value = fixture("next1234");
    await nextTick();
    expect(editor.visible.value).toBe(false);
    editor.stop();
  });
});
