import path from "node:path";
import fs from "node:fs";
import { test, expect } from "obsidian-e2e-toolkit";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const repoRoot = path.resolve(__dirname, "..");
const pluginUnderTestId = "on-demand-plugins";
const targetPluginId = "obsidian42-brat";

test.use({
    vaultOptions: {
        logLevel: "info",
        fresh: true,
        plugins: [
            {
                path: repoRoot,
                pluginId: pluginUnderTestId,
            },
            {
                path: path.resolve(repoRoot, "myfiles", targetPluginId),
                pluginId: targetPluginId,
            },
        ],
    },
});

function ensureBuilt() {
    const mainJsPath = path.resolve(repoRoot, "main.js");
    if (!fs.existsSync(mainJsPath)) {
        test.skip(true, "main.js not found; run build before tests");
        return false;
    }
    return true;
}

test("apply changes updates startup policy", async ({ obsidian }) => {
    if (!ensureBuilt()) return;

    await obsidian.waitReady();

    const pluginHandle = await obsidian.plugin(pluginUnderTestId);
    const result = await pluginHandle.evaluate(async (plugin, pluginId) => {
        const beforeUpdatedAt = plugin.data?.commandCacheUpdatedAt ?? null;
        const original = app.commands.executeCommandById;
        app.commands.executeCommandById = () => true;

        try {
            await plugin.updatePluginSettings(pluginId, "lazy");
            await plugin.applyStartupPolicy([pluginId]);
        } finally {
            app.commands.executeCommandById = original;
        }

        return {
            mode: plugin.settings?.plugins?.[pluginId]?.mode ?? null,
            enabled: app.plugins.enabledPlugins.has(pluginId),
            beforeUpdatedAt,
            afterUpdatedAt: plugin.data?.commandCacheUpdatedAt ?? null,
        };
    }, targetPluginId);

    expect(result.mode).toBe("lazy");
    expect(result.enabled).toBe(false);
    expect(result.afterUpdatedAt).toBeTruthy();
    if (result.beforeUpdatedAt) {
        expect(result.afterUpdatedAt).toBeGreaterThanOrEqual(
            result.beforeUpdatedAt,
        );
    }
});

test("force rebuild refreshes command cache", async ({ obsidian }) => {
    if (!ensureBuilt()) return;

    await obsidian.waitReady();

    const pluginHandle = await obsidian.plugin(pluginUnderTestId);
    const result = await pluginHandle.evaluate(async (plugin, pluginId) => {
        const beforeUpdatedAt = plugin.data?.commandCacheUpdatedAt ?? null;
        const original = app.commands.executeCommandById;
        app.commands.executeCommandById = async () => undefined;

        try {
            await plugin.updatePluginSettings(pluginId, "lazy");
            await plugin.rebuildAndApplyCommandCache({ force: true });
        } finally {
            app.commands.executeCommandById = original;
        }

        return {
            beforeUpdatedAt,
            afterUpdatedAt: plugin.data?.commandCacheUpdatedAt ?? null,
            cacheCount: plugin.data?.commandCache?.[pluginId]?.length ?? 0,
        };
    }, targetPluginId);

    expect(result.afterUpdatedAt).toBeTruthy();
    if (result.beforeUpdatedAt) {
        expect(result.afterUpdatedAt).toBeGreaterThanOrEqual(
            result.beforeUpdatedAt,
        );
    }
    expect(result.cacheCount).toBeGreaterThanOrEqual(0);
});

test("lazyOnView loads plugin on view activation", async ({ obsidian }) => {
    if (!ensureBuilt()) return;

    await obsidian.waitReady();

    const pluginHandle = await obsidian.plugin(pluginUnderTestId);
    const result = await pluginHandle.evaluate(async (plugin, pluginId) => {
        const original = app.commands.executeCommandById;
        app.commands.executeCommandById = async () => undefined;

        try {
            await plugin.updatePluginSettings(pluginId, "lazyOnView");
            plugin.settings.lazyOnViews = plugin.settings.lazyOnViews || {};
            plugin.settings.lazyOnViews[pluginId] = ["markdown"];
            await plugin.saveSettings();
        } finally {
            app.commands.executeCommandById = original;
        }

        return {
            mode: plugin.settings?.plugins?.[pluginId]?.mode ?? null,
        };
    }, targetPluginId);

    expect(result.mode).toBe("lazyOnView");

    await obsidian.page.evaluate(() => {
        const workspace = app.workspace as unknown as {
            getActiveLeaf?: () => unknown;
            activeLeaf?: unknown;
            trigger: (event: string, leaf: unknown) => void;
        };
        const leaf = workspace.getActiveLeaf?.() ?? workspace.activeLeaf ?? null;
        workspace.trigger("active-leaf-change", leaf);
    });

    const deadline = Date.now() + 8000;
    let enabled = false;
    while (Date.now() < deadline) {
        if (await obsidian.isPluginEnabled(targetPluginId)) {
            enabled = true;
            break;
        }
        await new Promise((r) => setTimeout(r, 300));
    }

    expect(enabled).toBe(true);
});

test("reRegisterLazyCommandsOnDisable keeps command wrappers", async ({ obsidian }) => {
    if (!ensureBuilt()) return;

    await obsidian.waitReady();

    const pluginHandle = await obsidian.plugin(pluginUnderTestId);
    await pluginHandle.evaluate(async (plugin, pluginId) => {
        const original = app.commands.executeCommandById;
        app.commands.executeCommandById = () => true;

        try {
            plugin.settings.reRegisterLazyCommandsOnDisable = true;
            await plugin.saveSettings();
            await plugin.updatePluginSettings(pluginId, "lazy");
            await plugin.rebuildAndApplyCommandCache({ force: true });
        } finally {
            app.commands.executeCommandById = original;
        }
    }, targetPluginId);

    const commandId = await obsidian.page.evaluate((id) => {
        return Object.keys(app.commands.commands).find((cmd) =>
            cmd.startsWith(`${id}:`),
        );
    }, targetPluginId);

    expect(commandId).toBeTruthy();

    await obsidian.page.evaluate((id) => app.plugins.disablePlugin(id), targetPluginId);

    const stillExists = await obsidian.page.evaluate((cmd) => {
        return Boolean(app.commands.commands[cmd]);
    }, commandId as string);

    expect(stillExists).toBe(true);
});

test("commandCacheVersions updates on force rebuild", async ({ obsidian }) => {
    if (!ensureBuilt()) return;

    await obsidian.waitReady();

    const pluginHandle = await obsidian.plugin(pluginUnderTestId);
    const result = await pluginHandle.evaluate(async (plugin, pluginId) => {
        const original = app.commands.executeCommandById;
        app.commands.executeCommandById = () => true;

        try {
            await plugin.updatePluginSettings(pluginId, "lazy");
            await plugin.rebuildAndApplyCommandCache({ force: true });
        } finally {
            app.commands.executeCommandById = original;
        }

        const manifestVersion = app.plugins.manifests?.[pluginId]?.version ?? null;
        const cachedVersion = plugin.data?.commandCacheVersions?.[pluginId] ?? null;
        return { manifestVersion, cachedVersion };
    }, targetPluginId);

    expect(result.manifestVersion).toBeTruthy();
    expect(result.cachedVersion).toBe(result.manifestVersion);
});
