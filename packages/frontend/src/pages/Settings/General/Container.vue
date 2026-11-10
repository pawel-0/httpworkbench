<script setup lang="ts">
import ToggleSwitch from "primevue/toggleswitch";
import { storeToRefs } from "pinia";
import { useInstanceDetailPreferencesStore } from "@/stores/instanceDetailPreferences";

const { autoCollapseLogs } = storeToRefs(useInstanceDetailPreferencesStore());
</script>

<template>
  <div class="min-w-0 max-w-full sm:max-w-3xl">
    <div class="mb-6">
      <h2 class="text-2xl font-semibold text-surface-900 dark:text-surface-0">
        General
      </h2>
      <p class="mt-1 text-sm text-surface-600 dark:text-surface-300">
        Customize how incoming requests are displayed.
      </p>
    </div>
    <div
      class="rounded-lg border border-surface-200 bg-white dark:border-surface-700 dark:bg-surface-800"
    >
      <div class="flex items-center justify-between gap-4 px-4 py-4 sm:px-5">
        <div class="min-w-0">
          <label
            for="auto-collapse-logs"
            class="cursor-pointer text-sm font-medium text-surface-900 dark:text-surface-0"
            >Automatically collapse incoming requests</label
          >
          <p
            id="auto-collapse-logs-description"
            class="mt-1 text-sm text-surface-600 dark:text-surface-300"
          >
            Show HTTP, DNS, and SMTP requests collapsed by default. You can
            expand each request individually.
          </p>
        </div>
        <ToggleSwitch
          v-model="autoCollapseLogs"
          input-id="auto-collapse-logs"
          aria-describedby="auto-collapse-logs-description"
          class="shrink-0"
        />
      </div>
    </div>
    <p class="mt-4 text-xs text-surface-500 dark:text-surface-400">
      Changes are saved automatically in this browser.
    </p>
  </div>
</template>
