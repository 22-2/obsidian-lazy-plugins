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
        app.commands.executeCommandById = async () => undefined;

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
