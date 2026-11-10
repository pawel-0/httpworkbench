<script setup lang="ts">
import type { Log } from "shared";
import { computed, toRefs } from "vue";
import { useTimeAgo } from "@vueuse/core";
import dayjs from "dayjs";
import { getLogSummary } from "./getLogSummary";
import { HTTPLog } from "./components/HTTPLog";
import { DNSLog } from "./components/DNSLog";
import { SMTPLog, useSmtpLogDisplay } from "./components/SMTPLog";

const props = defineProps<{
  log: Log;
  collapsed?: boolean;
}>();
const emit = defineEmits<{ toggle: [] }>();
const summary = computed(() => getLogSummary(props.log));

const { log } = toRefs(props);
const {
  displayModeLabel: smtpDisplayModeLabel,
  displayedRaw: smtpDisplayedRaw,
  nextDisplayModeLabel: nextSmtpDisplayModeLabel,
  toggleDisplayMode: toggleSmtpDisplayMode,
} = useSmtpLogDisplay(() => log.value.raw);

const badgeClass = computed(() => {
  switch (log.value.type) {
    case "http":
      return "border-sky-400/30 bg-sky-400/10 text-sky-600 dark:text-sky-300";
    case "dns":
      return "border-amber-400/30 bg-amber-400/10 text-amber-700 dark:text-amber-300";
    case "smtp":
      return "border-violet-400/30 bg-violet-400/10 text-violet-600 dark:text-violet-300";
    default:
      return "border-surface-300/40 bg-surface-300/10 text-surface-600 dark:text-surface-300";
  }
});

const relativeTimestamp = useTimeAgo(() => log.value.timestamp);
const formattedTimestamp = computed(() => {
  const logDate = dayjs(log.value.timestamp);
  if (dayjs().diff(logDate, "day") >= 1) {
    return logDate.format("MMM D, YYYY h:mm A");
  }
  return relativeTimestamp.value;
});

const absoluteTimestamp = computed(() =>
  dayjs(log.value.timestamp).format("MMM D, YYYY h:mm:ss A"),
);

const smtpDisplayModeTitle = computed(
  () => `Switch to ${nextSmtpDisplayModeLabel.value} SMTP log`,
);

const smtpDisplayModeIcon = computed(() =>
  smtpDisplayModeLabel.value === "decoded" ? "pi pi-code" : "pi pi-file",
);

const handleMouseLeave = (event: MouseEvent) => {
  const card = event.currentTarget;
  const active = document.activeElement;
  if (
    card instanceof HTMLElement &&
    active instanceof HTMLElement &&
    card.contains(active) &&
    active.closest(".cm-editor") !== null
  ) {
    active.blur();
  }
};
</script>

<template>
  <div
    class="border border-surface-200 dark:border-surface-700 rounded-lg overflow-hidden bg-white dark:bg-surface-800 shadow-sm"
    @mouseleave="handleMouseLeave"
  >
    <div
      class="flex items-center gap-2 bg-surface-50 text-xs text-surface-700 dark:bg-surface-900/50 dark:text-surface-400"
      :class="{
        'border-b border-surface-200 dark:border-surface-700': !collapsed,
      }"
    >
      <button
        type="button"
        class="flex min-w-0 flex-1 cursor-pointer flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-left hover:bg-surface-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary dark:hover:bg-surface-800 sm:px-4 sm:py-3"
        :aria-expanded="!collapsed"
        :aria-controls="`log-body-${log.id}`"
        @click="emit('toggle')"
      >
        <span class="flex min-w-0 flex-[1_1_15rem] items-center gap-2">
          <i
            :class="collapsed ? 'pi pi-chevron-right' : 'pi pi-chevron-down'"
            class="shrink-0 text-[10px]"
            aria-hidden="true"
          />
          <span
            class="shrink-0 rounded border px-1.5 py-0.5 font-semibold leading-none"
            :class="badgeClass"
          >
            {{ log.type.toUpperCase() }}
          </span>
          <span
            class="min-w-0 truncate font-mono text-surface-800 dark:text-surface-200"
            :title="collapsed ? summary : log.address"
            >{{ collapsed ? summary : log.address }}</span
          >
        </span>
        <span
          class="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-x-2 gap-y-1"
        >
          <span class="inline-flex min-w-0 items-center gap-2">
            <template v-if="collapsed">
              <span class="min-w-0 truncate font-mono" :title="log.address">{{
                log.address
              }}</span>
              <span class="text-surface-600 dark:text-surface-500">•</span>
            </template>
            <span class="whitespace-nowrap" :title="absoluteTimestamp">{{
              formattedTimestamp
            }}</span>
          </span>
          <span
            class="hidden items-center gap-2 whitespace-nowrap text-surface-600 dark:text-surface-500 min-[420px]:inline-flex"
            ><span>•</span><span>{{ absoluteTimestamp }}</span></span
          >
        </span>
      </button>
      <button
        v-if="log.type === 'smtp' && !collapsed"
        type="button"
        class="mr-3 inline-flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-md border border-surface-300 bg-white px-2 text-[11px] font-semibold capitalize leading-none text-surface-700 shadow-sm hover:bg-surface-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-700 dark:bg-surface-800 dark:text-surface-200 dark:hover:bg-surface-700"
        :aria-label="smtpDisplayModeTitle"
        :title="smtpDisplayModeTitle"
        @click="toggleSmtpDisplayMode"
      >
        <i
          :class="smtpDisplayModeIcon"
          class="text-[10px]"
          aria-hidden="true"
        />
        {{ smtpDisplayModeLabel }}
      </button>
    </div>
    <div :id="`log-body-${log.id}`" :hidden="collapsed" class="p-0">
      <template v-if="!collapsed">
        <HTTPLog v-if="log.type === 'http'" :log="log" />
        <DNSLog v-else-if="log.type === 'dns'" :log="log" />
        <SMTPLog v-else-if="log.type === 'smtp'" :raw="smtpDisplayedRaw" />
        <div v-else class="p-4 text-surface-700 dark:text-surface-400">
          Unknown log type
        </div>
      </template>
    </div>
  </div>
</template>
