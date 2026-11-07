import { computed, ref, watch, type Ref } from "vue";
import {
  ResponsePathSchema,
  MAX_PATH_RESPONSES,
  type Instance,
  type PathResponse,
} from "shared";

export const usePathResponses = (
  instance: Ref<Instance>,
  editable: Ref<boolean>,
  persist: (id: string, responses: PathResponse[]) => Promise<Instance>,
) => {
  const visible = ref(false);
  const path = ref("");
  const raw = ref("");
  const editingPath = ref<string | undefined>();
  const originalRaw = ref("");
  const serverError = ref("");
  const saving = ref(false);
  const responses = computed(() => instance.value.pathResponses ?? []);
  const validationError = computed(() => {
    const parsed = ResponsePathSchema.safeParse(path.value);
    if (!parsed.success)
      return parsed.error.issues[0]?.message ?? "Invalid path";
    if (
      responses.value.some(
        (response) =>
          response.path === path.value && response.path !== editingPath.value,
      )
    )
      return "An override already exists for this path";
    if (
      editingPath.value === undefined &&
      responses.value.length >= MAX_PATH_RESPONSES
    )
      return `Use at most ${MAX_PATH_RESPONSES} path overrides`;
    return "";
  });
  const dirty = computed(
    () => path.value !== editingPath.value || raw.value !== originalRaw.value,
  );
  const canSave = computed(
    () =>
      editable.value &&
      !saving.value &&
      dirty.value &&
      validationError.value === "",
  );
  const error = computed(
    () => serverError.value || (path.value === "" ? "" : validationError.value),
  );

  const open = (response?: PathResponse) => {
    if (saving.value || (response === undefined && !editable.value)) return;
    editingPath.value = response?.path;
    path.value = response?.path ?? "";
    raw.value = response?.raw ?? instance.value.raw;
    originalRaw.value = raw.value;
    serverError.value = "";
    visible.value = true;
  };

  watch([path, raw], () => {
    serverError.value = "";
  });
  watch(
    () => instance.value.id,
    () => {
      visible.value = false;
      serverError.value = "";
    },
  );

  const save = async () => {
    if (!canSave.value) return;
    const id = instance.value.id;
    const next = responses.value.filter(
      (response) => response.path !== editingPath.value,
    );
    next.push({ path: path.value, raw: raw.value });
    saving.value = true;
    serverError.value = "";
    try {
      await persist(id, next);
      if (instance.value.id === id) visible.value = false;
    } catch (cause) {
      if (instance.value.id === id)
        serverError.value =
          cause instanceof Error
            ? cause.message
            : "Could not save path response";
    } finally {
      saving.value = false;
    }
  };

  const remove = async (target: string) => {
    if (!editable.value || saving.value) return;
    const id = instance.value.id;
    saving.value = true;
    serverError.value = "";
    try {
      await persist(
        id,
        responses.value.filter((response) => response.path !== target),
      );
    } catch (cause) {
      if (instance.value.id === id)
        serverError.value =
          cause instanceof Error
            ? cause.message
            : "Could not remove path response";
    } finally {
      saving.value = false;
    }
  };

  return {
    visible,
    path,
    raw,
    responses,
    editingPath,
    error,
    serverError,
    saving,
    canSave,
    open,
    save,
    remove,
  };
};
