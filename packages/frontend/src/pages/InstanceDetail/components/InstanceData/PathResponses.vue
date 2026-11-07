<script setup lang="ts">
import { toRefs } from "vue";
import Button from "primevue/button";
import Dialog from "primevue/dialog";
import InputText from "primevue/inputtext";
import { useConfirm } from "primevue/useconfirm";
import { type Instance, MAX_PATH_RESPONSES } from "shared";
import { HttpEditor } from "@/components/HttpEditor";
import { useSetPathResponses } from "@/queries/domains/useInstances";
import { usePathResponses } from "./usePathResponses";

const props = defineProps<{ instance: Instance; editable: boolean }>();
const { instance, editable } = toRefs(props);
const confirm = useConfirm();
const { mutateAsync } = useSetPathResponses();
const {
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
} = usePathResponses(instance, editable, (id, pathResponses) =>
  mutateAsync({ id, pathResponses }),
);

const confirmRemove = (target: string) =>
  confirm.require({
    header: "Remove path override?",
    message: `${target} will use the default response again.`,
    rejectProps: { label: "Cancel", severity: "secondary", outlined: true },
    acceptProps: { label: "Remove", severity: "danger" },
    accept: () => {
      void remove(target);
    },
  });
</script>

<template>
  <section class="flex shrink-0 flex-col gap-2" aria-label="Path overrides">
    <div class="flex items-center justify-between gap-2">
      <h3 class="font-semibold text-surface-900 dark:text-surface-0">
        Path overrides
        <span class="font-normal text-surface-500"
          >({{ responses.length }})</span
        >
      </h3>
      <Button
        v-if="editable"
        label="Add path"
        icon="pi pi-plus"
        severity="secondary"
        outlined
        size="small"
        :disabled="saving || responses.length >= MAX_PATH_RESPONSES"
        @click="open()"
      />
    </div>
    <p class="text-xs text-surface-600 dark:text-surface-400">
      Exact paths use their own response. Everything else uses the default.
    </p>
    <p v-if="responses.length === 0" class="text-xs text-surface-500">
      No path overrides.
    </p>
    <ul
      v-else
      class="max-h-36 overflow-y-auto rounded border border-surface-200 dark:border-surface-700 divide-y divide-surface-200 dark:divide-surface-700"
    >
      <li
        v-for="response in responses"
        :key="response.path"
        class="flex items-center justify-between gap-2 px-2 py-1"
      >
        <code class="min-w-0 flex-1 truncate text-sm" :title="response.path">{{
          response.path
        }}</code>
        <Button
          :icon="editable ? 'pi pi-pencil' : 'pi pi-eye'"
          severity="secondary"
          text
          size="small"
          :aria-label="`${editable ? 'Edit' : 'View'} response for ${response.path}`"
          :disabled="saving"
          @click="open(response)"
        />
        <Button
          v-if="editable"
          icon="pi pi-trash"
          severity="danger"
          text
          size="small"
          :aria-label="`Remove response for ${response.path}`"
          :disabled="saving"
          @click="confirmRemove(response.path)"
        />
      </li>
    </ul>
    <p v-if="serverError && !visible" role="alert" class="text-xs text-red-500">
      {{ serverError }}
    </p>
    <Dialog
      v-model:visible="visible"
      modal
      :header="
        !editable
          ? 'Path response'
          : editingPath === undefined
            ? 'Add path override'
            : 'Edit path override'
      "
      :style="{ width: '54rem' }"
      :breakpoints="{ '640px': '95vw' }"
      :closable="!saving"
      :close-on-escape="!saving"
    >
      <form class="flex min-w-0 flex-col gap-3" @submit.prevent="save">
        <label for="response-path" class="text-sm font-medium">Path</label>
        <InputText
          id="response-path"
          v-model="path"
          placeholder="/callback"
          aria-label="Response path"
          aria-describedby="response-path-hint"
          :readonly="!editable"
          :disabled="saving"
          :maxlength="2048"
          class="w-full font-mono"
          autocomplete="off"
        />
        <p id="response-path-hint" class="text-xs text-surface-500">
          Case-sensitive exact match, ignoring query strings. /callback and
          /callback/ are different paths. Applies to every HTTP method.
        </p>
        <label class="text-sm font-medium">Raw HTTP response</label>
        <div class="h-80 min-h-0 overflow-hidden rounded-md">
          <HttpEditor
            v-model="raw"
            :readonly="!editable || saving"
            syntax="response"
            @save="save"
          />
        </div>
        <p v-if="error" role="alert" class="text-sm text-red-500">
          {{ error }}
        </p>
        <div class="flex justify-end gap-2">
          <Button
            :label="editable ? 'Cancel' : 'Close'"
            severity="secondary"
            outlined
            :disabled="saving"
            @click="visible = false"
          />
          <Button
            v-if="editable"
            label="Save path response"
            type="submit"
            icon="pi pi-check"
            :loading="saving"
            :disabled="!canSave"
          />
        </div>
      </form>
    </Dialog>
  </section>
</template>
