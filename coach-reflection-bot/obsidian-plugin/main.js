const {
  Plugin,
  PluginSettingTab,
  Setting,
  Notice,
  requestUrl,
  normalizePath,
} = require("obsidian");

const DEFAULT_SETTINGS = {
  endpoint: "",
  token: "",
  intervalMinutes: 10,
  weeks: 2,
};

module.exports = class CoachReflectionSyncPlugin extends Plugin {
  async onload() {
    this.settings = Object.assign(
      {},
      DEFAULT_SETTINGS,
      await this.loadData(),
    );

    this.addSettingTab(new CoachReflectionSyncSettingTab(this.app, this));

    this.addCommand({
      id: "sync-coach-observations-now",
      name: "Sync coaching observations now",
      callback: () => this.syncNow(true),
    });

    this.app.workspace.onLayoutReady(() => {
      this.syncNow(false);
    });

    const ms = Math.max(1, Number(this.settings.intervalMinutes || 10)) * 60 * 1000;
    this.registerInterval(
      window.setInterval(() => this.syncNow(false), ms),
    );
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async ensureFolder(folderPath) {
    const normalized = normalizePath(folderPath);
    if (!normalized) return;

    const parts = normalized.split("/");
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(current)) {
        try {
          await this.app.vault.createFolder(current);
        } catch (_) {
          // Another sync may have created it between check and create.
        }
      }
    }
  }

  async syncNow(showNotice) {
    const endpoint = String(this.settings.endpoint || "").replace(/\/$/, "");
    const token = String(this.settings.token || "").trim();

    if (!endpoint || !token) {
      if (showNotice) {
        new Notice("Coach Reflection Sync: set endpoint and token first.");
      }
      return;
    }

    try {
      const response = await requestUrl({
        url: `${endpoint}/obsidian/export?weeks=${Math.max(
          1,
          Math.min(4, Number(this.settings.weeks || 2)),
        )}`,
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const payload = response.json;
      if (!payload?.ok || !Array.isArray(payload.files)) {
        throw new Error("Unexpected sync response");
      }

      let changed = 0;
      for (const item of payload.files) {
        const path = normalizePath(item.path);
        const content = String(item.content || "");
        const folder = path.split("/").slice(0, -1).join("/");
        await this.ensureFolder(folder);

        const existing = this.app.vault.getAbstractFileByPath(path);
        if (existing && "extension" in existing) {
          const current = await this.app.vault.read(existing);
          if (current !== content) {
            await this.app.vault.modify(existing, content);
            changed++;
          }
        } else {
          await this.app.vault.create(path, content);
          changed++;
        }
      }

      if (showNotice) {
        new Notice(
          changed
            ? `Coach Reflection Sync: updated ${changed} file(s).`
            : "Coach Reflection Sync: already up to date.",
        );
      }
    } catch (error) {
      console.error("Coach Reflection Sync failed", error);
      if (showNotice) {
        new Notice(`Coach Reflection Sync failed: ${error.message || error}`);
      }
    }
  }
};

class CoachReflectionSyncSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Coach Reflection Sync" });

    new Setting(containerEl)
      .setName("Worker endpoint")
      .setDesc("Example: https://coach-reflection-bot.<subdomain>.workers.dev")
      .addText((text) =>
        text
          .setPlaceholder("https://...")
          .setValue(this.plugin.settings.endpoint)
          .onChange(async (value) => {
            this.plugin.settings.endpoint = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Sync token")
      .setDesc("Same value as OBSIDIAN_SYNC_TOKEN in Cloudflare Secrets.")
      .addText((text) => {
        text.inputEl.type = "password";
        text
          .setPlaceholder("secret")
          .setValue(this.plugin.settings.token)
          .onChange(async (value) => {
            this.plugin.settings.token = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Interval, minutes")
      .setDesc("How often to refresh generated weekly notes while Obsidian is open.")
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.intervalMinutes))
          .onChange(async (value) => {
            const n = Number(value);
            if (Number.isFinite(n) && n >= 1) {
              this.plugin.settings.intervalMinutes = n;
              await this.plugin.saveSettings();
            }
          }),
      );

    new Setting(containerEl)
      .setName("Weeks to sync")
      .setDesc("1–4 most recent weeks.")
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.weeks))
          .onChange(async (value) => {
            const n = Number(value);
            if (Number.isFinite(n) && n >= 1 && n <= 4) {
              this.plugin.settings.weeks = n;
              await this.plugin.saveSettings();
            }
          }),
      );
  }
}
