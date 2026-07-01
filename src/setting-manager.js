import Gio from "gi://Gio";
import GObject from "gi://GObject";
import Geoclue from "gi://Geoclue";
import GLib from "gi://GLib";

import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as MessageTray from "resource:///org/gnome/shell/ui/messageTray.js";

class SettingManagerClass extends GObject.Object {
    _init(gSettings, metadata, reloadMain, destroyGeoclue) {
        super._init();
        this._gSettings = gSettings;
        this._gSettingListener = {};
        this._desktopSettings = Gio.Settings.new("org.gnome.desktop.interface");
        this._reloadExtensionMain = reloadMain;
        this._destroyExtensionGeoClue = destroyGeoclue;

        const versionCache = this._gSettings.get_int("version-cache");
        if (versionCache !== metadata.version) {
            const systemSource = MessageTray.getSystemSource();
            const notification = new MessageTray.Notification({
                source: systemSource,
                title: metadata.name,
                body: _("Prayer Times updated. Review any potential breaking changes at https://github.com/Mocab/Prayer-times-gnome-extension/releases/tag/v%s. Close this to dismiss.").format(metadata.version),
            });
            notification.connect("destroy", (object, reason) => {
                if (reason === MessageTray.NotificationDestroyedReason.DISMISSED) {
                    this._gSettings.set_int("version-cache", metadata.version);
                }
            });
            systemSource.addNotification(notification);
        }

        this.location = { latitude: null, longitude: null };
        this.calcMethod = { id: null, fajr: null, isha: null };

        this._bindSimpleSettings();
        this._setupSourceSettings();
        this._setupCalcMethodSettings();
    }

    _bindSimpleSettings() {
        const settings = [
            // critical settings
            { key: "asr-method", prop: "asrMethod", type: "string", reload: true },
            { key: "high-latitude-adjustment", prop: "highLatAdjustment", type: "string", reload: true },
            { key: "fallback-auto-location", prop: "isFallbackAutoLocation", type: "boolean", reload: true },
            { key: "include-sunnah", prop: "isIncludeSunnah", type: "boolean", reload: true },
            { key: "display-mode", prop: "displayMode", type: "string", reload: true },
            { key: "reminder", prop: "reminder", type: "int", reload: true }, // TODO: if countdown then no, for display yes
            // ui settings
            { key: "notify-prayer", prop: "isNotify", type: "boolean", reload: false },
            { key: "sound-player", prop: "isSound", type: "boolean", reload: false },
        ];

        for (const { key, prop, type, reload } of settings) {
            const getter = `get_${type}`;

            this[prop] = this._gSettings[getter](key);

            this._gSettingListener[prop] = this._gSettings.connect(`changed::${key}`, (gSettings) => {
                this[prop] = gSettings[getter](key);
                if (reload) this._reloadExtensionMain();
            });
        }

        // TODO: only reload ui
        this.clockFormat = this._desktopSettings.get_string("clock-format");
        this._clockFormatListener = this._desktopSettings.connect("changed::clock-format", (gSettings, key) => {
            this.clockFormat = gSettings.get_string(key);
            this._reloadExtensionMain();
        });
    }

    _setupSourceSettings() {
        const chooseSource = () => {
            this.source = this._gSettings.get_string("source");
            switch (this.source) {
                case "mawaqit":
                    this.mawaqitSlug = this._gSettings.get_string("mawaqit-slug");
                    this._connectConditional("mawaqit-slug", "string", (slug) => (this.mawaqitSlug = slug));
                    break;
                case "auto":
                    break;
                default:
                    // manual
                    this.location.latitude = this._gSettings.get_double("latitude");
                    this.location.longitude = this._gSettings.get_double("longitude");
                    this._connectConditional("latitude", "double", (latitude) => (this.location.latitude = latitude));
                    this._connectConditional("longitude", "double", (longitude) => (this.location.longitude = longitude));
            }
        };

        chooseSource();

        this._gSettingListener.source = this._gSettings.connect("changed::source", () => {
            // clean up old conditional listeners
            this._disconnectConditional("mawaqit-slug");
            this._disconnectConditional("latitude");
            this._disconnectConditional("longitude");

            this._destroyExtensionGeoClue();

            chooseSource();
            this._reloadExtensionMain();
        });
    }

    _setupCalcMethodSettings() {
        const chooseCalcMethod = () => {
            this.calcMethod.id = this._gSettings.get_string("preset-methods");
            if (this.calcMethod.id === "custom") {
                this.calcMethod.fajr = this._gSettings.get_double("fajr-angle");
                this.calcMethod.isha = this._gSettings.get_double("isha-angle");

                this._connectConditional("fajr-angle", "double", (fajrAngle) => (this.calcMethod.fajr = fajrAngle));
                this._connectConditional("isha-angle", "double", (ishaAngle) => (this.calcMethod.isha = ishaAngle));
            } else {
                this._disconnectConditional("fajr-angle");
                this._disconnectConditional("isha-angle");
                this.calcMethod.fajr = null;
                this.calcMethod.isha = null;
            }
        };

        chooseCalcMethod();

        this._gSettingListener.calcMethod = this._gSettings.connect("changed::preset-methods", () => {
            chooseCalcMethod();
            this._reloadExtensionMain();
        });
    }

    _connectConditional(key, type, callback) {
        if (!this._gSettingListener[key]) {
            this._gSettingListener[key] = this._gSettings.connect(`changed::${key}`, (gSettings) => {
                callback(gSettings[`get_${type}`](key));
                this._reloadExtensionMain();
            });
        }
    }
    _disconnectConditional(key) {
        if (this._gSettingListener[key]) {
            this._gSettings.disconnect(this._gSettingListener[key]);
            this._gSettingListener[key] = null;
        }
    }

    destroy() {
        if (this._clockFormatListener) {
            this._desktopSettings.disconnect(this._clockFormatListener);
            this._clockFormatListener = null;
        }
        this._desktopSettings = null;

        for (const key in this._gSettingListener) {
            if (this._gSettingListener[key]) this._gSettings.disconnect(this._gSettingListener[key]);
        }
        this._gSettingListener = null;
        this._gSettings = null;
    }
}
export const SettingManager = GObject.registerClass(SettingManagerClass);
