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
    constructor(metadata) {
        super(metadata);
    }

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

        this._main();

        // if system sleeps then reload main
        this._wakeProxy = Gio.DBusProxy.new_for_bus_sync(Gio.BusType.SYSTEM, Gio.DBusProxyFlags.NONE, null, "org.freedesktop.login1", "/org/freedesktop/login1", "org.freedesktop.login1.Manager", null);
        this._wakeSignalId = this._wakeProxy.connect("g-signal", (proxy, senderName, signalName, parameters) => {
            if (signalName === "PrepareForSleep") {
                // if not going to sleep
                if (!parameters.recursiveUnpack()[0]) {
                    this.reloadMain();
                }
            }
        });
    }

    async _main() {
        const prayers = [
            { id: "fajr", name: _("Fajr"), time: null },
            ...(this._settings.isIncludeSunnah ? [{ id: "duha", name: _("Duha"), time: null }] : []),
            {
                id: "dhuhr",
                get name() {
                    return GLib.DateTime.new_now_local().get_day_of_week() === 5 ? _("Jumaah") : _("Dhuhr");
                },
                time: null,
            },
            { id: "asr", name: _("Asr"), time: null },
            { id: "maghrib", name: _("Maghrib"), time: null },
            { id: "isha", name: _("Isha"), time: null },
        ];

        const { prayerTimes, nextPrayer } = await this._getNextPrayers(prayers);
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
    async _getNextPrayers(prayers) {
        const now = GLib.DateTime.new_now_local();

        // mawaqit -> auto (if enabled) -> manual
        const permanentSourceFallbackMap = {
            mawaqit: null,
            auto: null,
        };
        const mawaqitClientHolder = { instance: null };

        const todayTimes = await this._getPrayerTimes(now, permanentSourceFallbackMap, mawaqitClientHolder);

        // before today fajr
        const todayFajrDiff = todayTimes.fajr.difference(now);
        if (todayFajrDiff > 0) {
            const yesterdayTimes = await this._getPrayerTimes(now.add_days(-1), permanentSourceFallbackMap, mawaqitClientHolder);
            const yesterdayIshaDiff = yesterdayTimes.isha.difference(now);
            // edge case when new day but yesterday isha hasn't passed
            if (yesterdayIshaDiff > 0) {
                return {
                    prayerTimes: yesterdayTimes,
                    nextPrayer: { timeLeft: this._differenceToMinutes(yesterdayIshaDiff), i: prayers.length - 1 },
                };
            }
            // otherwise next is today fajr
            return {
                prayerTimes: todayTimes,
                nextPrayer: { timeLeft: this._differenceToMinutes(todayFajrDiff), i: 0 },
            };
        }

        // after today isha
        const todayIshaDiff = todayTimes.isha.difference(now);
        if (todayIshaDiff <= 0) {
            const tomorrowTimes = await this._getPrayerTimes(now.add_days(1), permanentSourceFallbackMap, mawaqitClientHolder);
            return {
                prayerTimes: tomorrowTimes,
                nextPrayer: { timeLeft: this._differenceToMinutes(tomorrowTimes.fajr.difference(now)), i: 0 },
            };
        }

        // between today fajr and isha
        for (let i = 1; i < prayers.length; i++) {
            const prayerTime = todayTimes[prayers[i].id];
            const prayerDiff = prayerTime.difference(now);
            if (prayerDiff > 0) {
                return {
                    prayerTimes: todayTimes,
                    nextPrayer: { timeLeft: this._differenceToMinutes(prayerDiff), i },
                };
            }
        }
    }

    async _getPrayerTimes(dateTime, permanentSourceFallbackMap = { mawaqit: null, auto: null }, mawaqitClientHolder = { instance: null }) {
        const dateTimeYmd = dateTime.get_ymd();
        const date = { day: dateTimeYmd[2], month: dateTimeYmd[1], year: dateTimeYmd[0] };

        let activeSource = this._settings.source;

        // loop to exhaust all fallbacks if necessary
        while (true) {
            // pick last enabled fallback
            while (permanentSourceFallbackMap[activeSource]) {
                activeSource = permanentSourceFallbackMap[activeSource];
            }

            switch (activeSource) {
                case "mawaqit":
                    try {
                        if (!mawaqitClientHolder.instance) mawaqitClientHolder.instance = new MawaqitClient(this.metadata.name, this._settings.mawaqitSlug);
                        return await mawaqitClientHolder.instance.fetchPrayerTimes(date);
                    } catch (e) {
                        const useAuto = this._settings.isFallbackAutoLocation && !permanentSourceFallbackMap["auto"];
                        permanentSourceFallbackMap["mawaqit"] = useAuto ? "auto" : "manual";

                        const msg = useAuto ? _("Failed to connect to Mawaqit. Defaulting to automatic location detection. %s") : _("Failed to connect to Mawaqit. Defaulting to manual location. %s");
                        Main.notify(this.metadata.name, msg.replace("%s", e.message));

                        activeSource = permanentSourceFallbackMap["mawaqit"];
                    }
                    break;

                case "auto":
                    try {
                        if (!this._geoclueService) this._geoclueService = new GeoclueService(this.metadata.name, this.reloadMain.bind(this));
                        return new CalcPrayerTimes(date, GLib.TimeZone.new_local(), await this._geoclueService.start(), this._settings.calcMethod, this._settings.asrMethod, this._settings.highLatAdjustment);
                    } catch (e) {
                        permanentSourceFallbackMap["auto"] = "manual";

                        Main.notify(this.metadata.name, _("Failed to find location automatically. Defaulting to manual calculations. %s").replace("%s", e.message));

                        activeSource = "manual";
                    }
                    break;

                default:
                    return new CalcPrayerTimes(date, GLib.TimeZone.new_local(), this._settings.location, this._settings.calcMethod, this._settings.asrMethod, this._settings.highLatAdjustment);
            }
        }
    }

    _differenceToMinutes(microseconds) {
        return microseconds / 6e7;
    }

    _countdownMain(prayers, nextPrayer) {
        this._indicator.setTimeLeftText(prayers[nextPrayer.i].name, nextPrayer.timeLeft);

        let isReminderFired = false;

        this._wallClock = new GnomeDesktop.WallClock();
        this._clockSignalId = this._wallClock.connect("notify::clock", async () => {
            nextPrayer.timeLeft = this._differenceToMinutes(prayers[nextPrayer.i].time.difference(GLib.DateTime.new_now_local()));

            if (nextPrayer.timeLeft <= 0) {
                this._notifyPrayerArrival(prayers[nextPrayer.i].name);

                const now = GLib.DateTime.new_now_local();
                await this._moveToNewDay(now, prayers, nextPrayer);
                nextPrayer.timeLeft = this._differenceToMinutes(prayers[nextPrayer.i].time.difference(now));

                isReminderFired = false;
            } else if (this._settings.reminder && nextPrayer.timeLeft <= this._settings.reminder) {
                if (!isReminderFired) {
                    this._prayerReminder(prayers[nextPrayer.i].name);
                    isReminderFired = true;
                }
                this._indicator.setTimeLeftText(prayers[nextPrayer.i].name, nextPrayer.timeLeft);
            } else {
                this._indicator.setTimeLeftText(prayers[nextPrayer.i].name, nextPrayer.timeLeft);
            }
        });
    }
    _timeMain(prayers, nextPrayer) {
        this._indicator.setClockTimeText(prayers[nextPrayer.i].name, prayers[nextPrayer.i].time);

        let delaySeconds = Math.max(Math.floor(prayers[nextPrayer.i].time.difference(GLib.DateTime.new_now_local()) * 0.000001), 1);
        let reminderSeconds = this._settings.reminder * 60;
        let isReminderTurn = false;
        if (this._settings.reminder > 0 && delaySeconds > reminderSeconds) {
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
        const text = _("Time for %s").replace("%s", nextPrayerName);
        this._indicator.text = text;
        if (this._settings.isNotifyPrayer) Main.notify(this.metadata.name, text);
        if (this._settings.isSoundPlayer) global.display.get_sound_player().play_from_file(this._soundFile, text, null);
    }
    async _moveToNewDay(now, prayers, nextPrayer) {
        // shift to next prayer / tomorrow
        if (nextPrayer.i === prayers.length - 1) {
            const tomorrowTimes = await this._getPrayerTimes(now.add_days(1));
            for (const prayer of prayers) prayer.time = tomorrowTimes[prayer.id];
            nextPrayer.i = 0;
            this._menu.removeAll();
            this._menu.populate(prayers);
        } else {
            nextPrayer.i++;
        }
        this._menu.highlightItem(nextPrayer.i);
    }
    _prayerReminder(nextPrayerName) {
        const text = _("%s in %d minutes").replace("%s", nextPrayerName).replace("%d", this._settings.reminder);
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

        if (this._clockSignalId) {
            this._wallClock.disconnect(this._clockSignalId);
            this._clockSignalId = null;
        }
        this._wallClock = null;

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
