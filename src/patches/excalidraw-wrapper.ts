import log from "loglevel";
import { App, TFile, WorkspaceLeaf, EventRef } from "obsidian";
import { PluginContext } from "../core/plugin-context";
import { PluginLoader } from "../core/interfaces";

const logger = log.getLogger("ExcalidrawWrapper");

const EXCALIDRAW_PLUGIN_ID = "obsidian-excalidraw-plugin";

function isExcalidrawFile(app: App, file: TFile | null | undefined): boolean {
    if (!file) return false;
    try {
        if (file.extension === "excalidraw") return true;
        // also treat files with frontmatter key `excalidraw-plugin` as Excalidraw
        const cache = app.metadataCache.getFileCache(file as any);
        return !!cache?.frontmatter && Object.prototype.hasOwnProperty.call(cache.frontmatter, "excalidraw-plugin");
    } catch (e) {
        return false;
    }
}

export function registerExcalidrawWrapper(
    ctx: PluginContext,
    pluginLoader: PluginLoader & { ensurePluginLoaded(pluginId: string): Promise<boolean> },
) {
    const { app } = ctx;

    // Handle file-open: when a file that is an Excalidraw drawing is opened, ensure plugin is loaded first
    ctx.registerEvent(
        app.workspace.on("file-open", async (file: TFile | null) => {
            if (!file) return;
            if (!isExcalidrawFile(app, file)) return;
            const mode = ctx.getPluginMode(EXCALIDRAW_PLUGIN_ID);
            if (mode !== "lazyOnView") return;

            await pluginLoader.ensurePluginLoaded(EXCALIDRAW_PLUGIN_ID);
            // After plugin loaded, attempt to open the file in the proper view (plugin will register view types)
            try {
                const leaf = app.workspace.getLeaf(false) as WorkspaceLeaf;
                if (leaf && file) {
                    // openFile will let the freshly-loaded plugin take over and set its view
                    await leaf.openFile(file);
                }
            } catch (e) {
                logger.error("ExcalidrawWrapper: error opening Excalidraw file after plugin load", e);
            }
        }),
    );

    // Handle layout restore: iterate leaves and load plugin for any excalidraw files that are present
    app.workspace.onLayoutReady(() => {
        if (!app.workspace.layoutReady) return;
        app.workspace.iterateAllLeaves((leaf: WorkspaceLeaf) => {
            try {
                const state: any = (leaf.view as any)?.getState?.() ?? {};
                const path = state?.file ?? null;
                if (!path) return;
                const f = app.vault.getAbstractFileByPath(path) as TFile | null;
                if (!f) return;
                if (!isExcalidrawFile(app, f)) return;
                const mode = ctx.getPluginMode(EXCALIDRAW_PLUGIN_ID);
                if (mode !== "lazyOnView") return;
                // ensure plugin loaded, then try to re-open file in this leaf
                void pluginLoader.ensurePluginLoaded(EXCALIDRAW_PLUGIN_ID).then(async (loaded) => {
                    if (!loaded) return;
                    try {
                        await leaf.openFile(f);
                    } catch (e) {
                        logger.error("ExcalidrawWrapper: error opening Excalidraw file during layout restore", e);
                    }
                });
            } catch (e) {
                logger.error("ExcalidrawWrapper: error during layout restore", e);
            }
        });
    });
}
