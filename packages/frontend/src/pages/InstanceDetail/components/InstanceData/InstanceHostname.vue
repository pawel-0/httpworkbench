<script setup lang="ts">
import { toRefs, computed } from "vue";
import Button from "primevue/button";
import { type Instance } from "shared";
import { config } from "@/config";
import { useSetInstanceSubdomain } from "@/queries/domains/useInstances";
import { useInstanceSubdomain } from "./useInstanceSubdomain";

const props = defineProps<{ instance: Instance; editable: boolean }>();
const emit = defineEmits<{ copy: [] }>();
const { instance, editable } = toRefs(props);
const { mutateAsync } = useSetInstanceSubdomain();
const { draft, dirty, error, valid, saving, save, discard } =
  useInstanceSubdomain(instance, editable, (id, subdomain) =>
    mutateAsync({ id, subdomain }),
  );
const hint = computed(() => {
  const protocols = [
    "HTTP",
    "HTTPS",
    ...(config.dnsEnabled ? ["DNS"] : []),
    ...(config.smtpEnabled ? ["SMTP"] : []),
  ];
  return `Send ${protocols.join(", ")} requests to this host to see them appear in the logs.`;
});
</script>

<template>
  <div class="flex flex-col gap-2">
    <label
      for="instance-host-input"
      class="text-sm font-medium text-surface-700 dark:text-surface-300"
      >Hostname</label
    >
    <div class="flex flex-wrap items-center gap-2">
      <div
        class="flex min-w-0 flex-1 items-center rounded-md border border-surface-300 bg-surface-50 px-3 dark:border-surface-600 dark:bg-surface-800 focus-within:ring-1 focus-within:ring-primary"
        :class="{ 'border-red-500!': error }"
      >
        <input
          id="instance-host-input"
          v-model="draft"
          :readonly="!editable"
          :disabled="saving"
          maxlength="63"
          aria-label="Instance subdomain"
          :aria-invalid="!!error"
          aria-describedby="instance-host-hint instance-host-error"
          autocomplete="off"
          autocapitalize="none"
          :spellcheck="false"
          class="w-0 min-w-12 flex-1 bg-transparent py-2 font-mono text-sm text-surface-900 outline-none dark:text-surface-0"
          @keydown.enter.prevent="save"
          @keydown.esc.prevent="discard"
        />
        <span class="shrink-0 font-mono text-sm text-surface-500"
          >.{{ config.instancesDomain }}</span
        >
      </div>
      <Button
        icon="pi pi-copy"
        severity="secondary"
        outlined
        size="small"
        aria-label="Copy active interaction host"
        title="Copy active hostname"
        @click="emit('copy')"
      />
      <template v-if="editable && dirty">
        <Button
          icon="pi pi-check"
          outlined
          size="small"
          aria-label="Save hostname"
          title="Save hostname (Enter)"
          :loading="saving"
          :disabled="!valid || saving"
          @click="save"
        />
        <Button
          icon="pi pi-times"
          severity="secondary"
          outlined
          size="small"
          aria-label="Discard hostname changes"
          title="Discard changes (Escape)"
          :disabled="saving"
          @click="discard"
        />
      </template>
    </div>
    <p
      v-if="error"
      id="instance-host-error"
      role="alert"
      class="text-xs text-red-500"
    >
      {{ error }}
    </p>
    <p
      id="instance-host-hint"
      class="text-xs text-surface-600 dark:text-surface-400"
    >
      {{
        dirty
          ? "Saving changes the hostname. The previous hostname will stop working."
          : hint
      }}
    </p>
  </div>
</template>
