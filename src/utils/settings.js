import Gio from "gi://Gio";
import * as MessageTray from "resource:///org/gnome/shell/ui/messageTray.js";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";

class Settings {
    #gSettings = null;
    #desktopSettings = null;
    constructor(gSettings, metadata) {
        this.#gSettings = gSettings;

        const settingsSchema = [
            { prop: "source", key: "source", type: "s" },
            { prop: "prayerTimeSource", key: "prayer-time-source", type: "s" },
            { prop: "isAutoLocation", key: "auto-location", type: "b" },
            { prop: "latitude", key: "latitude", type: "d" },
            { prop: "longitude", key: "longitude", type: "d" },
            { prop: "presetMethod", key: "preset-methods", type: "s" },
            { prop: "fajrAngle", key: "fajr-angle", type: "d" },
            { prop: "ishaAngle", key: "isha-angle", type: "d" },
            { prop: "asrMethod", key: "asr-method", type: "s" },
            { prop: "highLatAdjustment", key: "high-latitude-adjustment", type: "s" },
            { prop: "isIncludeSunnah", key: "include-sunnah", type: "b" },
            { prop: "mawaqitSlug", key: "mawaqit-slug", type: "s" },
            { prop: "displayMode", key: "display-mode", type: "s" },
            { prop: "isNotify", key: "notify-prayer", type: "b" },
            { prop: "isSound", key: "sound-player", type: "b" },
            { prop: "reminder", key: "reminder", type: "i" },
        ];
        const getters = {
            s: "get_string",
            i: "get_int",
            d: "get_double",
            b: "get_boolean",
        };
        for (const setting of settingsSchema) {
            Object.defineProperty(Settings.prototype, setting.prop, {
                get() {
                    return this.#gSettings[getters[setting.type]](setting.key);
                },
                enumerable: true,
                configurable: false,
            });
        }

        this.#desktopSettings = Gio.Settings.new("org.gnome.desktop.interface");
        Object.defineProperty(Settings.prototype, "timeFormat", {
            get() {
                return this.#desktopSettings.get_string("clock-format") === "12h" ? _("%-I:%M %p") : _("%R");
            },
            enumerable: true,
            configurable: false,
        });

        const schemaVersion = gSettings.get_int("version-cache");

        // setting migration
        if (schemaVersion >= 16 && schemaVersion <= 19) {
            switch (this.source) {
                case "mawaqit":
                    gSettings.set_string("prayer-time-source", "mawaqit");
                    gSettings.set_boolean("auto-location", gSettings.get_boolean("fallback-auto-location"));
                    break;
                case "auto":
                    gSettings.set_string("prayer-time-source", "local-calculation");
                    gSettings.set_boolean("auto-location", true);
                    break;
                case "manual":
                    gSettings.set_string("prayer-time-source", "local-calculation");
                    gSettings.set_boolean("auto-location", false);
                    break;
            }
        }

        if (schemaVersion < metadata.version) {
            const systemSource = MessageTray.getSystemSource();
            const repoUrl = `https://github.com/Mocab/Prayer-times-gnome-extension/releases/tag/v${metadata.version}`;

            const notification = new MessageTray.Notification({
                source: systemSource,
                title: _("%s Updated").format(metadata.name),
                body: _("Extension has been updated to v%d. Please review any potential breaking changes.").format(metadata.version),
                urgency: MessageTray.Urgency.HIGH,
            });

            notification.addAction(_("Review Changes"), () => {
                Gio.AppInfo.launch_default_for_uri(repoUrl, null);
                this.#gSettings.set_int("version-cache", metadata.version);
            });
            notification.addAction(_("Dismiss"), () => {
                notification.destroy();
                this.#gSettings.set_int("version-cache", metadata.version);
            });

            notification.connect("destroy", (_notification, reason) => {
                if (reason === MessageTray.NotificationDestroyedReason.DISMISSED) this.#gSettings.set_int("version-cache", metadata.version);
            });

            systemSource.addNotification(notification);
        }
    }

    connect(signal, callback, isDesktopSetting = false) {
        if (isDesktopSetting) return this.#desktopSettings.connect(signal, callback);
        return this.#gSettings.connect(signal, callback);
    }

    disconnect(id, isDesktopSetting = false) {
        if (isDesktopSetting) {
            this.#desktopSettings.disconnect(id);
            return;
        }
        this.#gSettings.disconnect(id);
    }
}
