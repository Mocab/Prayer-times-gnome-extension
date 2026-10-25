import GLib from "gi://GLib";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

import { MawaqitClient } from "./mawaqit-client.js";
import { GeoclueService } from "./geoclue-service.js";
import { CalcPrayerTimes } from "./calc-prayer-times.js";

export class PrayerTimeProvider {
    #settings;
    #source;
    #extensionName;
    #refreshSchedule;
    #geoclueService = null;

    constructor(settings, extensionName, refreshSchedule) {
        this.#settings = settings;
        this.#source = this.#settings.source;
        this.#extensionName = extensionName;
        this.#refreshSchedule = refreshSchedule;
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
                cache.mawaqitClient ??= new MawaqitClient(this.#extensionName, this.#settings.mawaqitSlug);
                return await cache.mawaqitClient.fetchPrayerTimes(ymd);
            } catch (e) {
                const useAuto = this.#settings.isFallbackAutoLocation;

                this.#source = useAuto ? "auto" : "manual";

                const msg = useAuto //
                    ? _("Failed to connect to Mawaqit. Defaulting to automatic location detection: %s")
                    : _("Failed to connect to Mawaqit. Defaulting to manual location: %s");
                Main.notify(this.#extensionName, msg.format(e.message));
            }
        }

        // try to get location automatically if selected as a source or Mawaqit failed
        if (this.#source === "auto") {
            try {
                if (!this.geoclueService) this.geoclueService = new GeoclueService(this.metadata.name, this.#refreshSchedule);
                await this.geoclueService.start();
                return new CalcPrayerTimes(ymd, GLib.TimeZone.new_local(), this.geoclueService.currentLocation, this.#settings.calcMethod, this.#settings.asrMethod, this.#settings.highLatAdjustment);
            } catch (e) {
                this.#geoclueService?.destroy(); // destroy if initialised before then failed on current run
                this.#geoclueService = null;
                this.#source = "manual";
                Main.notify(this.#extensionName, _("Failed to find location automatically. Defaulting to manual calculations: %s").format(e.message));
            }
        }

        // calculate locally
        return new CalcPrayerTimes(ymd, cache.timeZone, this.#settings.location, this.#settings.calcMethod, this.#settings.asrMethod, this.#settings.highLatAdjustment);
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
    }
}
