import { describe, expect, test, vi } from "vitest";
import { effectScope, nextTick, ref } from "vue";
import type { Instance } from "shared";
import { useInstanceSubdomain } from "./useInstanceSubdomain";

const fixture = (id = "abcd1234", subdomain = id): Instance => ({
  id,
  subdomain,
  ownerId: "owner",
  createdAt: 1,
  webhookIds: [],
  raw: "response",
  public: false,
  locked: false,
});

const setup = (
  persist = vi.fn<(id: string, subdomain: string) => Promise<Instance>>(),
) => {
  const scope = effectScope();
  const instance = ref(fixture());
  const editable = ref(true);
  const editor = scope.run(() =>
    useInstanceSubdomain(instance, editable, persist),
  );
  if (editor === undefined) throw new Error("Expected an editor scope");
  return { ...editor, instance, editable, persist, stop: () => scope.stop() };
};

describe("instance hostname editing", () => {
  test("clears edits when normalization produces the unchanged hostname", async () => {
    const editor = setup();
    editor.draft.value = " ABCD1234 ";
    editor.persist.mockResolvedValueOnce(fixture());
    await editor.save();
    expect(editor.draft.value).toBe("abcd1234");
    expect(editor.dirty.value).toBe(false);
    editor.stop();
  });
  test("retains unsaved text until explicitly discarded", async () => {
    const editor = setup();
    editor.draft.value = "my-poc";
    expect(editor.dirty.value).toBe(true);
    expect(editor.instance.value.subdomain).toBe("abcd1234");
    await nextTick();
    expect(editor.persist).not.toHaveBeenCalled();
    editor.discard();
    expect(editor.draft.value).toBe("abcd1234");
    expect(editor.dirty.value).toBe(false);
    editor.stop();
  });

  test("blocks invalid edits and viewers", async () => {
    const editor = setup();
    editor.draft.value = "invalid.host";
    await editor.save();
    expect(editor.error.value).not.toBe("");
    editor.draft.value = "valid-host";
    editor.editable.value = false;
    await editor.save();
    expect(editor.persist).not.toHaveBeenCalled();
    editor.stop();
  });

  test("preserves edits after conflicts and allows a corrected retry", async () => {
    const editor = setup();
    editor.draft.value = "taken";
    await nextTick();
    editor.persist.mockRejectedValueOnce(
      new Error("This subdomain is already in use"),
    );
    await editor.save();
    expect(editor.error.value).toContain("already in use");
    expect(editor.draft.value).toBe("taken");
    expect(editor.instance.value.subdomain).toBe("abcd1234");
    editor.draft.value = "available";
    await nextTick();
    expect(editor.error.value).toBe("");
    editor.persist.mockImplementationOnce(async (id, subdomain) => {
      editor.instance.value = fixture(id, subdomain);
      return editor.instance.value;
    });
    await editor.save();
    await nextTick();
    expect(editor.persist).toHaveBeenLastCalledWith("abcd1234", "available");
    expect(editor.dirty.value).toBe(false);
    editor.stop();
  });

  test("prevents duplicate saves and clears drafts when navigating to another instance", async () => {
    const editor = setup();
    let complete: (instance: Instance) => void = () => {};
    editor.persist.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    editor.draft.value = "new-host";
    const saving = editor.save();
    await editor.save();
    editor.discard();
    expect(editor.persist).toHaveBeenCalledTimes(1);
    expect(editor.draft.value).toBe("new-host");
    editor.instance.value = fixture("another1");
    await nextTick();
    complete(fixture("abcd1234", "new-host"));
    await saving;
    expect(editor.draft.value).toBe("another1");
    editor.stop();
  });
});
