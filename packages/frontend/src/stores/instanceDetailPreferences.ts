import { defineStore } from "pinia";
import type { LogType } from "shared";
import { ref, watch } from "vue";

const STORAGE_KEY = "httpworkbench.instanceDetail.preferences";
const DEFAULT_LOG_TYPES: LogType[] = ["http", "dns", "smtp"];

type InstanceDetailPreferences = {
  autoCollapseLogs: boolean;
  sidePanelHidden: boolean;
  selectedLogTypes: LogType[];
};

const isLogType = (value: unknown): value is LogType =>
  value === "http" || value === "dns" || value === "smtp";

const getDefaultPreferences = (): InstanceDetailPreferences => ({
  autoCollapseLogs: false,
  sidePanelHidden: false,
  selectedLogTypes: [...DEFAULT_LOG_TYPES],
});

const getStorage = (): Storage | undefined => {
  if (typeof window === "undefined") {
    return undefined;
  }

  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
};

const readPreferences = (): InstanceDetailPreferences => {
  try {
    const stored = getStorage()?.getItem(STORAGE_KEY);
    if (stored === undefined || stored === null) {
      return getDefaultPreferences();
    }

    const parsed = JSON.parse(stored) as Partial<InstanceDetailPreferences>;
    const selectedLogTypes = Array.isArray(parsed.selectedLogTypes)
      ? [...new Set(parsed.selectedLogTypes.filter(isLogType))]
      : DEFAULT_LOG_TYPES;

    return {
      autoCollapseLogs: parsed.autoCollapseLogs === true,
      sidePanelHidden:
        typeof parsed.sidePanelHidden === "boolean"
          ? parsed.sidePanelHidden
          : false,
      selectedLogTypes,
    };
  } catch {
    return getDefaultPreferences();
  }
};

const writePreferences = (preferences: InstanceDetailPreferences) => {
  try {
    getStorage()?.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {}
};

export const useInstanceDetailPreferencesStore = defineStore(
  "instanceDetailPreferences",
  () => {
    const stored = readPreferences();
    const autoCollapseLogs = ref(stored.autoCollapseLogs);
    const sidePanelHidden = ref(stored.sidePanelHidden);
    const selectedLogTypes = ref(stored.selectedLogTypes);

    watch(
      [autoCollapseLogs, sidePanelHidden, selectedLogTypes],
      ([nextAutoCollapseLogs, nextSidePanelHidden, nextSelectedLogTypes]) => {
        writePreferences({
          autoCollapseLogs: nextAutoCollapseLogs,
          sidePanelHidden: nextSidePanelHidden,
          selectedLogTypes: nextSelectedLogTypes,
        });
      },
      { deep: true, flush: "sync" },
    );

    return {
      autoCollapseLogs,
      sidePanelHidden,
      selectedLogTypes,
    };
  },
);
