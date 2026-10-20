import Gio from "gi://Gio";
import GObject from "gi://GObject";
import GLib from "gi://GLib";
import GnomeDesktop from "gi://GnomeDesktop";
import St from "gi://St";

import { Extension, gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as MessageTray from "resource:///org/gnome/shell/ui/messageTray.js";

import { SettingManager } from "./setting-manager.js";
import { Menu, Indicator } from "./ui.js";
import { MawaqitClient } from "./mawaqit-client.js";
import { GeoclueService } from "./geoclue-service.js";
import { CalcPrayerTimes } from "./calc-prayer-times.js";

export default class PrayerTime extends Extension {
    enable() {
        this._settings = new SettingManager(this.getSettings(), this.metadata, this.reloadMain.bind(this), this.refreshIndicator.bind(this));
        this._timeFormat = this._settings.clockFormat === "12h" ? _("%-I:%M %p") : _("%R");

        this._indicator = new Indicator(this.metadata.name, this.path);
        this._menu = new Menu(this._indicator, 0.5, St.Side.TOP, this.path, this._timeFormat);
        this._indicator.setMenu(this._menu);
        const position = this._settings.indicatorPosition;
        const index = this._settings.indicatorIndex;
        Main.panel.addToStatusArea(this.uuid, this._indicator, index, position);
        this._connectPanelBoxSignals();

        this._geoclueService = null;
        this._clockSignalId = null;
        this._soundFile = null;
        this._wakeProxy = null;
        this._wakeSignalId = null;
        this._notificationSource = new MessageTray.Source({ title: this.metadata.name, iconName: "preferences-system-time-symbolic" });
        Main.messageTray.add(this._notificationSource);

        this._wallClock = new GnomeDesktop.WallClock();

        this._source = null;
        this._schedule = {
            prayers: null,
            nextPrayerI: null,
        };
        this._lastReminderTime = null;
        this._lastArrivedPrayerTime = null;
        this._init().catch((e) => console.error(`[${this.metadata.name}]: Init error:`, e));

        // update extension on system wake
        Gio.DBusProxy.new_for_bus(Gio.BusType.SYSTEM, Gio.DBusProxyFlags.NONE, null, "org.freedesktop.login1", "/org/freedesktop/login1", "org.freedesktop.login1.Manager", null, (source, result) => {
            try {
                this._wakeProxy = Gio.DBusProxy.new_for_bus_finish(result);
                this._wakeSignalId = this._wakeProxy.connect("g-signal", (proxy, senderName, signalName, parameters) => {
                    if (signalName === "PrepareForSleep" && !parameters.recursiveUnpack()[0]) this.refreshSchedule();
                });
            } catch (e) {
                Main.notify(this.metadata.name, _("Failed to detect system sleep. Prayer times won't update automatically when your computer wakes up: %s").format(e.message));
            }
        });
    }

    _getBox(position) {
        return {
            left: Main.panel._leftBox,
            center: Main.panel._centerBox,
            right: Main.panel._rightBox,
        }[position];
    }

    _placeIndicator() {
        const container = this._indicator.container;
        const position = this._settings.indicatorPosition;
        const index = this._settings.indicatorIndex;
        const box = this._getBox(position);
        if (!box) return;

        const currentParent = container.get_parent();
        if (currentParent === box) {
            const children = box.get_children();
            const target = Math.min(index, children.length - 1);
            if (children.indexOf(container) !== target) box.set_child_at_index(container, target);
            return;
        }
        if (currentParent) currentParent.remove_child(container);
        box.insert_child_at_index(container, index);
    }

    _connectPanelBoxSignals() {
        this._panelBox?.disconnectObject(this);
        this._panelBox = null;

        const box = this._getBox(this._settings.indicatorPosition);
        if (!box) return;

        const onChildrenChanged = (_box, actor) => {
            const myContainer = this._indicator?.container ?? this._indicator;
            if (myContainer && actor !== myContainer) this._placeIndicator();
        };
        box.connectObject("child-added", onChildrenChanged, this);
        box.connectObject("child-removed", onChildrenChanged, this);
        this._panelBox = box;
    }

    async _init() {
        this._source = this._settings.source;
        this._schedule = await this._resolveCurrentPrayerContext();

        if (!this._menu) return;

        this._menu.populate(this._schedule);

        if (this._settings.isSound) this._soundFile = Gio.File.new_for_path(this.path + "/assets/audio/athan.ogg");

        this._tick();
        this._clockSignalId = this._wallClock.connect("notify::clock", () => this._tick());
    }
    async _resolveCurrentPrayerContext() {
        const now = GLib.DateTime.new_now_local();
        const nowUsec = now.to_unix_usec();
        const cache = { mawaqitClient: null }; // cache Mawaqit prayer times for subsequent calls within this method

        const todayTimes = await this._getPrayerTimes(now, cache);

        // before today fajr
        if (todayTimes.fajr.to_unix_usec() > nowUsec) {
            const yesterdayTimes = await this._getPrayerTimes(now.add_days(-1), cache);
            // edge case when new day but yesterday isha hasn't passed
            if (yesterdayTimes.isha.to_unix_usec() > nowUsec) {
                const prayers = this._buildPrayerList(yesterdayTimes);
                return { prayers, nextPrayerI: prayers.length - 1 };
            }
            // otherwise next is today fajr
            return { prayers: this._buildPrayerList(todayTimes), nextPrayerI: 0 };
        }

        // after today isha
        if (nowUsec >= todayTimes.isha.to_unix_usec()) {
            return {
                prayers: this._buildPrayerList(await this._getPrayerTimes(now.add_days(1), cache)),
                nextPrayerI: 0,
            };
        }

        // between today fajr and isha
        const prayers = this._buildPrayerList(todayTimes);
        for (let i = 1; i < prayers.length; i++) {
            if (prayers[i].time.to_unix_usec() > nowUsec) return { prayers, nextPrayerI: i };
        }
    }

    _buildPrayerList(prayerTimes) {
        const fajr = { id: "fajr", name: _("Fajr"), time: prayerTimes.fajr ?? null };
        const dhuhr = {
            id: "dhuhr",
            name: prayerTimes.dhuhr?.get_day_of_week() === 5 ? _("Jumaah") : _("Dhuhr"),
            time: prayerTimes.dhuhr ?? null,
        };
        const asr = { id: "asr", name: _("Asr"), time: prayerTimes.asr ?? null };
        const maghrib = { id: "maghrib", name: _("Maghrib"), time: prayerTimes.maghrib ?? null };
        const isha = { id: "isha", name: _("Isha"), time: prayerTimes.isha ?? null };

        if (!this._settings.isIncludeSunnah) return [fajr, dhuhr, asr, maghrib, isha];
        return [fajr, { id: "duha", name: _("Duha"), time: prayerTimes.duha ?? null }, dhuhr, asr, maghrib, isha];
    }

    async _getPrayerTimes(dateTime, cache = { mawaqitClient: null }) {
        const ymd = dateTime.get_ymd();

        // try Mawaqit if selected
        if (this._source === "mawaqit") {
            try {
                if (!cache.mawaqitClient) cache.mawaqitClient = new MawaqitClient(this.metadata.name, this._settings.mawaqitSlug);
                return await cache.mawaqitClient.fetchPrayerTimes(ymd);
            } catch (e) {
                const useAuto = this._settings.isFallbackAutoLocation;

                this._source = useAuto ? "auto" : "manual";

                const msg = useAuto ? _("Failed to connect to Mawaqit. Defaulting to automatic location detection: %s") : _("Failed to connect to Mawaqit. Defaulting to manual location: %s");
                Main.notify(this.metadata.name, msg.format(e.message));
            }
        }

        // try auto location if selected as a source, or if Mawaqit failed
        if (this._source === "auto") {
            try {
                if (!this._geoclueService) this._geoclueService = new GeoclueService(this.metadata.name, this.refreshSchedule.bind(this));
                await this._geoclueService.start();
                return new CalcPrayerTimes(ymd, GLib.TimeZone.new_local(), this._geoclueService.currentLocation, this._settings.calcMethod, this._settings.asrMethod, this._settings.highLatAdjustment);
            } catch (e) {
                if (this._geoclueService) this._destroyGeoclue(); // destroy if initialised before then failed on current run
                this._source = "manual";
                Main.notify(this.metadata.name, _("Failed to find location automatically. Defaulting to manual calculations: %s").format(e.message));
            }
        }

        // final fallback (manual)
        return new CalcPrayerTimes(ymd, GLib.TimeZone.new_local(), this._settings.location, this._settings.calcMethod, this._settings.asrMethod, this._settings.highLatAdjustment);
    }

    _tick() {
        const nextPrayer = this._schedule.prayers[this._schedule.nextPrayerI];
        const diffUsec = nextPrayer.time.to_unix_usec() - GLib.get_real_time();

        const isArrived = diffUsec <= 3e6; // three second buffer
        const indicatorMode = this._settings.indicatorMode;
        const isCompact = indicatorMode === "compact";
        this._indicator.icon = indicatorMode === "normal-with-icon" || isCompact ? nextPrayer.id : null;

        if (isArrived) {
            // notify prayer arrival
            const text = _("Time for %s").format(nextPrayer.name);
            this._indicator.text = text;
            const prayerTime = nextPrayer.time.to_unix_usec();
            if (this._lastArrivedPrayerTime === prayerTime) return;
            this._lastArrivedPrayerTime = prayerTime;

            if (this._settings.isNotify) this._notifyPrayer(nextPrayer, text, _("It is time to pray."));
            if (this._settings.isSound) global.display.get_sound_player().play_from_file(this._soundFile, text, null);

            // shift to tomorrow / next prayer
            if (this._schedule.nextPrayerI === this._schedule.prayers.length - 1) {
                this._advanceToNextDay();
            } else {
                this._menu.highlightItem(++this._schedule.nextPrayerI);
            }
            return;
        }

        const minutesLeft = Math.ceil(diffUsec / 6e7);

        // prayer reminder
        if (minutesLeft === this._settings.reminder) {
            // minutesLeft will always > 0, so this._settings.reminder > 0 && ... is redundant
            const text = _("%s in %d minutes").format(nextPrayer.name, this._settings.reminder);
            this._indicator.text = text;
            const prayerTime = nextPrayer.time.to_unix_usec();
            if (this._settings.isNotify && this._lastReminderTime !== prayerTime) {
                this._lastReminderTime = prayerTime;
                const notificationTitle = _("Upcoming prayer");
                const notificationBody = _("%s is in %d minutes (%s).").format(nextPrayer.name, this._settings.reminder, nextPrayer.time.format(this._timeFormat));
                this._notifyPrayer(nextPrayer, notificationTitle, notificationBody);
            }
            return;
        }

        const isCountdown = this._settings.displayMode === "countdown";
        const countdown = `${String((minutesLeft / 60) | 0).padStart(2, "0")}:${String(minutesLeft % 60).padStart(2, "0")}`;
        const time = nextPrayer.time.format(this._timeFormat);

        if (isCompact) this._indicator.text = isCountdown ? _("in %s").format(countdown) : time;
        else this._indicator.text = isCountdown ? _("%s in %s").format(nextPrayer.name, countdown) : _("%s: %s").format(nextPrayer.name, time);
    }
    async _advanceToNextDay() {
        this._schedule = {
            prayers: this._buildPrayerList(await this._getPrayerTimes(this._schedule.prayers[0].time.add_days(1))),
            nextPrayerI: 0,
        };
        this._menu.update(this._schedule);
        this._tick();
    }

    refreshIndicator() {
        this._placeIndicator();
        if (this._clockSignalId) this._tick(); // once the schedule is loaded
    }

    async refreshSchedule() {
        this._schedule = await this._resolveCurrentPrayerContext();

        if (!this._menu) return;
        this._menu.update(this._schedule);

        this._tick();
    }

    _destroyGeoclue() {
        if (this._geoclueService) {
            this._geoclueService.destroy();
            this._geoclueService = null;
        }
    }

    _notifyPrayer(prayer, title, body) {
        const iconFile = Gio.File.new_for_path(`${this.path}/assets/icons/${prayer.id}.svg`);
        const notification = new MessageTray.Notification({
            source: this._notificationSource,
            title,
            body,
            gicon: new Gio.FileIcon({ file: iconFile }),
            isTransient: true,
        });
        this._notificationSource.addNotification(notification);
    }

    _destroyMain() {
        this._indicator.text = "...";
        this._menu.destroy();

        if (this._clockSignalId) {
            this._wallClock.disconnect(this._clockSignalId);
            this._clockSignalId = null;
        }

        this._destroyGeoclue();

        this._source = null;
        this._schedule = null;

        this._soundFile = null;
    }
    reloadMain() {
        this._destroyMain();
        this._init().catch((e) => console.error(`[${this.metadata.name}]: Reload error:`, e));
    }

    disable() {
        this._panelBox?.disconnectObject(this);
        this._panelBox = null;

        if (this._wakeProxy) {
            if (this._wakeSignalId) {
                this._wakeProxy.disconnect(this._wakeSignalId);
                this._wakeSignalId = null;
            }
            this._wakeProxy = null;
        }

        this._destroyMain();

        if (this._notificationSource) {
            this._notificationSource.destroy();
            this._notificationSource = null;
        }

        if (this._wallClock) this._wallClock = null;

        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
        this._menu = null;

        this._timeFormat = null;

        if (this._settings) {
            this._settings.destroy();
            this._settings = null;
        }
    }
}
