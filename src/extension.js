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
        this._settings = new SettingManager(this.getSettings(), this.reloadMain.bind(this), this.destroyGeoclue.bind(this));

        const timeFormat = this._settings.clockFormat === "12h" ? _("%-I:%M %p") : _("%R");
        this._indicator = new Indicator(this.metadata.name, timeFormat);
        this._menu = new Menu(this._indicator, 0.5, St.Side.TOP, this.path, timeFormat);
        this._indicator.setMenu(this._menu);

        Main.panel.addToStatusArea(this.uuid, this._indicator, 1, "center");

        this._geoclueService = null;
        this._wallClock = null;
        this._clockSignalId = null;
        this._prayerTimeoutId = null;
        this._soundFile = null;
        this._wakeProxy = null;
        this._wakeSignalId = null;

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

        const { prayerTimes, nextPrayer } = await this._getNextPrayers(now, prayers);
        for (const prayer of prayers) prayer.time = prayerTimes[prayer.id];

        if (this._settings.isSoundPlayer) this._soundFile = Gio.File.new_for_path(this.path + "/assets/audio/athan.ogg");

        switch (this._settings.displayMode) {
            case "countdown":
                this._countdownMain(prayers, nextPrayer);
                break;
            case "time":
                this._timeMain(prayers, nextPrayer);
                break;
        }

        this._menu.populate(prayers);
        this._menu.highlightItem(nextPrayer.i);
    }
    async _getNextPrayers(now, prayers) {
        const fetchContext = { source: this._settings.source, mawaqitClient: null };

        const todayTimes = await this._getPrayerTimes(now, fetchContext);

        // before today fajr
        const todayFajrDiff = this._differenceToNow(todayTimes.fajr, now);
        if (todayFajrDiff > 0) {
            const yesterdayTimes = await this._getPrayerTimes(now.add_days(-1), fetchContext);
            const yesterdayIshaDiff = this._differenceToNow(yesterdayTimes.isha, now);
            // edge case when new day but yesterday isha hasn't passed
            if (yesterdayIshaDiff > 0) {
                return {
                    prayerTimes: yesterdayTimes,
                    nextPrayer: { secondsLeft: this._microsecondsToSeconds(yesterdayIshaDiff), i: prayers.length - 1 },
                };
            }
            // otherwise next is today fajr
            return {
                prayerTimes: todayTimes,
                nextPrayer: { secondsLeft: this._microsecondsToSeconds(todayFajrDiff), i: 0 },
            };
        }

        // after today isha
        const todayIshaDiff = this._differenceToNow(todayTimes.isha, now);
        if (todayIshaDiff <= 0) {
            const tomorrowTimes = await this._getPrayerTimes(now.add_days(1), fetchContext);
            return {
                prayerTimes: tomorrowTimes,
                nextPrayer: { secondsLeft: this._microsecondsToSeconds(this._differenceToNow(tomorrowTimes.fajr, now)), i: 0 },
            };
        }

        // between today fajr and isha
        for (let i = 1; i < prayers.length; i++) {
            const prayerDiff = this._differenceToNow(todayTimes[prayers[i].id], now);
            if (prayerDiff > 0) {
                return {
                    prayerTimes: todayTimes,
                    nextPrayer: { secondsLeft: this._microsecondsToSeconds(prayerDiff), i },
                };
            }
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

    _countdownMain(prayers, nextPrayer) {
        this._indicator.setTimeLeftText(prayers[nextPrayer.i].name, nextPrayer.secondsLeft);

        let reminderSeconds = this._settings.reminder * 60;
        let isReminderFired = false;

        this._wallClock = new GnomeDesktop.WallClock();
        this._clockSignalId = this._wallClock.connect("notify::clock", async () => {
            const now = GLib.DateTime.new_now_local();
            nextPrayer.secondsLeft = this._microsecondsToSeconds(this._differenceToNow(prayers[nextPrayer.i].time, now));

            if (nextPrayer.secondsLeft <= 0) {
                this._notifyPrayerArrival(prayers[nextPrayer.i].name);

                await this._moveToNewDay(now, prayers, nextPrayer);
                nextPrayer.secondsLeft = this._microsecondsToSeconds(this._differenceToNow(prayers[nextPrayer.i].time, now));

                isReminderFired = false;
            } else if (reminderSeconds && nextPrayer.secondsLeft <= reminderSeconds && !isReminderFired) {
                this._prayerReminder(prayers[nextPrayer.i].name);
                isReminderFired = true;
            } else {
                this._indicator.setTimeLeftText(prayers[nextPrayer.i].name, nextPrayer.secondsLeft);
            }
        });
    }
    _timeMain(prayers, nextPrayer) {
        this._indicator.setClockTimeText(prayers[nextPrayer.i].name, prayers[nextPrayer.i].time);

        let delaySeconds = this._microsecondsToSeconds(this._differenceToNow(prayers[nextPrayer.i].time));
        const reminderSeconds = this._settings.reminder * 60;
        let isReminderTurn = false;
        if (reminderSeconds > 0 && delaySeconds > reminderSeconds) {
            delaySeconds -= reminderSeconds;
            isReminderTurn = true;
        }

        this._prayerTimeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, delaySeconds, () => {
            (async () => {
                if (isReminderTurn) {
                    this._prayerReminder(prayers[nextPrayer.i].name);
                } else {
                    this._notifyPrayerArrival(prayers[nextPrayer.i].name);
                    await this._moveToNewDay(GLib.DateTime.new_now_local(), prayers, nextPrayer);
                }
                this._timeMain(prayers, nextPrayer);
            })();

            return GLib.SOURCE_REMOVE;
        });
    }
    _notifyPrayerArrival(nextPrayerName) {
        const text = _("Time for %s").format(nextPrayerName);
        this._indicator.text = text;
        if (this._settings.isNotifyPrayer) Main.notify(this.metadata.name, text);
        if (this._settings.isSoundPlayer) global.display.get_sound_player().play_from_file(this._soundFile, text, null);
    }
    async _moveToNewDay(now, prayers, nextPrayer) {
        // shift to next prayer / tomorrow
        if (nextPrayer.i === prayers.length - 1) {
            const tomorrow = now.add_days(1);

            const fetchContext = { source: this._settings.source, mawaqitClient: null };
            const tomorrowTimes = await this._getPrayerTimes(tomorrow, fetchContext);

            for (const prayer of prayers) prayer.time = tomorrowTimes[prayer.id];
            nextPrayer.i = 0;
            const dhuhrItem = prayers.find((prayer) => prayer.id === "dhuhr");
            if (dhuhrItem) dhuhrItem.name = this._getDhuhrName(tomorrow);

            this._menu.removeAll();
            this._menu.populate(prayers);
        } else {
            nextPrayer.i++;
        }
        this._menu.highlightItem(nextPrayer.i);
    }
    _prayerReminder(nextPrayerName) {
        const text = _("%s in %d minutes").format(nextPrayerName, this._settings.reminder);
        this._indicator.text = text;
        if (this._settings.isNotifyPrayer) Main.notify(this.metadata.name, text);
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
