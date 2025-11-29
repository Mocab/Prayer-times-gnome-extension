import Gio from "gi://Gio";
import GObject from "gi://GObject";
import Geoclue from "gi://Geoclue";
import GLib from "gi://GLib";

import * as Main from "resource:///org/gnome/shell/ui/main.js";

class SettingManagerClass extends GObject.Object {
    _init(extension) {
        super._init();
        this._gSettings = extension.getSettings();
        this._id = extension.metadata["settings-schema"];
        this._name = extension.metadata.name;
        this._reloadExtensionMain = extension._reloadMain;

        const gnomeSettings = Gio.Settings.new("org.gnome.desktop.interface"); // TODO: is it really worth it to .connect()?
        this.clockFormat = gnomeSettings.get_string("clock-format");

        // Location group
        this.isAutoLocation = this._gSettings.get_boolean("auto-location");
        this.location = {};
        if (this.isAutoLocation) {
            this._enableGeoclue();
        } else {
            this.location.latitude = this._gSettings.get_double("latitude");
            this.location.longitude = this._gSettings.get_double("longitude");
        }
        // Calculation group
        this.calcAngles = {};
        this.calcAngles.id = this._gSettings.get_string("preset-angles");
        if (this.calcAngles.id === "custom") {
            this.calcAngles.fajr = this._gSettings.get_double("fajr-angle");
            this.calcAngles.isha = this._gSettings.get_double("isha-angle");
        }

        this.asrMethod = this._gSettings.get_string("asr-method");
        this.highLatitudeMethod = this._gSettings.get_string("high-latitude-method");
        this.includeSunnah = this._gSettings.get_boolean("include-sunnah");
        // Notification group
        this.isNotifyPrayer = this._gSettings.get_boolean("notify-prayer");
        this.isAthanPrayer = this._gSettings.get_boolean("athan-prayer");
        this.reminder = this._gSettings.get_int("reminder");
    }

    _enableGeoclue() {
        Geoclue.Simple.new_with_thresholds(this._id, Geoclue.AccuracyLevel.STREET, 60, 200, null, (source, result) => {
            try {
                this._geoclueService = Geoclue.Simple.new_with_thresholds_finish(result);

                const location = this._geoclueService.get_location();
                this.location.latitude = location.latitude;
                this.location.longitude = location.longitude;

                this._geoclueServiceListener = this._geoclueService.connect("notify::location", (response) => {
                    const newLocation = response.get_location();
                    this.location.latitude = newLocation.latitude;
                    this.location.longitude = newLocation.longitude;
                    this._reloadExtensionMain();
                });
            } catch (error) {
                Main.notifyError(this._name, "Failed to connect to Geoclue, defaulting to manual location: " + error.message);
                this._gSettings.set_value("auto-location", GLib.Variant.new_boolean(false));
            }
        });
    }

    connectSettings() {
        this._gSettingListener = {};
        // Location group
        this._gSettingListener.isAutoLocation = this._gSettings.connect("changed::auto-location", (gSetting, key) => {
            if (gSetting.get_boolean(key)) {
                this._gSettings.disconnect(this._gSettingListener.latitude);
                this._gSettings.disconnect(this._gSettingListener.longitude);
                this._gSettingListener.latitude = null;
                this._gSettingListener.longitude = null;

                this.location = this._enableGeoclue();
            } else {
                this._geoclueService.disconnect(this._geoclueServiceListener);
                this._geoclueServiceListener = null;
                this._geoclueService = null;

                this.location.latitude = this._gSettings.get_double("latitude");
                this.location.longitude = this._gSettings.get_double("longitude");

                this._gSettingListener.latitude = this._gSettings.connect("changed::latitude", (gSetting, key) => {
                    this.location.latitude = gSetting.get_double(key);
                    this._reloadExtensionMain();
                });
                this._gSettingListener.longitude = this._gSettings.connect("changed::longitude", (gSetting, key) => {
                    this.location.longitude = gSetting.get_double(key);
                    this._reloadExtensionMain();
                });
            }
        });
        // Calculation group
        this._gSettingListener.presetAngles = this._gSettings.connect("changed::preset-angles", (gSetting, key) => {
            const presetAngleId = gSetting.get_string(key);
            this.calcAngles.id = id;
            if (presetAngleId === "custom") {
                this._gSettingListener.fajrAngle = this._gSettings.connect("changed::fajr-angle", (gSetting, key) => {
                    this.calcAngles.fajr = gSetting.get_double(key);
                    this._reloadExtensionMain();
                });
                this._gSettingListener.ishaAngle = this._gSettings.connect("changed::isha-angle", (gSetting, key) => {
                    this.calcAngles.isha = gSetting.get_double(key);
                    this._reloadExtensionMain();
                });
            } else {
                this._gSettings.disconnect(this._gSettingListener.fajrAngle);
                this._gSettings.disconnect(this._gSettingListener.ishaAngle);
                this._gSettingListener.fajrAngle = null;
                this._gSettingListener.ishaAngle = null;

                this.calcAngles.fajr = null;
                this.calcAngles.isha = null;

                this._reloadExtensionMain();
            }
        });
        this._gSettingListener.asrMethod = this._gSettings.connect("changed::asr-method", (gSetting, key) => {
            this.asrMethod = gSetting.get_string(key);
            this._reloadExtensionMain();
        });
        this._gSettingListener.highLatitudeMethod = this._gSettings.connect("changed::high-latitude-method", (gSetting, key) => {
            this.highLatitudeMethod = gSetting.get_string(key);
            this._reloadExtensionMain();
        });
        this._gSettingListener.isIncludeSunnah = this._gSettings.connect("changed::include-sunnah", (gSetting, key) => {
            this.isIncludeSunnah = gSetting.get_string(key);
            this._reloadExtensionMain();
        });
        // Notification group
        this._gSettingListener.isNotifyPrayer = this._gSettings.connect("changed::notify-prayer", (gSetting, key) => {
            this.isNotifyPrayer = gSetting.get_boolean(key);
        });
        this._gSettingListener.isAthanPrayer = this._gSettings.connect("changed::athan-prayer", (gSetting, key) => {
            this.isAthanPrayer = gSetting.get_boolean(key);
        });
        this._gSettingListener.reminder = this._gSettings.connect("changed::reminder", (gSetting, key) => {
            this.reminder = gSetting.get_int(key);
        });
    }

    destroy() {
        for (let listener in this._gSettingListener) {
            if (listener) {
                this._gSettings.disconnect(listener);
                listener = null;
            }
        }
        if (this._geoclueService) {
            this._geoclueService.disconnect(this._geoclueServiceListener);
            this._geoclueServiceListener = null;
            this._geoclueService = null;
        }
        this._gSettings = null;
    }
}
export const SettingManager = GObject.registerClass(SettingManagerClass);
