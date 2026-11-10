import { useConfirm } from "primevue/useconfirm";
import { GUEST_OWNER_ID } from "shared";
import { computed, type MaybeRefOrGetter, toValue, watch } from "vue";
import { useRouter } from "vue-router";
import { NotFoundError } from "@/api/errors";
import { guestInstancesApi } from "@/api/domains/guestInstances";
import { instancesApi } from "@/api/domains/instances";
import { useNotify } from "@/composables";
import { useClearLogs } from "@/queries/domains/useInstances";
import { useInstanceDetail } from "@/queries/domains/useInstanceDetail";
import { useAuthStore } from "@/stores/auth";
import { useGuestInstancesStore } from "@/stores/guestInstances";
import { isPresent } from "@/utils/types";
import { useInstanceLogStream } from "./useInstanceLogStream";

export const useInstanceDetailLogic = (
  instanceId: MaybeRefOrGetter<string>,
) => {
  const router = useRouter();
  const notify = useNotify();
  const confirm = useConfirm();
  const { mutateAsync: clearLogsMutation, isPending: isClearingLogs } =
    useClearLogs();
  const authStore = useAuthStore();
  const guestInstancesStore = useGuestInstancesStore();
  const resolvedInstanceId = computed(() => toValue(instanceId));
  const { data, isPending, isPlaceholderData, isFetched, error, refetch } =
    useInstanceDetail(instanceId);
  const instance = computed(() => data.value?.instance);
  const canManageInstance = computed(() => {
    if (instance.value === undefined) return false;

    if (instance.value.ownerId === GUEST_OWNER_ID) {
      return (
        authStore.isGuest && guestInstancesStore.ids.includes(instance.value.id)
      );
    }

    if (authStore.isGuest) {
      return false;
    }

    return authStore.user?.id === instance.value.ownerId;
  });

  const handleClearLogs = () => {
    const targetId = instance.value?.id;
    if (
      targetId === undefined ||
      !canManageInstance.value ||
      isClearingLogs.value
    ) {
      return;
    }

    confirm.require({
      message: "Are you sure you want to clear all logs for this instance?",
      header: "Clear Logs Confirmation",
      icon: "pi pi-exclamation-triangle",
      rejectProps: {
        label: "Cancel",
        severity: "secondary",
        outlined: true,
      },
      acceptProps: {
        label: "Clear",
        severity: "danger",
      },
      accept: async () => {
        if (
          instance.value?.id !== targetId ||
          !canManageInstance.value ||
          isClearingLogs.value
        )
          return;

        try {
          await clearLogsMutation(targetId);
          notify.success("Logs cleared");
        } catch (e) {
          notify.error("Failed to clear logs", e);
        }
      },
    });
  };

  const getGuestToken = () =>
    authStore.isGuest
      ? guestInstancesStore.getToken(resolvedInstanceId.value)
      : undefined;
  const logStream = useInstanceLogStream(resolvedInstanceId, data, refetch, {
    loadOlderPage: async (cursor) => {
      const token = getGuestToken();
      return token === undefined
        ? instancesApi.getOlderLogs(resolvedInstanceId.value, cursor)
        : guestInstancesApi.getOlderLogs(
            resolvedInstanceId.value,
            token,
            cursor,
          );
    },
    getWebSocketProtocols: () => {
      const token = getGuestToken();
      return token === undefined ? undefined : [`guest-token.${token}`];
    },
  });
  const loadOlderLogs = async () => {
    try {
      await logStream.loadOlder();
    } catch (loadError) {
      notify.error("Failed to load older logs", loadError);
    }
  };

  watch(error, async (newError) => {
    if (!isPresent(newError)) return;
    if (newError instanceof NotFoundError) {
      await router.replace({ name: "notFound" });
      return;
    }
    notify.error("Error loading instance", newError);
    await router.push({ name: authStore.hasSession ? "home" : "login" });
  });

  return {
    instance,
    canManageInstance,
    isClearingLogs,
    handleClearLogs,
    isLoadingInstance: computed(
      () => isPending.value || isPlaceholderData.value,
    ),
    logs: logStream.logs,
    hasOlderLogs: logStream.hasOlderLogs,
    isLoadingOlder: logStream.isLoadingOlder,
    loadOlderLogs,
    showNotFound: computed(
      () =>
        isFetched.value &&
        !isPending.value &&
        data.value?.instance === undefined &&
        error.value === undefined,
    ),
    error,
  };
};
