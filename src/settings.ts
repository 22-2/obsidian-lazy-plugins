/**
 * Re-export all types and constants from core/types for backward compatibility.
 * The SettingsTab UI has been moved to features/settings/settings-tab.ts.
 */
export type {
    PluginSettings,
    DeviceSettings,
    LazySettings,
    CachedCommandEntry,
    CommandCache,
    CommandCacheVersions,
    PluginMode,
} from "./core/types";

export {
    DEFAULT_DEVICE_SETTINGS,
    DEFAULT_SETTINGS,
    PluginModes,
} from "./core/types";

export { SettingsTab } from "./features/settings/settings-tab";
