import Gio from "gi://Gio";
import GObject from "gi://GObject";
import GLib from "gi://GLib";
import St from "gi://St";
import Clutter from "gi://Clutter";

import { Extension, gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";

import { SettingManager } from "./setting-manager.js";
import { CalcPrayerTimes } from "./calc-prayer-times.js";

class IndicatorClass extends PanelMenu.Button {
    _init(extensionName, settings) {
        this._settings = settings;

        super._init(0.5, extensionName);
        this.indicatorText = new St.Label({
            text: "...",
            y_align: Clutter.ActorAlign.CENTER,
            style_class: "indicator-txt",
        });
        this.add_child(this.indicatorText);
    }

    setText(text) {
        this.indicatorText.set_text(text);
    }

    setTimeLeftText(nextName, minutesToNext) {
        const hh = Math.floor(minutesToNext / 60)
            .toString()
            .padStart(2, "0");
        const mm = (minutesToNext % 60).toString().padStart(2, "0");
        this.indicatorText.set_text(`${nextName} - ${hh}:${mm}`);
    }
}
const Indicator = GObject.registerClass(IndicatorClass);

class MenuClass extends GObject.Object {
    _init(prayers, times, extensionPath, clockFormat, menu) {
        super._init();

        let timeFormat;
        if (clockFormat === "12h") {
            timeFormat = "%l:%M %p";
        } else {
            timeFormat = "%R";
        }

        for (const prayer of prayers) {
            const menuItem = new PopupMenu.PopupBaseMenuItem({ reactive: false, activate: false, hover: false });

            menuItem.add_child(
                new St.Icon({
                    gicon: Gio.icon_new_for_string(`${extensionPath}/assets/icons/${prayer.id}.svg`),
                    icon_size: 20,
                })
            );
            menuItem.add_child(
                new St.Label({
                    text: prayer.name,
                    style_class: "prayer-name",
                })
            );
            menuItem.add_child(new St.Widget({ x_expand: true }));
            menuItem.add_child(
                new St.Label({
                    text: times[prayer.id].format(timeFormat),
                    style_class: "prayer-time",
                })
            );

            menu.addMenuItem(menuItem);
        }
    }
}
const Menu = GObject.registerClass(MenuClass);

export default class PrayerTime extends Extension {
    constructor(metadata) {
        super(metadata);
    }

    enable() {
        this._settings = new SettingManager(this);

        this._indicator = new Indicator(this.metadata.name);
        Main.panel.addToStatusArea(this.metadata.uuid, this._indicator, 1, "center");

        this._athanFile = Gio.File.new_for_path(this.metadata.path + "/assets/audio/athan.ogg");
        this._player = global.display.get_sound_player();

        this._main();

        this._settings.connectSettings();
    }

    _getPrayerTimes(now, midnight, dayOffset = 0) {
        if (midnight.get_day_of_week() === 5) {
            const thuhr = this._prayers.find((prayer) => prayer.id === "thuhr");
            thuhr.name = "Jummah";
        }

        const today = { day: now.add_days(dayOffset).get_day_of_month(), month: now.get_month(), year: now.get_year() };
        return new CalcPrayerTimes(today, this._settings.location, this._settings.calcAngles, this._settings.asrMethod, this._settings.highLatitudeMethod);
    }

    _differenceToMinutes(microseconds) {
        return Math.round(microseconds / 6e7);
    }

    _getNextPrayer(now, midnight) {
        let i = 0;

        // - 1 to exclude isha (check separately)
        while (i < this._prayers.length - 1) {
            const timeToPrayerUs = this._times[this._prayers[i].id].difference(now);
            if (timeToPrayerUs > 0) {
                return { timeLeft: this._differenceToMinutes(timeToPrayerUs), i };
            }
            i++;
        }

        // Isha
        const isNowBeforeMidnight = midnight.compare(now) === -1;
        const timeToIshaUs = this._times.isha.difference(now);
        if (timeToIshaUs > 0) {
            // Isha not yet
            if (isNowBeforeMidnight) {
                return { timeLeft: this._differenceToMinutes(timeToIshaUs), i };
            } else {
                // Yesterday isha is after midnight (edge case)
                this._times = this._getPrayerTimes(now, midnight, -1);
                return { timeLeft: this._differenceToMinutes(this._times.isha.difference(now)), i };
            }
        } else {
            // No prayers left for today
            i = 0;
            if (isNowBeforeMidnight) {
                this._times = this._getPrayerTimes(now, midnight, +1);
            } else {
                this._times = this._getPrayerTimes(now, midnight);
            }
            return { timeLeft: this._differenceToMinutes(this._times.fajr.difference(now)), i };
        }
    }

    _main() {
        this._prayers = [
            { id: "fajr", name: "Fajr" },
            ...(this._settings.isIncludeSunnah ? [{ id: "duha", name: "Duha" }] : []), //
            { id: "thuhr", name: "Thuhr" },
            { id: "asr", name: "Asr" },
            { id: "maghrib", name: "Maghrib" },
            { id: "isha", name: "Isha" },
        ];

        let now = GLib.DateTime.new_now_local();
        let midnight = GLib.DateTime.new_local(now.get_year(), now.get_month(), now.get_day_of_month(), 0, 0, 0.0);
        this._times = this._getPrayerTimes(now, midnight);
        let nextPrayer = this._getNextPrayer(now, midnight);
        nextPrayer.name = this._prayers[nextPrayer.i].name;
        // No longer needed for now
        now = null;
        midnight = null;

        this._indicator.setTimeLeftText(nextPrayer.name, nextPrayer.timeLeft);
        this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 60, () => {
            nextPrayer.timeLeft--;

            if (nextPrayer.timeLeft === 0) {
                const text = "Time for " + nextPrayer.name;

                this._indicator.setText(text);

                if (this._settings.isNotifyPrayer) {
                    Main.notify(this.metadata.name, text);
                }
                if (this._settings.isAthanPrayer) {
                    this._player.play_from_file(this._athanFile, "Its time for prayer", null);
                }

                if (nextPrayer.i === prayers.length - 1) {
                    // If last prayer move to next day
                    const now = GLib.DateTime.new_now_local();
                    const midnight = GLib.DateTime.new_now_local(now.get_year(), now.get_month(), now.get_day_of_month(), 0, 0, 0.0);
                    if (midnight.compare(now) === -1) {
                        this._times = this._getPrayerTimes(now, midnight, +1);
                    } else {
                        this._times = this._getPrayerTimes(now, midnight);
                    }
                    this.nextPrayer.timeLeft = this._differenceToMinutes(this._times.fajr.difference(now));
                    nextPrayer.i = 0;
                } else {
                    nextPrayer.i++;
                }
                nextPrayer.name = this._prayers[nextPrayer.i].name;
            } else if (this._settings.reminder && nextPrayer.timeLeft === this._settings.reminder) {
                const text = `${nextPrayer.name} in ${this._settings.reminder} minutes`;

                this._indicator.setText(text);

                if (this._settings.isNotifyPrayer) {
                    Main.notify(this.metadata.name, text);
                }
            } else {
                this._indicator.setTimeLeftText(nextPrayer.name, nextPrayer.timeLeft);
            }
        });

        this._menu = new Menu(this._prayers, this._times, this.metadata.path, this._settings.clockFormat, this._indicator.menu);
    }

    _reloadMain() {
        GLib.Source.remove(this._timeoutId);
        this._timeoutId = null;

        this._indicator.menu.removeAll();
        this._indicator.menu = null;

        this._main();
    }

    disable() {
        GLib.Source.remove(this._timeoutId);
        this._timeoutId = null;
        this._prayers = null;

        this._player = null;
        this._athanFile.unref();
        this._athanFile = null;

        this._times = null;

        this._indicator.menu.removeAll();
        this._indicator.menu = null;
        this._menu = null;
        this._indicator.destroy();
        this._indicator = null;

        this._settings.destroy();
        this._settings = null;
    }
}
