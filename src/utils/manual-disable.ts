const recentDisabled = new Map<string, number>();

export function markManualDisabled(pluginId: string): void {
    recentDisabled.set(pluginId, Date.now());
}

export function wasManuallyDisabledRecently(pluginId: string, withinMs = 5000): boolean {
    const t = recentDisabled.get(pluginId);
    if (!t) return false;
    if (Date.now() - t > withinMs) {
        recentDisabled.delete(pluginId);
        return false;
    }
    return true;
}
