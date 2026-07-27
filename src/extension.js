import Gio from "gi://Gio";
import GObject from "gi://GObject";
import GLib from "gi://GLib";
import GnomeDesktop from "gi://GnomeDesktop";
import St from "gi://St";

import { Extension, gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

import { SettingManager } from "./setting-manager.js";
import { Menu, Indicator } from "./ui.js";
import { MawaqitClient } from "./mawaqit-client.js";
import { GeoclueService } from "./geoclue-service.js";
import { CalcPrayerTimes } from "./calc-prayer-times.js";

export default class PrayerTime extends Extension {
    enable() {
        this._settings = new SettingManager(this.getSettings(), this.metadata, this.reloadMain.bind(this), this.destroyGeoclue.bind(this));

        this._timeFormat = this._settings.clockFormat === "12h" ? _("%-I:%M %p") : _("%R");
        this._indicator = new Indicator(this.metadata.name);
        this._menu = new Menu(this._indicator, 0.5, St.Side.TOP, this.path, this._timeFormat);
        this._indicator.setMenu(this._menu);

        Main.panel.addToStatusArea(this.uuid, this._indicator, 1, "center");

        this._geoclueService = null;
        this._clockSignalId = null;
        this._prayerTimeoutId = null;
        this._soundFile = null;
        this._wakeProxy = null;
        this._wakeSignalId = null;

        this._wallClock = new GnomeDesktop.WallClock();

        this._schedule = {
            prayers: null,
            nextPrayerI: null,
        };
        this._main();

        // if system sleeps then reload main
        Gio.DBusProxy.new_for_bus(Gio.BusType.SYSTEM, Gio.DBusProxyFlags.NONE, null, "org.freedesktop.login1", "/org/freedesktop/login1", "org.freedesktop.login1.Manager", null, (source, result) => {
            try {
                this._wakeProxy = Gio.DBusProxy.new_for_bus_finish(result);
                this._wakeSignalId = this._wakeProxy.connect("g-signal", (proxy, senderName, signalName, parameters) => {
                    if (signalName === "PrepareForSleep" && !parameters.recursiveUnpack()[0]) this.reloadMain();
                });
            } catch (e) {
                Main.notify(this.metadata.name, _("Failed to detect system sleep. Prayer times won't update automatically when your computer wakes up: %s").format(e.message));
            }
        });
    }

    _getDhuhrName(dateTime) {
        return dateTime.get_day_of_week() === 5 ? _("Jumaah") : _("Dhuhr");
    }

    async _main() {
        const now = GLib.DateTime.new_now_local();

        const prayers = [
            { id: "fajr", name: _("Fajr"), time: null },
            ...(this._settings.isIncludeSunnah ? [{ id: "duha", name: _("Duha"), time: null }] : []), //
            { id: "dhuhr", name: this._getDhuhrName(now), time: null },
            { id: "asr", name: _("Asr"), time: null },
            { id: "maghrib", name: _("Maghrib"), time: null },
            { id: "isha", name: _("Isha"), time: null },
        ];

        const { prayerTimes, nextPrayerI } = await this._resolveCurrentPrayerContext();
        for (const prayer of prayers) prayer.time = prayerTimes[prayer.id];

        this._schedule = {
            prayers: prayers,
            nextPrayerI,
        };

        if (this._settings.isSoundPlayer) this._soundFile = Gio.File.new_for_path(this.path + "/assets/audio/athan.ogg");

        this._tick();
        this._clockSignalId = this._wallClock.connect("notify::clock", () => this._tick());

        this._menu.populate(this._schedule.prayers);
        this._menu.highlightItem(this._schedule.nextPrayerI);
    }
    async _resolveCurrentPrayerContext() {
        const now = GLib.DateTime.new_now_local();
        const nowUsec = now.to_unix_usec();
        const cache = { source: this._settings.source, mawaqitClient: null }; // cache Mawaqit prayer times for subsequent calls within this method

        const todayTimes = await this._getPrayerTimes(now, cache);

        // before today fajr
        if (todayTimes.fajr.to_unix_usec() > nowUsec) {
            const yesterdayTimes = await this._getPrayerTimes(now.add_days(-1), cache);
            // edge case when new day but yesterday isha hasn't passed
            if (yesterdayTimes.isha.to_unix_usec() > nowUsec) {
                const prayers = yesterdayTimes;
                return {
                    prayers,
                    nextPrayerI: prayers.length - 1,
                };
            }
            // otherwise next is today fajr
            return {
                prayers: todayTimes,
                nextPrayerI: 0,
            };
        }

        // after today isha
        if (nowUsec >= todayTimes.isha.to_unix_usec()) {
            return {
                prayers: await this._getPrayerTimes(now.add_days(1), cache),
                nextPrayerI: 0,
            };
        }

        // between today fajr and isha
        for (let i = 1; i < todayTimes.length; i++) {
            if (todayTimes[i].time.to_unix_usec() > nowUsec) return { todayTimes, nextPrayerI: i };
        }
    }

    _differenceToNow(time, now = GLib.DateTime.new_now_local()) {
        return time.difference(now);
    }
    _microsecondsToSeconds(microseconds) {
        return Math.ceil(microseconds * 0.000001);
    }

    async _getPrayerTimes(dateTime, context) {
        const [year, month, day] = dateTime.get_ymd();
        const date = { day, month, year };

        // try Mawaqit if selected
        if (context.source === "mawaqit") {
            try {
                if (!context.mawaqitClient) context.mawaqitClient = new MawaqitClient(this.metadata.name, this._settings.mawaqitSlug);
                return await context.mawaqitClient.fetchPrayerTimes(date);
            } catch (e) {
                const useAuto = this._settings.isFallbackAutoLocation;

                context.source = useAuto ? "auto" : "manual";

                const msg = useAuto ? _("Failed to connect to Mawaqit. Defaulting to automatic location detection: %s") : _("Failed to connect to Mawaqit. Defaulting to manual location: %s");
                Main.notify(this.metadata.name, msg.format(e.message));
            }
        }

        // try auto location if selected as a source, or if Mawaqit failed
        if (context.source === "auto") {
            try {
                if (!this._geoclueService) this._geoclueService = new GeoclueService(this.metadata.name, this.reloadMain.bind(this));
                return new CalcPrayerTimes(date, GLib.TimeZone.new_local(), await this._geoclueService.start(), this._settings.calcMethod, this._settings.asrMethod, this._settings.highLatAdjustment);
            } catch (e) {
                if (this._geoclueService) this.destroyGeoclue(); // destroy if initialised once then failed on subsequent run
                context.source = "manual";
                Main.notify(this.metadata.name, _("Failed to find location automatically. Defaulting to manual calculations: %s").format(e.message));
            }
        }

        // final fallback (manual)
        return new CalcPrayerTimes(date, GLib.TimeZone.new_local(), this._settings.location, this._settings.calcMethod, this._settings.asrMethod, this._settings.highLatAdjustment);
    }

    async _tick() {
        const nextPrayer = this._schedule.prayers[this._schedule.nextPrayerI];
        const diffUsec = nextPrayer.time.to_unix_usec() - GLib.get_real_time();

        // three second buffer
        if (diffUsec <= 3e6) {
            // notify prayer arrival
            const text = _("Time for %s").format(nextPrayer.name);
            this._indicator.text = text;
            if (this._settings.isNotifyPrayer) Main.notify(this.metadata.name, text);
            if (this._settings.isSoundPlayer) global.display.get_sound_player().play_from_file(this._soundFile, text, null);

            // shift to tomorrow / next prayer
            if (this._schedule.nextPrayerI === this._schedule.prayers.length - 1) {
                this._schedule = {
                    prayers: this._buildPrayerList(await this._getPrayerTimes(GLib.DateTime.new_now_local().add_days(1))),
                    nextPrayerI: 0,
                };
                this._menu.update(this._schedule);
            } else {
                this._schedule.nextPrayerI++;
                this._menu.highlightItem(this._schedule.nextPrayerI);
            }
            return;
        }

        const minutesLeft = Math.ceil(diffUsec / 6e7);

        // prayer reminder
        if (minutesLeft === this._settings.reminder) {
            // minutesLeft will always > 0, so this._settings.reminder > 0 && ... is redundant
            const text = _("%s in %d minutes").format(nextPrayer.name, this._settings.reminder);
            this._indicator.text = text;
            if (this._settings.isNotifyPrayer) Main.notify(this.metadata.name, text);
            return;
        }

        if (this._settings.displayMode === "countdown") {
            const hh = Math.floor(minutesLeft / 60)
                .toString()
                .padStart(2, "0");
            const mm = (minutesLeft % 60).toString().padStart(2, "0");
            this._indicator.text = `${nextPrayer.name} in ${hh}:${mm}`;
        } else {
            this._indicator.setClockTimeText(nextPrayer.name, nextPrayer.time);
            this._indicator.text = `${nextPrayer.name} - ${nextPrayer.time.format(this._timeFormat)}`;
        }
    }

    destroyGeoclue() {
        if (this._geoclueService) {
            this._geoclueService.destroy();
            this._geoclueService = null;
        }
    }
    _destroyMain() {
        this._indicator.text = "...";
        this._menu.removeAll();

        if (this._wallClock) {
            if (this._clockSignalId) {
                this._wallClock.disconnect(this._clockSignalId);
                this._clockSignalId = null;
            }
            this._wallClock = null;
        }

        if (this._prayerTimeoutId) {
            GLib.Source.remove(this._prayerTimeoutId);
            this._prayerTimeoutId = null;
        }

        this._soundFile = null;
    }
    reloadMain() {
        this._destroyMain();
        this._main();
    }
    disable() {
        if (this._wakeProxy) {
            if (this._wakeSignalId) {
                this._wakeProxy.disconnect(this._wakeSignalId);
                this._wakeSignalId = null;
            }
            this._wakeProxy = null;
        }

        this.destroyGeoclue();

        this._destroyMain();

        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
        this._menu = null;

        if (this._settings) {
            this._settings.destroy();
            this._settings = null;
        }
    }
}
