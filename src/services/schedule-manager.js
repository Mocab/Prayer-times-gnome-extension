import GLib from "gi://GLib";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

import { MawaqitProvider } from "./online/mawaqit-provider.js";
import { GeoclueService } from "./local/geoclue-service.js";
import { PrayerTimesCalculator } from "./local/prayer-times-calculator.js";

export class PrayerTimeProvider {
    #settings;
    #source;
    #settingsChangedId = null;
    static #SETTING_KEYS = new Set(["prayerTimeSource", "isAutoLocation", "latitude", "longitude", "preset-methods", "fajr-angle", "isha-angle", "asr-method", "high-latitude-adjustment", "include-sunnah", "mawaqit-slug"]);
    #extensionName;
    #refreshSchedule;
    #geoclueService = null;

    constructor(settings, extensionName, refreshSchedule) {
        this.#settings = settings;
        this.#source = this.#settings.source;
        this.#extensionName = extensionName;
        this.#refreshSchedule = refreshSchedule;

        this.#settingsChangedId = this.#settings.connect("changed", (settings, key) => {
            if (PrayerTimeProvider.#SETTING_KEYS.has(key)) this.#refreshSchedule(); // TODO: pass schedule back?
        });
    }

    async buildSchedule() {
        const now = GLib.DateTime.new_now_local();
        const nowUsec = now.to_unix_usec();
        const cache = { mawaqitClient: null, timeZone: GLib.TimeZone.new_local() }; // cache for subsequent getPrayerTimes() calls within this method instance only

        const todayTimes = await this.#getPrayerTimes(now, cache);

        // before today fajr
        if (nowUsec < todayTimes.fajr.to_unix_usec()) {
            const yesterdayTimes = await this.#getPrayerTimes(now.add_days(-1), cache);
            // edge case when new day but yesterday isha hasn't passed
            if (nowUsec < yesterdayTimes.isha.to_unix_usec()) {
                const prayers = this.#buildPrayerList(yesterdayTimes);
                return { prayers, nextPrayerI: prayers.length - 1 };
            }
            // otherwise next is today fajr
            return { prayers: this.#buildPrayerList(todayTimes), nextPrayerI: 0 };
        }

        // after today isha
        if (nowUsec >= todayTimes.isha.to_unix_usec()) {
            return {
                prayers: this.#buildPrayerList(await this.#getPrayerTimes(now.add_days(1), cache)),
                nextPrayerI: 0,
            };
        }

        // between today fajr and isha
        const prayers = this.#buildPrayerList(todayTimes);
        return { prayers, nextPrayerI: prayers.findIndex((p) => p.time.to_unix_usec() > nowUsec) };
    }

    async advanceToNextDay(schedule) {
        // TODO: store schedule in class instead of passing in?
        return {
            prayers: this.#buildPrayerList(await this.#getPrayerTimes(schedule.prayers[0].time.add_days(1))),
            nextPrayerI: 0,
        };
    }

    async #getPrayerTimes(dateTime, cache = { mawaqitClient: null, timeZone: GLib.TimeZone.new_local() }) {
        const ymd = dateTime.get_ymd();

        // try Mawaqit if selected
        if (this.#source === "mawaqit") {
            try {
                cache.mawaqitClient ??= new MawaqitProvider(this.#extensionName, this.#settings.mawaqitSlug);
                return await cache.mawaqitClient.fetchPrayerTimes(ymd);
            } catch (e) {
                this.#source = "local-calculation";

                const locationType = this.#settings.isAutoLocation ? "automatic location detection" : "manual location";
                Main.notify(this.#extensionName, _("Failed to connect to Mawaqit. Defaulting to local calculations with %s: %s").format(locationType, e.message));
            }
        }

        let location = { latitude: this.#settings.latitude, longitude: this.#settings.longitude };

        // get location automatically if enabled and (if selected local calc as source or Mawaqit failed)
        if (this.#settings.isAutoLocation) {
            try {
                this.#geoclueService ??= await GeoclueService.create(this.#extensionName, this.#refreshSchedule);

                const geoclueLocation = this.#geoclueService.location;
                if (geoclueLocation.latitude == null || geoclueLocation.longitude == null) throw new Error(_("Geoclue returned no coordinates"));
                location = geoclueLocation;
            } catch (e) {
                this.#geoclueService?.destroy(); // destroy if initialised before then failed on current run
                this.#geoclueService = null;
                Main.notify(this.#extensionName, _("Failed to find location automatically. Defaulting to manual calculations: %s").format(e.message));
            }
        }

        // calculate locally
        return new PrayerTimesCalculator(ymd, cache.timeZone, location, { id: this.#settings.presetMethod, fajr: this.#settings.fajrAngle, isha: this.#settings.ishaAngle }, this.#settings.asrMethod, this.#settings.highLatAdjustment);
    }

    #buildPrayerList(prayerTimes) {
        const fajr = { id: "fajr", name: _("Fajr"), time: prayerTimes.fajr ?? null };
        const dhuhr = {
            id: "dhuhr",
            name: prayerTimes.dhuhr?.get_day_of_week() === 5 ? _("Jumaah") : _("Dhuhr"),
            time: prayerTimes.dhuhr ?? null,
        };
        const asr = { id: "asr", name: _("Asr"), time: prayerTimes.asr ?? null };
        const maghrib = { id: "maghrib", name: _("Maghrib"), time: prayerTimes.maghrib ?? null };
        const isha = { id: "isha", name: _("Isha"), time: prayerTimes.isha ?? null };

        if (!this.#settings.isIncludeSunnah) return [fajr, dhuhr, asr, maghrib, isha];
        return [fajr, { id: "duha", name: _("Duha"), time: prayerTimes.duha ?? null }, dhuhr, asr, maghrib, isha];
    }

    destroy() {
        this.#geoclueService?.destroy();
        if (this.#settingsChangedId) {
            this.#settings.disconnect(this.#settingsChangedId);
            this.#settingsChangedId = null;
        }
    }
}
