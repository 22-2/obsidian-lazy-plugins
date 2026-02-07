/**
 * Interfaces extracted to break the circular dependency between
 * CommandCacheService and LazyCommandRunner.
 *
 * Each service depends on the *interface* of the other, not the concrete class.
 * The ServiceContainer wires them together via setter injection.
 */

export interface CachedCommand {
    id: string;
    name: string;
    icon?: string;
    pluginId: string;
}

/**
 * What LazyCommandRunner needs from the command cache layer.
 * Implemented by CommandCacheService.
 */
export interface CommandRegistry {
    getCachedCommand(commandId: string): CachedCommand | undefined;
    isWrapperCommand(commandId: string): boolean;
    syncCommandWrappersForPlugin(pluginId: string): void;
    removeCachedCommandsForPlugin(pluginId: string): void;
}

/**
 * What CommandCacheService needs from the plugin-loading layer.
 * Implemented by LazyCommandRunner.
 */
export interface PluginLoader {
    waitForPluginLoaded(pluginId: string, timeoutMs?: number): Promise<boolean>;
    runLazyCommand(commandId: string): Promise<void>;
}
