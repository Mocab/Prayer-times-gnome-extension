import GLib from "gi://GLib";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import { MawaqitProvider } from "./online/mawaqit-provider.js";
import { CalculationProvider } from "./local/calculation-provider.js";

export class PrayerTimeProvider {
    #settings;
    #sourceChangedId = null;
    #extensionName;
    #reInit;
    #mawaqitInstance = null;
    #localCalculationInstance = null;
    #schedule = {
        prayers: [],
        nextPrayerI: 0,
    };

    constructor(settings, extensionName, reInit) {
        this.#settings = settings;
        this.#extensionName = extensionName;
        this.#reInit = reInit;

        this.#sourceChangedId = settings.connect("changed::prayer-time-source", reInit);
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
        const now = GLib.DateTime.new_now_local();
        const nowUsec = now.to_unix_usec();

        const todayTimes = await this.#getPrayerTimes(now);

        // before today fajr
        if (nowUsec < todayTimes.fajr.to_unix_usec()) {
            const yesterdayTimes = await this.#getPrayerTimes(now.add_days(-1));
            // edge case when new day but yesterday isha hasn't passed
            if (nowUsec < yesterdayTimes.isha.to_unix_usec()) {
                const prayers = this.#buildPrayerList(yesterdayTimes);
                this.#schedule = { prayers, nextPrayerI: prayers.length - 1 };
                return;
            }
            // otherwise next is today fajr
            this.#schedule = { prayers: this.#buildPrayerList(todayTimes), nextPrayerI: 0 };
            return;
        }

        // after today isha
        if (nowUsec >= todayTimes.isha.to_unix_usec()) {
            this.#schedule = {
                prayers: this.#buildPrayerList(await this.#getPrayerTimes(now.add_days(1))),
                nextPrayerI: 0,
            };
            return;
        }

        // between today fajr and isha
        const prayers = this.#buildPrayerList(todayTimes);
        this.#schedule = { prayers, nextPrayerI: prayers.findIndex((p) => p.time.to_unix_usec() > nowUsec) };
    }

    async advanceToNextPrayer() {
        if (this.#schedule.nextPrayerI < this.#schedule.prayers.length - 1) {
            this.#schedule.nextPrayerI++;
        } else {
            this.#schedule = {
                prayers: this.#buildPrayerList(await this.#getPrayerTimes(this.#schedule.prayers[0].time.add_days(1))),
                nextPrayerI: 0,
            };
        }
        return this.#schedule;
    }

    async #getPrayerTimes(dateTime) {
        const ymd = dateTime.get_ymd();

        // try Mawaqit if selected
        if (this.#settings.source === "mawaqit") {
            try {
                // TODO: uncache when buildSchedule exits
                this.#mawaqitInstance ??= new MawaqitProvider(this.#settings, this.#extensionName, this.#reInit);
                return await this.#mawaqitInstance.fetchPrayerTimes(ymd);
            } catch (e) {
                this.#mawaqitInstance = null;
                const locationType = this.#settings.isAutoLocation ? "automatic location detection" : "manual location";
                Main.notify(this.#extensionName, _("Failed to connect to Mawaqit. Defaulting to local calculations with %s: %s").format(locationType, e.message));
            }
        }

        this.#localCalculationInstance ??= new CalculationProvider(this.#settings, this.#extensionName, this.#reInit);
        return this.#localCalculationInstance.calculatePrayerTimes();
    }

    #buildPrayerList(prayerTimes) {
        const prayer = (id, name) => ({ id, name, time: prayerTimes[id] ?? null });

        const fajr = prayer("fajr", _("Fajr"));
        const dhuhr = prayer("dhuhr", prayerTimes.dhuhr?.get_day_of_week() === 5 ? _("Jumaah") : _("Dhuhr"));
        const asr = prayer("asr", _("Asr"));
        const maghrib = prayer("maghrib", _("Maghrib"));
        const isha = prayer("isha", _("Isha"));

        return this.#settings.isIncludeSunnah //
            ? [fajr, prayer("duha", _("Duha")), dhuhr, asr, maghrib, isha]
            : [fajr, dhuhr, asr, maghrib, isha];
    }

    destroy() {
        if (this.#sourceChangedId) {
            this.#settings.disconnect(this.#sourceChangedId);
            this.#sourceChangedId = null;
        }
        this.#mawaqitInstance?.destroy();
        this.#localCalculationInstance?.destroy();
    }
}
