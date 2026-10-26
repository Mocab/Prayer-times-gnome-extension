import Gio from "gi://Gio";
import GObject from "gi://GObject";
import GLib from "gi://GLib";
import GnomeDesktop from "gi://GnomeDesktop";
import St from "gi://St";

import { Extension, gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

import { Settings } from "./settings.js";
import { Menu, Indicator } from "./ui.js";
import { PrayerTimeProvider } from "./prayer-time-provider.js";

export default class PrayerTime extends Extension {
    enable() {
        this._settings = new Settings(this.getSettings());
        this._displayModeSignal = this._settings.connect("changed::display-mode", refreshSchedule, true); // TODO: refresh ui only

        this._indicator = new Indicator(this.metadata.name);
        this._menu = new Menu(this._indicator, 0.5, St.Side.TOP, this.path, this._settings.timeFormat);
        this._indicator.setMenu(this._menu);
        Main.panel.addToStatusArea(this.uuid, this._indicator, 1, "center");

        this._clockSignalId = null;
        this._soundFile = null;
        this._wakeProxy = null;
        this._wakeSignalId = null;
        this._schedule = {
            prayers: null,
            nextPrayerI: null,
        };

        this._wallClock = new GnomeDesktop.WallClock();

        this._scheduleProvider = new PrayerTimeProvider(this._settings, this.metadata.name, this.refreshSchedule.band(this));
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

    async _init() {
        this._schedule = await this._scheduleProvider.buildSchedule();

        if (!this._menu) return;

        this._menu.populate(this._schedule);

        if (this._settings.isSound) this._soundFile = Gio.File.new_for_path(this.path + "/assets/audio/athan.ogg");

        this._tick();
        this._clockSignalId = this._wallClock.connect("notify::clock", () => this._tick());
    }

    _tick() {
        const nextPrayer = this._schedule.prayers[this._schedule.nextPrayerI];
        const diffUsec = nextPrayer.time.to_unix_usec() - GLib.get_real_time();

        // three second buffer
        if (diffUsec <= 3e6) {
            // notify prayer arrival
            const text = _("Time for %s").format(nextPrayer.name);
            this._indicator.text = text;
            if (this._settings.isNotify) Main.notify(this.metadata.name, text);
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
            if (this._settings.isNotify) Main.notify(this.metadata.name, text);
            return;
        }

        this._indicator.text =
            this._settings.displayMode === "countdown" //
                ? _("%s in %s").format(nextPrayer.name, `${String((minutesLeft / 60) | 0).padStart(2, "0")}:${String(minutesLeft % 60).padStart(2, "0")}`)
                : _("%s: %s").format(nextPrayer.name, nextPrayer.time.format(this._settings.timeFormat));
    }

    async refreshSchedule() {
        this._schedule = await this._scheduleProvider.buildSchedule();

        if (!this._menu) return;
        this._menu.update(this._schedule);

        this._tick();
    }

    _destroyMain() {
        this._indicator.text = "...";
        this._menu.destroy();

        if (this._clockSignalId) {
            this._wallClock.disconnect(this._clockSignalId);
            this._clockSignalId = null;
        }

        this._scheduleProvider.destroy();
        this._schedule = null;

        this._soundFile = null;
    }

    disable() {
        if (this._wakeProxy) {
            if (this._wakeSignalId) {
                this._wakeProxy.disconnect(this._wakeSignalId);
                this._wakeSignalId = null;
            }
            this._wakeProxy = null;
        }

        this._destroyMain();
        this._scheduleProvider = null;

        if (this._wallClock) this._wallClock = null;

        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
        this._menu = null;

        this._settings.disconnect(this._displayModeSignal, true);
        if (this._settings) {
            this._settings.destroy();
            this._settings = null;
        }
    }
}
