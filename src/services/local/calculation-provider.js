import Geoclue from "gi://Geoclue";
import GLib from "gi://GLib";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import { PrayerTimesCalculator } from "./prayer-times-calculator.js";

export class CalculationProvider {
    #settings;
    #timezone = GLib.TimeZone.new_local();
    #locationCache = { latitude: null, longitude: null };

    constructor(settings) {
        this.#settings = settings;
    }
    static async init(settings, extensionName) {
        const provider = new CalculationProvider(settings);
        provider.#locationCache = await provider.#resolveLocation(extensionName);
        return provider;
    }
    async #resolveLocation(extensionName) {
        if (settings.isAutoLocation) {
            try {
                return await new Promise((resolve, reject) => {
                    Geoclue.Simple.new_with_thresholds(extensionName, Geoclue.AccuracyLevel.NEIGHBORHOOD, 600, 5000, null, (_source, result) => {
                        let proxy = null;
                        try {
                            proxy = Geoclue.Simple.new_with_thresholds_finish(result);
                            const location = proxy?.get_location();
                            if (!location) throw new Error(_("Automatic location is unavailable."));

                            resolve({ latitude: location.latitude, longitude: location.longitude });
                        } catch (e) {
                            reject(e);
                        } finally {
                            proxy?.get_client()?.call_stop(null, null);
                        }
                    });
                });
            } catch (e) {
                Main.notify(extensionName, _("Failed to find location automatically. Defaulting to manual location: %s").format(e.message));
            }
        }
        return { latitude: this.#settings.latitude, longitude: this.#settings.longitude };
    }

    calculatePrayerTimes(ymd) {
        return new PrayerTimesCalculator(
            ymd,
            this.#timezone,
            this.#locationCache,
            {
                id: this.#settings.presetMethod,
                fajr: this.#settings.fajrAngle,
                isha: this.#settings.ishaAngle,
            },
            this.#settings.asrMethod,
            this.#settings.highLatAdjustment,
        );
    }
}
