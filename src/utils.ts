export function sleep(ms: number) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
}
