import GLib from "gi://GLib";
import Gio from "gi://Gio";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import { MawaqitClient } from "./online/mawaqit-client.js";
import { CalculationProvider } from "./local/calculation-provider.js";

export class ScheduleManager {
    #settings;
    #settingsChangedId = null;
    #scheduleGeneration = 0;
    static #SETTING_KEYS = new Set(["prayer-time-source", "auto-location", "latitude", "longitude", "preset-methods", "fajr-angle", "isha-angle", "asr-method", "high-latitude-adjustment", "include-sunnah", "mawaqit-slug"]);
    #metadata;
    #schedule = { prayers: [], nextPrayerI: 0 };

    constructor(settings, metadata, reInit) {
        this.#settings = settings;
        this.#metadata = metadata;
        this.#settingsChangedId = settings.connect("changed", (_settings, key) => {
            if (ScheduleManager.#SETTING_KEYS.has(key)) reInit();
        });
    }

    get schedule() {
        return this.#schedule;
    }
    get nextPrayer() {
        return this.#schedule.prayers[this.#schedule.nextPrayerI];
    }
    get nextPrayerIndex() {
        return this.#schedule.nextPrayerI;
    }

    async buildSchedule() {
        const scheduleGeneration = ++this.#scheduleGeneration;
        const provider = await this.#getProvider();
        if (scheduleGeneration !== this.#scheduleGeneration) return false;

        const now = GLib.DateTime.new_now_local();
        const todayTimes = await this.#getTimes(provider, now);
        if (scheduleGeneration !== this.#scheduleGeneration) return false;

        // before today fajr
        if (now.compare(todayTimes.fajr) < 0) {
            const yesterdayTimes = await this.#getTimes(provider, now.add_days(-1));
            if (scheduleGeneration !== this.#scheduleGeneration) return false;
            // edge case when new day but yesterday isha hasn't passed
            if (now.compare(yesterdayTimes.isha) < 0) {
                const prayers = this.#buildPrayerList(yesterdayTimes);
                this.#schedule = { prayers, nextPrayerI: prayers.length - 1 };
                return true;
            }
            // otherwise next is today fajr
            this.#schedule = { prayers: this.#buildPrayerList(todayTimes), nextPrayerI: 0 };
            return true;
        }

        // after today isha
        if (now.compare(todayTimes.isha) >= 0) {
            const tomorrowTimes = await this.#getTimes(provider, now.add_days(1));
            if (scheduleGeneration !== this.#scheduleGeneration) return false;

            this.#schedule = {
                prayers: this.#buildPrayerList(tomorrowTimes),
                nextPrayerI: 0,
            };
            return true;
        }

        // between today fajr and isha
        const prayers = this.#buildPrayerList(todayTimes);
        this.#schedule = { prayers, nextPrayerI: prayers.findIndex((p) => p.time.compare(now) > 0) };
        return true;
    }

    async advanceToNextPrayer() {
        if (this.#schedule.nextPrayerI < this.#schedule.prayers.length - 1) {
            this.#schedule.nextPrayerI++;
            return false;
        }

        const currentSchedule = this.#schedule;
        const scheduleGeneration = this.#scheduleGeneration;
        const provider = await this.#getProvider();
        if (scheduleGeneration !== this.#scheduleGeneration || currentSchedule !== this.#schedule) return false;

        const tomorrowTimes = await this.#getTimes(provider, currentSchedule.prayers[0].time.add_days(1));
        if (scheduleGeneration !== this.#scheduleGeneration || currentSchedule !== this.#schedule) return false;

        this.#schedule = { prayers: this.#buildPrayerList(tomorrowTimes), nextPrayerI: 0 };
        return true;
    }

    refreshIcons() {
        for (const prayer of this.#schedule.prayers) prayer.icon = this.#createIcon(prayer.id);
    }

    async #getProvider() {
        // to optimise for buildSchedule(), store all cache in provider class and provide getTimes() method
        if (this.#settings.prayerTimeSource === "mawaqit") {
            try {
                return await MawaqitClient.create(this.#settings, this.#metadata.name);
            } catch (e) {
                const locationType = this.#settings.isAutoLocation ? "automatic location detection" : "manual location";
                Main.notify(this.#metadata.name, _("Failed to connect to Mawaqit. Defaulting to local calculations with %s: %s").format(locationType, e.message));
            }
        }
        return await CalculationProvider.init(this.#settings, this.#metadata.name);
    }

    async #getTimes(provider, dateTime) {
        try {
            return await provider.getTimes(dateTime);
        } catch (e) {
            if (this.#settings.prayerTimeSource !== "mawaqit") throw e;

            Main.notify(this.#metadata.name, _("Mawaqit prayer data is unavailable for this date. Defaulting to local calculations: %s").format(e.message));
            const localProvider = await CalculationProvider.init(this.#settings, this.#metadata.name);
            return localProvider.getTimes(dateTime);
        }
    }

    #buildPrayerList(prayerTimes) {
        const prayer = (id, name) => ({ id, name, time: prayerTimes[id] ?? null, icon: this.#createIcon(id) });

        const fajr = prayer("fajr", _("Fajr"));
        const dhuhr = prayer("dhuhr", prayerTimes.dhuhr.get_day_of_week() === 5 ? _("Jumaah") : _("Dhuhr"));
        const asr = prayer("asr", _("Asr"));
        const maghrib = prayer("maghrib", _("Maghrib"));
        const isha = prayer("isha", _("Isha"));

        return this.#settings.isIncludeSunnah && prayerTimes.duha //
            ? [fajr, prayer("duha", _("Duha")), dhuhr, asr, maghrib, isha]
            : [fajr, dhuhr, asr, maghrib, isha];
    }

    #createIcon(id) {
        const iconPath = this.#metadata.path + "/assets/icons/";
        const iconSuffix = this.#settings.useSymbolicIcons ? "-symbolic.svg" : ".svg";
        return Gio.icon_new_for_string(iconPath + id + iconSuffix);
    }

    destroy() {
        this.#scheduleGeneration++;
        if (this.#settingsChangedId) {
            this.#settings.disconnect(this.#settingsChangedId);
            this.#settingsChangedId = null;
        }
    }
}
