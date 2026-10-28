import GLib from "gi://GLib";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import { GeoclueService } from "./geoclue-service.js";
import { PrayerTimesCalculator } from "./prayer-times-calculator.js";

export class CalculationProvider {
    #settings;
    #settingsChangedId = null;
    static #SETTING_KEYS = new Set(["isAutoLocation", "latitude", "longitude", "preset-methods", "fajr-angle", "isha-angle", "asr-method", "high-latitude-adjustment", "include-sunnah"]);
    #extensionName;
    #geoclueService = null;

    constructor(settings, extensionName, refreshSchedule) {
        this.#settings = settings;
        this.#extensionName = extensionName;

        this.#settingsChangedId = settings.connect("changed", (_settings, key) => {
            if (CalculationProvider.#SETTING_KEYS.has(key)) refreshSchedule();
        });
    }

    async calculatePrayerTimes(ymd) {
        return new PrayerTimesCalculator(
            ymd,
            GLib.TimeZone.new_local(), // TODO: cache timezone
            await this.#resolveLocation(),
            {
                id: this.#settings.presetMethod,
                fajr: this.#settings.fajrAngle,
                isha: this.#settings.ishaAngle,
            },
            this.#settings.asrMethod,
            this.#settings.highLatAdjustment,
        );
    }

    async #resolveLocation() {
        if (this.#settings.isAutoLocation) {
            try {
                this.#geoclueService ??= GeoclueService(this.#extensionName);
                return await this.#geoclueService.getLocation();
            } catch (e) {
                this.#geoclueService?.destroy();
                this.#geoclueService = null;
                Main.notify(this.#extensionName, _("Failed to find location automatically. Defaulting to manual calculations: %s").format(e.message));
            }
        }
        return { latitude: this.#settings.latitude, longitude: this.#settings.longitude };
    }

    destroy() {
        if (this.#settingsChangedId) {
            this.#settings.disconnect(this.#settingsChangedId);
            this.#settingsChangedId = null;
        }
        if (this.#geoclueService) {
            this.#geoclueService.destroy();
            this.#geoclueService = null;
        }
    }
}
