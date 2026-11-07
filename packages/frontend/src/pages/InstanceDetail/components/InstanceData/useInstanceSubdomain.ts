import { computed, ref, watch, type Ref } from "vue";
import {
  getInstanceSubdomain,
  InstanceSubdomainSchema,
  type Instance,
} from "shared";

export const useInstanceSubdomain = (
  instance: Ref<Instance>,
  editable: Ref<boolean>,
  persist: (id: string, subdomain: string) => Promise<Instance>,
) => {
  const draft = ref(getInstanceSubdomain(instance.value));
  const serverError = ref("");
  const saving = ref(false);
  const current = computed(() => getInstanceSubdomain(instance.value));
  const dirty = computed(() => draft.value !== current.value);
  const validation = computed(() =>
    InstanceSubdomainSchema.safeParse(draft.value),
  );
  const error = computed(
    () =>
      serverError.value ||
      (dirty.value && !validation.value.success
        ? (validation.value.error.issues[0]?.message ?? "Invalid subdomain")
        : ""),
  );

  watch(
    () => [instance.value.id, current.value],
    () => {
      draft.value = current.value;
      serverError.value = "";
    },
  );
  watch(draft, () => {
    serverError.value = "";
  });

  const discard = () => {
    if (saving.value) return;
    draft.value = current.value;
    serverError.value = "";
  };
  const save = async () => {
    if (
      !editable.value ||
      saving.value ||
      !dirty.value ||
      !validation.value.success
    )
      return;
    const id = instance.value.id;
    const subdomain = validation.value.data;
    saving.value = true;
    serverError.value = "";
    try {
      const saved = await persist(id, subdomain);
      if (instance.value.id === id) draft.value = getInstanceSubdomain(saved);
    } catch (cause) {
      if (instance.value.id === id)
        serverError.value =
          cause instanceof Error ? cause.message : "Could not save hostname";
    } finally {
      saving.value = false;
    }
  };

  const valid = computed(() => validation.value.success);
  return { draft, dirty, error, valid, saving, save, discard };
};
