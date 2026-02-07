import { WorkspaceLeaf, debounce } from "obsidian";
import { PluginContext } from "../../core/plugin-context";
import { CommandRegistry, PluginLoader } from "../../core/interfaces";
import { isLeafVisible, rebuildLeafView, isPluginLoaded, PluginsMap } from "../../utils/utils";
import { LockStrategy, LeafViewLockStrategy } from "./leaf-lock";
import log from "loglevel";

const logger = log.getLogger("OnDemandPlugin/ViewLazyLoader");

export class ViewLazyLoader {
    private lastProcessed = new WeakMap<WorkspaceLeaf, { viewType: string; at: number }>();
    private readonly reentryWindowMs = 1500; // ms
    private debouncedInitializeLazyViewForLeaf = debounce(
        this.initializeLazyViewForLeaf.bind(this),
        100,
        true,
    );

    constructor(
        private ctx: PluginContext,
        private pluginLoader: PluginLoader & { ensurePluginLoaded(pluginId: string): Promise<boolean> },
        private commandRegistry: CommandRegistry,
        private lockStrategy: LockStrategy<{ leaf: WorkspaceLeaf; viewType: string }> = new LeafViewLockStrategy(),
    ) {}

    registerActiveLeafReload(): void {
        this.ctx.registerEvent(
            this.ctx.app.workspace.on("active-leaf-change", this.debouncedInitializeLazyViewForLeaf),
        );

        // Initial load
        this.ctx.app.workspace.onLayoutReady(() =>
            this.ctx.app.workspace.iterateAllLeaves((leaf) => {
                void this.initializeLazyViewForLeaf(leaf);
            }),
        );
    }

    async initializeLazyViewForLeaf(leaf: WorkspaceLeaf): Promise<void> {
        // Avoid loading lazy-on-view plugins during layout restoration.
        if (!this.ctx.app.workspace.layoutReady) return;
        if (!leaf) return;
        const viewType = leaf.view.getViewType();

        const release = await this.lockStrategy.lock({ leaf, viewType });
        try {
            if (!this.ctx.app.workspace.layoutReady) return;
            if (!isLeafVisible(leaf)) return;

            const last = this.lastProcessed.get(leaf);
            if (last && last.viewType === viewType && Date.now() - last.at < this.reentryWindowMs) {
                return;
            }
            const pluginId = this.getPluginIdForViewType(viewType);
            if (!pluginId) return;

            if (this.ctx.getPluginMode(pluginId) !== "lazyOnView") return;

            // If the plugin was already loaded, there's no need to rebuild the view
            const plugins = (this.ctx.app as unknown as { plugins?: PluginsMap }).plugins;
            const wasLoaded = isPluginLoaded(plugins, pluginId);

            const loaded = await this.pluginLoader.ensurePluginLoaded(pluginId);
            if (!loaded) return;

            // Only reconstruct the view if the plugin was not already loaded before this call.
            if (!wasLoaded) {
                try {
                    await rebuildLeafView(leaf);
                } catch (e) {
                    // Keep behaviour consistent with other callers: don't throw on rebuild failure
                    // (logging is handled elsewhere)
                    logger.debug(`ViewLazyLoader: error rebuilding view for leaf after loading plugin ${pluginId}`, e);
                }
            }

            this.commandRegistry.syncCommandWrappersForPlugin(pluginId);
            // record that we processed this leaf+viewType
            this.lastProcessed.set(leaf, { viewType, at: Date.now() });
        } finally {
            release.unlock();
        }
    }

    async checkViewTypeForLazyLoading(viewType: string): Promise<void> {
        if (!viewType) return;
        if (!this.ctx.app.workspace.layoutReady) return;

        const lazyOnViews = this.ctx.getSettings().lazyOnViews || {};
        for (const [pluginId, viewTypes] of Object.entries(lazyOnViews)) {
            if (viewTypes.includes(viewType)) {
                const mode = this.ctx.getPluginMode(pluginId);
                if (mode === "lazyOnView") {
                    await this.pluginLoader.ensurePluginLoaded(pluginId);
                }
            }
        }
    }

    private getPluginIdForViewType(viewType: string): string | null {
        const lazyOnViews = this.ctx.getSettings().lazyOnViews || {};
        for (const [pluginId, viewTypes] of Object.entries(lazyOnViews)) {
            if (viewTypes.includes(viewType)) {
                return pluginId;
            }
        }
        return null;
    }
}
