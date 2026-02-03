import { App, PluginManifest } from "obsidian";
import { ProgressDialog } from "../progress";
import { lazyPluginId } from "../constants";
import { PluginMode } from "../settings";

interface StartupPolicyDeps {
  app: App;
  getManifests: () => PluginManifest[];
  getPluginMode: (pluginId: string) => PluginMode;
  applyPluginState: (pluginId: string) => Promise<void>;
  writeCommunityPluginsFile: (enabledPlugins: string[]) => Promise<void>;
  getLazyWithViews: () => Record<string, string[]> | undefined;
  saveLazyWithViews: (next: Record<string, string[]>) => Promise<void>;
  ensurePluginLoaded: (pluginId: string) => Promise<boolean>;
}

export class StartupPolicyService {
  private startupPolicyLock: Promise<void> | null = null;
  private startupPolicyPending = false;
  private startupPolicyDebounceTimer: number | null = null;
  private startupPolicyDebounceMs = 100;

  constructor(private deps: StartupPolicyDeps) {}

  async apply(showProgress = false) {
    if (this.startupPolicyLock) {
      this.startupPolicyPending = true;
      await this.startupPolicyLock;
      if (this.startupPolicyPending) {
        this.startupPolicyPending = false;
        await this.apply(showProgress);
      }
      return;
    }

    const run = async () => {
      if (this.startupPolicyDebounceTimer) {
        window.clearTimeout(this.startupPolicyDebounceTimer);
      }

      await new Promise<void>((resolve) => {
        this.startupPolicyDebounceTimer = window.setTimeout(() => {
          this.startupPolicyDebounceTimer = null;
          resolve();
        }, this.startupPolicyDebounceMs);
      });

      const desiredEnabled = new Set<string>();
      this.deps.getManifests().forEach((plugin) => {
        if (this.deps.getPluginMode(plugin.id) === "keepEnabled") {
          desiredEnabled.add(plugin.id);
        }
      });
      desiredEnabled.add(lazyPluginId);

      await this.deps.writeCommunityPluginsFile(
        [...desiredEnabled].sort((a, b) => a.localeCompare(b)),
      );

      let progress: ProgressDialog | null = null;
      if (showProgress) {
        progress = new ProgressDialog(this.deps.app, {
          title: "Applying plugin startup policy",
          total: this.deps.getManifests().length,
        });
        progress.open();
      }

      const { viewRegistry } = this.deps.app as unknown as {
        viewRegistry?: {
          registerView?: (type: string, creator: unknown) => unknown;
        };
      };

      const lazyWithViews: Record<string, string[]> = {
        ...(this.deps.getLazyWithViews() ?? {}),
      };

      const originalRegisterView = viewRegistry?.registerView;
      if (viewRegistry && typeof originalRegisterView === "function") {
        viewRegistry.registerView = (type: string, creator: unknown) => {
          const loadingPluginId = (this.deps.app as unknown as { plugins?: any })
            ?.plugins?.loadingPluginId as string | undefined;

          if (
            loadingPluginId &&
            this.deps.getPluginMode(loadingPluginId) === "lazyWithView" &&
            typeof type === "string" &&
            type.length > 0
          ) {
            if (!lazyWithViews[loadingPluginId]) {
              lazyWithViews[loadingPluginId] = [];
            }
            if (!lazyWithViews[loadingPluginId].includes(type)) {
              lazyWithViews[loadingPluginId].push(type);
            }
          }

          return originalRegisterView.apply(viewRegistry, [type, creator]);
        };
      }

      try {
        let index = 0;
        for (const plugin of this.deps.getManifests()) {
          index += 1;
          progress?.setStatus(`Applying ${plugin.name}`);
          progress?.setProgress(index);
          if (this.deps.getPluginMode(plugin.id) === "lazyWithView") {
            await this.deps.ensurePluginLoaded(plugin.id);
          }
          await this.deps.applyPluginState(plugin.id);
        }
      } finally {
        if (viewRegistry && originalRegisterView) {
          viewRegistry.registerView = originalRegisterView;
        }
        for (const plugin of this.deps.getManifests()) {
          if (this.deps.getPluginMode(plugin.id) !== "lazyWithView") {
            delete lazyWithViews[plugin.id];
          }
        }
        await this.deps.saveLazyWithViews(lazyWithViews);
        progress?.close();
      }
    };

    this.startupPolicyLock = run();
    try {
      await this.startupPolicyLock;
    } finally {
      this.startupPolicyLock = null;
    }

    if (this.startupPolicyPending) {
      this.startupPolicyPending = false;
      await this.apply(showProgress);
    }
  }
}
