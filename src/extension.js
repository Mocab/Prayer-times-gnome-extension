import Gio from "gi://Gio";
import GLib from "gi://GLib";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { Extension, gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import { Settings } from "./utils/settings.js";
import { Menu, Indicator } from "./ui.js";
import { NotificationManager } from "./utils/notification-manager.js";
import { ScheduleManager } from "./services/schedule-manager.js";

export default class PrayerTime extends Extension {
    enable() {
        this._soundFile = null;
        this._timeoutId = null;
        this._startTimer = null;

        this._settings = new Settings(this.getSettings(), this.metadata);

        this._scheduleManager = new ScheduleManager(this._settings, this.metadata, () => this.reInit());

        this._indicator = new Indicator(this.metadata.name, this._settings, () => this.reInit());
        this._menu = new Menu(this._indicator, this._settings);
        this._indicator.setMenu(this._menu);
        Main.panel.addToStatusArea(this.uuid, this._indicator, this._settings.indicatorOrder, this._settings.indicatorAlignment);
        this._notifier = new NotificationManager(this.metadata.name, this._settings);

        this._init();

        this._settingSignals = [
            this._settings.connect("changed::display-mode", () => this._onDisplayModeChanged()),
            this._settings.connect("changed::use-symbolic-icons", () => this._onSymbolicIconsChanged()),
            this._settings.connect("changed::reminder", () => this.reInit()), // TODO: only refresh timeout
            this._settings.connect("changed::indicator-alignment", () => this._onIndicatorReposition()),
            this._settings.connect("changed::indicator-order", () => this._onIndicatorReposition()),
        ];

        // update extension on system wake
        this._wakeSignalId = Gio.DBus.system.signal_subscribe("org.freedesktop.login1", "org.freedesktop.login1.Manager", "PrepareForSleep", "/org/freedesktop/login1", null, Gio.DBusSignalFlags.NONE, (_connection, _sender, _path, _interface, _signal, params) => {
            if (!params.get_child_value(0).get_boolean()) this.reInit();
        });
    }

    async _init() {
        try {
            const ready = await this._scheduleManager.buildSchedule();
            if (!ready) return;

            this._indicator.updateIcon(this._scheduleManager.nextPrayer.icon);
            this._menu.populate(this._scheduleManager.schedule);

            this._soundFile = Gio.File.new_for_path(this.path + "/assets/audio/athan.ogg"); // TODO: don't include if sound disabled

            this._startTimer = this._settings.displayMode === "countdown" ? this._startCountdown : this._startStaticWait;
            this._scheduleNextEvent();
        } catch (e) {
            if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) return;
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
        const nextPrayer = this._scheduleManager.nextPrayer;
        const nextPrayerUsec = nextPrayer.time.to_unix_usec();
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
        const nextPrayer = this._scheduleManager.nextPrayer;
        this._indicator.setReminder(nextPrayer.name, this._settings.reminder);
        this._notifier.notifyReminder(nextPrayer);

        this._scheduleTimeout(60, () => this._scheduleNextEvent());
    }
    async _onPrayerTime() {
        const nextPrayer = this._scheduleManager.nextPrayer;

        this._indicator.setArrival(nextPrayer.name);
        this._notifier.notifyArrival(nextPrayer);
        if (this._settings.isSound) {
            try {
                global.display.get_sound_player().play_from_file(this._soundFile, _("Call to prayer"), null);
            } catch (e) {
                console.error(`[${this.metadata.name}]: Failed to play prayer audio:`, e);
            }
        }

        let movedToNextDay;
        try {
            movedToNextDay = await this._scheduleManager.advanceToNextPrayer();
        } catch (e) {
            if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) return;
            console.error(`[${this.metadata.name}]: Failed to advance prayer schedule:`, e);
            // TODO: retry
            return;
        }

        if (movedToNextDay) {
            this._menu.update(this._scheduleManager.schedule);
        } else {
            this._menu.highlightItem(this._scheduleManager.nextPrayerIndex);
        }
        this._indicator.updateIcon(this._scheduleManager.nextPrayer.icon);

        this._scheduleTimeout(60, () => this._scheduleNextEvent());
    }

    reInit() {
        this._stopTimer();
        this._menu.destroy();
        this._init();
    }

    _onDisplayModeChanged() {
        if (!this._scheduleManager?.nextPrayer) return;

        this._stopTimer();
        this._startTimer = this._settings.displayMode === "countdown" ? this._startCountdown : this._startStaticWait;
        this._scheduleNextEvent();
    }

    _onSymbolicIconsChanged() {
        this._scheduleManager.refreshIcons();
        this._menu.updateIcons(this._scheduleManager.schedule);
        if (!this._scheduleManager.nextPrayer) return;

        this._indicator.updateIcon(this._scheduleManager.nextPrayer.icon);
    }

    _onIndicatorReposition() {
        const container = this._indicator.container;
        const currentParent = container.get_parent();
        const targetBox = Main.panel[`_${this._settings.indicatorAlignment}Box`];
        if (!targetBox) return;

        if (currentParent === targetBox) {
            targetBox.set_child_at_index(container, this._settings.indicatorOrder);
        } else {
            currentParent?.remove_child(container);
            targetBox.insert_child_at_index(container, this._settings.indicatorOrder);
        }
    }

    disable() {
        this._stopTimer();

        if (this._wakeSignalId) {
            Gio.DBus.system.signal_unsubscribe(this._wakeSignalId);
            this._wakeSignalId = null;
        }

        if (this._settings) {
            if (this._settingSignals) {
                this._settingSignals.forEach((id) => id && this._settings.disconnect(id));
                this._settingSignals = null;
            }
            this._settings = null;
        }

        if (this._scheduleManager) {
            this._scheduleManager.destroy();
            this._scheduleManager = null;
        }

        if (this._notifier) {
            this._notifier.destroy();
            this._notifier = null;
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
