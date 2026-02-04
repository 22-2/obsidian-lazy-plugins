import { App, EventRef, WorkspaceLeaf } from "obsidian";
import { PluginMode } from "../settings";
import { isLeafVisible, rebuildLeafView } from "../utils";

interface ViewLazyLoaderDeps {
    app: App;
    registerEvent: (eventRef: EventRef) => void;
    getPluginMode: (pluginId: string) => PluginMode;
    getLazyOnViews: () => Record<string, string[]> | undefined;
    ensurePluginLoaded: (pluginId: string) => Promise<boolean>;
    syncCommandWrappersForPlugin: (pluginId: string) => void;
    isLayoutReady: () => boolean;
}

export class ViewLazyLoader {
    constructor(private deps: ViewLazyLoaderDeps) {}

    registerActiveLeafReload(): void {
        this.deps.registerEvent(
            this.deps.app.workspace.on(
                "active-leaf-change",
                this.initializeLazyViewForLeaf.bind(this),
            ),
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
        if (!isLeafVisible(leaf)) return;

        const pluginId = this.getPluginIdForViewType(leaf.view.getViewType());
        if (!pluginId) return;

        if (this.deps.getPluginMode(pluginId) !== "lazyOnView") return;

        const loaded = await this.deps.ensurePluginLoaded(pluginId);
        if (!loaded) return;

        // Force a view reconstruction after a lazy plugin is loaded, ensuring the view is properly initialized.
        await rebuildLeafView(leaf);
        this.deps.syncCommandWrappersForPlugin(pluginId);
    }

    async checkViewTypeForLazyLoading(viewType: string): Promise<void> {
        if (!viewType) return;
        if (!this.deps.isLayoutReady()) return;

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
}
