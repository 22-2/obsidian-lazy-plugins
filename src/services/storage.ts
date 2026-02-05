import type { App } from "obsidian";
import store from "store2";
import invariant from "tiny-invariant";

function getVaultId(app: App): string {
    invariant(app, "App/Plugin/ID is required");
    // @ts-expect-error
    invariant(app.appId, "invalid App/Plugin ID");
    // @ts-expect-error
    return app.appId;
    
}

export function vaultKey(app: App, prefix: string) {
    const appId = getVaultId(app);
    return `on-demand:${prefix}:${appId}`;
}

export function loadJSON<T = unknown>(app: App, prefix: string): T | undefined {
    try {
        const key = vaultKey(app, prefix);
        return store.get(key) as T | undefined;
    } catch (e) {
        return undefined;
    }
}

export function saveJSON<T = unknown>(app: App, prefix: string, value: T) {
    try {
        const key = vaultKey(app, prefix);
        store.set(key, value);
    } catch (e) {
        // ignore storage errors
    }
}
