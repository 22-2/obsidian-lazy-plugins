import log from "loglevel";
import { TFile, WorkspaceLeaf } from "obsidian";
import { PluginLoader } from "../../core/interfaces";
import { PluginContext } from "../../core/plugin-context";
import { isPluginLoaded, rebuildLeafView } from "../../utils/utils";
import { resolvePluginForFile } from "./activation-rules";
import { LeafLockManager, LockStrategy } from "./leaf-lock";

const logger = log.getLogger("OnDemandPlugin/FileLazyLoader");

export class FileLazyLoader {
    constructor(
        private ctx: PluginContext,
        private pluginLoader: PluginLoader & { ensurePluginLoaded(pluginId: string): Promise<boolean> },
        private lockStrategy: LockStrategy<WorkspaceLeaf> = new LeafLockManager(),
    ) {}

    register(): void {
        const { app } = this.ctx;

        this.ctx.registerEvent(
            app.workspace.on("file-open", async (file: TFile | null) => {
                if (!file) return;
                
                // Allow a tiny bit of time for the workspace to update which leaf is showing the file
                await new Promise(resolve => setTimeout(resolve, 50));

                app.workspace.iterateAllLeaves((leaf) => {
                    const viewFile = (leaf.view as any).file;
                    if (viewFile === file) {
                        void this.checkFileForLazyLoading(file, leaf);
                    }
                });
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
        
        const release = await this.lockStrategy.lock(leaf);
        try {
            logger.debug(`started for ${file.path} in leaf ${leafId}`);

            const pluginId = await resolvePluginForFile(this.ctx, file);
            if (!pluginId) {
                logger.debug(`no plugin resolved for ${file.path}`);
                return;
            }

            // Skip if plugin is already loaded — nothing to do
            const wasLoaded = isPluginLoaded(this.ctx.app, pluginId, true);
            
            logger.debug(`target plugin: ${pluginId}, wasLoaded: ${wasLoaded}`);
            if (wasLoaded) {
                logger.debug(`skipping ${pluginId} as it is already loaded`);
                return;
            }

            logger.debug(`ensuring ${pluginId} is loaded...`);
            const loaded = await this.pluginLoader.ensurePluginLoaded(pluginId);
            logger.debug(`ensurePluginLoaded result for ${pluginId}: ${loaded}`);
            
            if (!loaded) {
                logger.debug(`plugin ${pluginId} loaded, rebuilding leaf view for leaf ${leafId}...`);
                return;
            }

            // Give the plugin a bit of time to settle (register views etc)
            // Some plugins might do things in queueMicrotask or setTimeout(0) during onload
            // await new Promise(resolve => setTimeout(resolve, 150));

            const oldViewType = leaf.view.getViewType();
            logger.debug(`triggering rebuildLeafView for leaf ${leafId}. Current viewType: ${oldViewType}`);
            
            await rebuildLeafView(leaf);
            
            const newViewType = leaf.view.getViewType();
            logger.debug(`rebuildLeafView completed for leaf ${leafId}. New viewType: ${newViewType}`);
            
            if (newViewType === oldViewType && oldViewType === 'markdown') {
                logger.debug(`View type remains 'markdown'. Trying forceful setViewState fallback...`);
                const state = leaf.getViewState();
                // Re-setting the state with the same file often triggers a view re-evaluation
                await leaf.setViewState(state);
                
                const finalViewType = leaf.view.getViewType();
                logger.debug(`after setViewState fallback, viewType is: ${finalViewType}`);
            }
        } finally {
            release.unlock();
        }
    }
}
