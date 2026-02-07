import { App, EventRef, WorkspaceLeaf, debounce } from "obsidian";
import { Mutex } from "async-mutex";
import { PluginMode } from "../settings";
import { isLeafVisible, rebuildLeafView, isPluginLoaded, PluginsMap } from "../utils/utils";
import log from "loglevel";

interface ViewLazyLoaderDeps {
    app: App;
    registerEvent: (eventRef: EventRef) => void;
    getPluginMode: (pluginId: string) => PluginMode;
    getLazyOnViews: () => Record<string, string[]> | undefined;
    ensurePluginLoaded: (pluginId: string) => Promise<boolean>;
    syncCommandWrappersForPlugin: (pluginId: string) => void;
}

const logger = log.getLogger("OnDemandPlugin/ViewLazyLoader");

export class ViewLazyLoader {
    private leafMutexes = new WeakMap<WorkspaceLeaf, Mutex>();
    private lastProcessed = new WeakMap<WorkspaceLeaf, { viewType: string; at: number }>();
    private readonly reentryWindowMs = 1500; // ms
    private debouncedInitializeLazyViewForLeaf = debounce(
        this.initializeLazyViewForLeaf.bind(this),
        100,
        true,
    );

    constructor(private deps: ViewLazyLoaderDeps) {}

    registerActiveLeafReload(): void {
        this.deps.registerEvent(
            this.deps.app.workspace.on("active-leaf-change", this.debouncedInitializeLazyViewForLeaf),
        );

        // Initial load
        this.deps.app.workspace.onLayoutReady(() =>
            this.deps.app.workspace.iterateAllLeaves((leaf) => {
                void this.initializeLazyViewForLeaf(leaf);
            }),
        );
    }

    async initializeLazyViewForLeaf(leaf: WorkspaceLeaf): Promise<void> {
        // Avoid loading lazy-on-view plugins during layout restoration.
        if (!this.deps.app.workspace.layoutReady) return;
        if (!leaf) return;

        const mutex = this.getLeafMutex(leaf);
        await mutex.runExclusive(async () => {
            if (!this.deps.app.workspace.layoutReady) return;
            if (!isLeafVisible(leaf)) return;

            const viewType = leaf.view.getViewType();

            const last = this.lastProcessed.get(leaf);
            if (last && last.viewType === viewType && Date.now() - last.at < this.reentryWindowMs) {
                return;
            }
            const pluginId = this.getPluginIdForViewType(viewType);
            if (!pluginId) return;

            if (this.deps.getPluginMode(pluginId) !== "lazyOnView") return;

            // If the plugin was already loaded, there's no need to rebuild the view
            const plugins = (this.deps.app as unknown as { plugins?: PluginsMap }).plugins;
            const wasLoaded = isPluginLoaded(plugins, pluginId);

            const loaded = await this.deps.ensurePluginLoaded(pluginId);
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

            this.deps.syncCommandWrappersForPlugin(pluginId);
            // record that we processed this leaf+viewType
            this.lastProcessed.set(leaf, { viewType, at: Date.now() });
        });
    }

    async checkViewTypeForLazyLoading(viewType: string): Promise<void> {
        if (!viewType) return;
        if (!this.deps.app.workspace.layoutReady) return;

        const lazyOnViews = this.deps.getLazyOnViews() || {};
        for (const [pluginId, viewTypes] of Object.entries(lazyOnViews)) {
            if (viewTypes.includes(viewType)) {
                const mode = this.deps.getPluginMode(pluginId);
                if (mode === "lazyOnView") {
                    await this.deps.ensurePluginLoaded(pluginId);
                }
            }
        }
    }

    private getPluginIdForViewType(viewType: string): string | null {
        const lazyOnViews = this.deps.getLazyOnViews() || {};
        for (const [pluginId, viewTypes] of Object.entries(lazyOnViews)) {
            if (viewTypes.includes(viewType)) {
                return pluginId;
            }
        }
        return null;
    }

    private getLeafMutex(leaf: WorkspaceLeaf): Mutex {
        const existing = this.leafMutexes.get(leaf);
        if (existing) return existing;

        const created = new Mutex();
        this.leafMutexes.set(leaf, created);
        return created;
    }
}
