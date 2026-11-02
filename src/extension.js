import Gio from "gi://Gio";
import GLib from "gi://GLib";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { Extension, gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import { Settings } from "./utils/settings.js";
import { Menu, Indicator } from "./ui.js";
import { ScheduleManager } from "./services/schedule-manager.js";

export default class PrayerTime extends Extension {
    enable() {
        this._soundFile = null;
        this._timeoutId = null;
        this._startTimer = null;

        this._settings = new Settings(this.getSettings(), this.metadata);

        this._indicator = new Indicator(this.metadata.name);
        this._menu = new Menu(this._indicator, this._settings, this.path);
        this._indicator.setMenu(this._menu);
        Main.panel.addToStatusArea(this.uuid, this._indicator, 1, "center");

        this._scheduleManager = new ScheduleManager(this._settings, this.metadata.name, this.reInit.bind(this));
        this._displayModeSignal = this._settings.connect("changed::display-mode", this.reInit.bind(this), true); // TODO: refresh ui only
        this._reminderSignal = this._settings.connect("changed::reminder", this.reInit.bind(this)); // TODO: only refresh timeout
        this._init();

        // update extension on system wake
        this._wakeSignalId = Gio.DBus.system.signal_subscribe("org.freedesktop.login1", "org.freedesktop.login1.Manager", "PrepareForSleep", "/org/freedesktop/login1", null, Gio.DBusSignalFlags.NONE, (_connection, _sender, _path, _interface, _signal, params) => {
            if (!params.get_child_value(0).get_boolean()) this.reInit();
        });
    }

    async _init() {
        try {
            await this._scheduleManager.buildSchedule();

            this._menu.populate(this._scheduleManager.schedule);

            this._soundFile = Gio.File.new_for_path(this.path + "/assets/audio/athan.ogg"); // TODO: don't include if sound disabled

            this._startTimer = this._settings.displayMode === "countdown" ? this._startCountdown : this._startStaticWait;
            this._scheduleNextEvent();
        } catch (e) {
            console.error(`[${this.metadata.name}]: Init error:`, e);
        }
    }

    _stopTimer() {
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = null;
        }
    }

    _scheduleTimeout(seconds, callback) {
        this._stopTimer();
        this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, seconds, () => {
            this._timeoutId = null;
            callback();
            return GLib.SOURCE_REMOVE;
        });
    }

    _startCountdown(targetTimeUsec, onComplete) {
        const nextPrayerName = this._scheduleManager.nextPrayer.name;

        const tick = () => {
            const uSecLeft = targetTimeUsec - GLib.get_real_time();

            // 3 sec buffer
            if (uSecLeft <= 3e6) {
                onComplete();
                return;
            }

            this._indicator.setUpcomingCountdown(nextPrayerName, uSecLeft);
            // TODO: optimise and use timeout directly
            this._scheduleTimeout(60, tick);
        };

        tick();
    }
    _startStaticWait(targetTimeUsec, onComplete) {
        this._indicator.setUpcomingTime(this._scheduleManager.nextPrayer);
        this._scheduleTimeout(Math.ceil((targetTimeUsec - GLib.get_real_time()) / 1e6), () => onComplete());
    }

    _scheduleNextEvent() {
        const nextPrayerUsec = this._scheduleManager.nextPrayer.time.to_unix_usec();
        if (this._settings.reminder > 0) {
            const reminderTargetUsec = nextPrayerUsec - this._settings.reminder * 6e7;
            if (reminderTargetUsec > GLib.get_real_time()) {
                this._startTimer(reminderTargetUsec, () => this._onReminder());
                return;
            }
        }
        this._startTimer(nextPrayerUsec, () => this._onPrayerTime());
    }

    _onReminder() {
        const nextPrayerName = this._scheduleManager.nextPrayer.name;
        this._indicator.setReminder(nextPrayerName, this._settings.reminder);
        if (this._settings.isNotify) Main.notify(this.metadata.name, _("%s in %d minutes").format(nextPrayerName, this._settings.reminder));

        this._scheduleTimeout(60, () => this._scheduleNextEvent());
    }
    _onPrayerTime() {
        const nextPrayerName = this._scheduleManager.nextPrayer.name;
        this._indicator.setArrival(nextPrayerName);
        const text = _("Time for %s").format(nextPrayerName);
        if (this._settings.isNotify) Main.notify(this.metadata.name, text);
        if (this._settings.isSound) global.display.get_sound_player().play_from_file(this._soundFile, text, null);

        this._scheduleManager.advanceToNextPrayer();
        // if moved to new day
        if (this._scheduleManager.nextPrayerIndex === 0) {
            this._menu.update(this._scheduleManager.schedule);
        } else {
            this._menu.highlightItem(this._scheduleManager.nextPrayerIndex);
        }

        this._scheduleTimeout(60, () => this._scheduleNextEvent());
    }

    reInit() {
        this._stopTimer();
        this._menu.destroy();
        this._init();
    }

    disable() {
        this._stopTimer();

        if (this._wakeSignalId) {
            Gio.DBus.system.signal_unsubscribe(this._wakeSignalId);
            this._wakeSignalId = null;
        }

        if (this._settings) {
            if (this._displayModeSignal) {
                this._settings.disconnect(this._displayModeSignal, true);
                this._displayModeSignal = null;
            }
            if (this._reminderSignal) {
                this._settings.disconnect(this._reminderSignal);
                this._reminderSignal = null;
            }
            this._settings.destroy();
            this._settings = null;
        }

        if (this._scheduleManager) {
            this._scheduleManager.destroy();
            this._scheduleManager = null;
        }

        if (this._menu) {
            this._menu.destroy();
            this._menu = null;
        }
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }

        this._soundFile = null;
    }
}
