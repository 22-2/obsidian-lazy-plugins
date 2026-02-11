import { WorkspaceLeaf, debounce } from "obsidian";
import { PluginContext } from "../../core/plugin-context";
import { CommandRegistry, PluginLoader } from "../../core/interfaces";
import { isLeafVisible, rebuildLeafView, isPluginLoaded, PluginsMap } from "../../utils/utils";
import { LockStrategy, LeafViewLockStrategy } from "./leaf-lock";
import { resolvePluginForViewType } from "./activation-rules";
import log from "loglevel";

const logger = log.getLogger("OnDemandPlugin/ViewLazyLoader");

export class ViewLazyLoader {
    /** Guard against re-entrant calls caused by rebuildLeafView firing active-leaf-change */
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
        if (!this.ctx.app.workspace.layoutReady) return;
        if (!leaf) return;
        
        const viewType = leaf.view.getViewType();
        const leafId = leaf.id || 'unknown';
        
        logger.debug(`[LazyPlugins] initializeLazyViewForLeaf: started for leaf ${leafId}, viewType: ${viewType}`);

        const release = await this.lockStrategy.lock({ leaf, viewType });
        try {
            if (!this.ctx.app.workspace.layoutReady) return;
            if (!isLeafVisible(leaf)) {
                logger.debug(`[LazyPlugins] initializeLazyViewForLeaf: skipped (not visible) for leaf ${leafId}`);
                return;
            }

            // Re-entry guard: skip if we recently processed this leaf+viewType
            const last = this.lastProcessed.get(leaf);
            if (last && last.viewType === viewType && Date.now() - last.at < this.reentryWindowMs) {
                logger.debug(`[LazyPlugins] initializeLazyViewForLeaf: skipped (recent) for leaf ${leafId}`);
                return;
            }

            const pluginId = resolvePluginForViewType(this.ctx, viewType);
            if (!pluginId) {
                logger.debug(`[LazyPlugins] initializeLazyViewForLeaf: no plugin found for viewType: ${viewType}`);
                return;
            }

            // Check if plugin was already loaded before we try to load it
            const wasLoaded = isPluginLoaded(this.ctx.app, pluginId, true);
            
            logger.debug(`[LazyPlugins] initializeLazyViewForLeaf: target plugin: ${pluginId}, wasLoaded: ${wasLoaded}`);

            const loaded = await this.pluginLoader.ensurePluginLoaded(pluginId);
            logger.debug(`[LazyPlugins] initializeLazyViewForLeaf: ensurePluginLoaded result: ${loaded}`);
            if (!loaded) return;

            // Only rebuild the view if the plugin was freshly loaded
            if (!wasLoaded) {
                await rebuildLeafView(leaf);
            }

            this.commandRegistry.syncCommandWrappersForPlugin(pluginId);
            this.lastProcessed.set(leaf, { viewType, at: Date.now() });
        } finally {
            release.unlock();
        }
    }

    async checkViewTypeForLazyLoading(viewType: string): Promise<void> {
        if (!viewType) return;
        if (!this.ctx.app.workspace.layoutReady) return;

        const pluginId = resolvePluginForViewType(this.ctx, viewType);
        if (pluginId) {
            await this.pluginLoader.ensurePluginLoaded(pluginId);
        }
    }
}
