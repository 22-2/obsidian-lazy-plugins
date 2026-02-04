import { around } from "monkey-around";
import { Plugins } from "obsidian-typings";
import { DeviceSettings, PluginMode } from "../settings";
import { CommandCacheService } from "../services/command-cache-service";

interface PatchPluginEnableDisableDeps {
    register: (unload: () => void) => void;
    obsidianPlugins: Plugins;
    getPluginMode: (pluginId: string) => PluginMode;
    settings: DeviceSettings;
    commandCacheService: CommandCacheService;
}

export function patchPluginEnableDisable(
    deps: PatchPluginEnableDisableDeps,
): void {
    const {
        register,
        obsidianPlugins,
        getPluginMode,
        settings,
        commandCacheService,
    } = deps;

    register(
        around(obsidianPlugins, {
            enablePlugin: (next) =>
                async function (this: Plugins, pluginId: string) {
                    const result = await next.call(this, pluginId);
                    commandCacheService.syncCommandWrappersForPlugin(pluginId);
                    return result;
                },
            disablePlugin: (next) =>
                async function (this: Plugins, pluginId: string) {
                    const result = await next.call(this, pluginId);
                    const mode = getPluginMode(pluginId);
                    const shouldReRegister =
                        settings.reRegisterLazyCommandsOnDisable ?? true;
                    if (
                        shouldReRegister &&
                        (mode === "lazy" || mode === "lazyOnView")
                    ) {
                        await commandCacheService.ensureCommandsCached(pluginId);
                        commandCacheService.registerCachedCommandsForPlugin(
                            pluginId,
                        );
                    }
                    return result;
                },
        }),
    );
}
