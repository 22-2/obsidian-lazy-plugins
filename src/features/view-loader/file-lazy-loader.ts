import { TFile, WorkspaceLeaf } from "obsidian";
import { PluginContext } from "../../core/plugin-context";
import { PluginLoader } from "../../core/interfaces";
import { rebuildLeafView, isPluginLoaded, PluginsMap } from "../../utils/utils";
import { resolvePluginForFile } from "./activation-rules";
import log from "loglevel";

const logger = log.getLogger("OnDemandPlugin/FileLazyLoader");

export class FileLazyLoader {
    /** Guard against re-entrant calls caused by rebuildLeafView firing file-open */
    private processing = new WeakSet<WorkspaceLeaf>();

    constructor(
        private ctx: PluginContext,
        private pluginLoader: PluginLoader & { ensurePluginLoaded(pluginId: string): Promise<boolean> },
    ) {}

    register(): void {
        const { app } = this.ctx;

        this.ctx.registerEvent(
            app.workspace.on("file-open", async (file: TFile | null) => {
                if (!file) return;
                const leaf = app.workspace.getLeaf(false);
                if (leaf) {
                    await this.checkFileForLazyLoading(file, leaf);
                }
            }),
        );

        // Initial layout scan
        app.workspace.onLayoutReady(() => {
            app.workspace.iterateAllLeaves((leaf) => {
                try {
                    const state: any = (leaf.view as any)?.getState?.() ?? {};
                    const path = state?.file ?? null;
                    if (!path) return;
                    const f = app.vault.getAbstractFileByPath(path);
                    if (f instanceof TFile) {
                        void this.checkFileForLazyLoading(f, leaf);
                    }
                } catch (e) {
                    logger.debug("FileLazyLoader: error during layout scan", e);
                }
            });
        });
    }

    private async checkFileForLazyLoading(file: TFile, leaf: WorkspaceLeaf): Promise<void> {
        const leafId = (leaf as any).id || 'unknown';
        logger.debug(`[LazyPlugins] checkFileForLazyLoading: started for ${file.path} in leaf ${leafId}`);

        // Re-entry guard
        if (this.processing.has(leaf)) {
            logger.debug(`[LazyPlugins] checkFileForLazyLoading: skipped (processing) for leaf ${leafId}`);
            return;
        }

        const pluginId = await resolvePluginForFile(this.ctx, file);
        if (!pluginId) {
            logger.debug(`[LazyPlugins] checkFileForLazyLoading: no plugin resolved for ${file.path}`);
            return;
        }

        // Skip if plugin is already loaded — nothing to do
        const wasLoaded = isPluginLoaded(this.ctx.app, pluginId);
        
        logger.debug(`[LazyPlugins] checkFileForLazyLoading: target plugin: ${pluginId}, wasLoaded: ${wasLoaded}`);
        if (wasLoaded) return;

        this.processing.add(leaf);
        try {
            const loaded = await this.pluginLoader.ensurePluginLoaded(pluginId);
            logger.debug(`[LazyPlugins] checkFileForLazyLoading: ensurePluginLoaded result: ${loaded}`);
            if (loaded) {
                logger.debug(`[LazyPlugins] checkFileForLazyLoading: triggering rebuildLeafView for leaf ${leafId}`);
                try {
                    await rebuildLeafView(leaf);
                    logger.debug(`[LazyPlugins] checkFileForLazyLoading: rebuildLeafView completed for leaf ${leafId}`);
                } catch (e) {
                    logger.debug(`[LazyPlugins] FileLazyLoader: error rebuilding view for ${pluginId}`, e);
                }
            }
        } finally {
            this.processing.delete(leaf);
        }
    }
}
