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

class Menu extends PopupMenu.PopupMenu {
    static iconsPath = "";

    constructor(sourceActor, arrowAlignment, arrowSide, extensionPath) {
        super(sourceActor, arrowAlignment, arrowSide);
        Menu.iconsPath = extensionPath + "/assets/icons";
    }

    populate(prayers, times, clockFormat) {
        const timeFormat = clockFormat === "12h" ? _("%l:%M %p") : _("%R");

        for (const prayer of prayers) {
            const menuItem = new PopupMenu.PopupBaseMenuItem({ reactive: false, activate: false, hover: false });

            menuItem.add_child(
                new St.Icon({
                    gicon: Gio.icon_new_for_string(Menu.iconsPath + "/" + prayer.id + ".svg"),
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
                })
            );

            this.addMenuItem(menuItem);
        }
    }

    highlightItem(i) {
        const items = this._getMenuItems();
        if (i > 0) {
            items[i - 1].remove_style_class_name("active");
        }
        items[i].add_style_class_name("active");
    }
}

class IndicatorClass extends PanelMenu.Button {
    _init(extensionName) {
        super._init(0.5, extensionName, true); // 0.5 == middle of topPanel. true to disable automatic menu creation
        this.indicatorText = new St.Label({
            text: "...",
            y_align: Clutter.ActorAlign.CENTER,
            style: "padding: 0px 12px;", // Inline to avoid it being overridden by extensions that collapse padding
        });
        this.add_child(this.indicatorText);
    }

    // For readability
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

export default class PrayerTime extends Extension {
    constructor(metadata) {
        super(metadata);
    }

    enable() {
        this._settings = new SettingManager(this);

        this._indicator = new Indicator(this.metadata.name);
        this._menu = new Menu(this._indicator, 0.5, St.Side.TOP, this.path);
        this._indicator.setMenu(this._menu);
        Main.panel.addToStatusArea(this.uuid, this._indicator, 1, "center");

        this._soundFile = Gio.File.new_for_path(this.path + "/assets/audio/athan.ogg");
        this._player = global.display.get_sound_player();

        this._main();

        this._settings.connectSettings();
    }

    _getDatePrayerTimes(now, midnight) {
        if (midnight.get_day_of_week() === 5) {
            const thuhr = this._prayers.find((prayer) => prayer.id === "thuhr");
            thuhr.name = _("Jummah");
        }

        const today = { day: now.get_day_of_month(), month: now.get_month(), year: now.get_year() };
        const timezone = now.get_timezone();
        return new CalcPrayerTimes(today, timezone, this._settings.location, this._settings.calcMethod, this._settings.asrMethod, this._settings.highLatAdjustment);
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
                this._times = this._getDatePrayerTimes(now.add_days(-1), midnight);
                return { timeLeft: this._differenceToMinutes(this._times.isha.difference(now)), i };
            }
        } else {
            // No prayers left for today
            i = 0;
            if (isNowBeforeMidnight) {
                this._times = this._getDatePrayerTimes(now.add_days(1), midnight);
            } else {
                this._times = this._getDatePrayerTimes(now, midnight);
            }
            return { timeLeft: this._differenceToMinutes(this._times.fajr.difference(now)), i };
        }
    }

    _main() {
        this._prayers = [
            { id: "fajr", name: _("Fajr") },
            ...(this._settings.isIncludeSunnah ? [{ id: "duha", name: _("Duha") }] : []), //
            { id: "thuhr", name: _("Thuhr") },
            { id: "asr", name: _("Asr") },
            { id: "maghrib", name: _("Maghrib") },
            { id: "isha", name: _("Isha") },
        ];

        let now = GLib.DateTime.new_now_local();
        let midnight = GLib.DateTime.new_local(now.get_year(), now.get_month(), now.get_day_of_month(), 0, 0, 0.0);
        this._times = this._getDatePrayerTimes(now, midnight);
        let nextPrayer = this._getNextPrayer(now, midnight);
        nextPrayer.name = this._prayers[nextPrayer.i].name;

        this._indicator.setTimeLeftText(nextPrayer.name, nextPrayer.timeLeft);
        this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 60, () => {
            nextPrayer.timeLeft--;

            if (nextPrayer.timeLeft <= 0) {
                const text = _("Time for %s").format(nextPrayer.name);

                this._indicator.setText(text);

                if (this._settings.isNotifyPrayer) {
                    Main.notify(this.metadata.name, text);
                }
                if (this._settings.isSoundPlayer) {
                    this._player.play_from_file(this._soundFile, text, null);
                }

                // If last prayer move to next day
                now = GLib.DateTime.new_now_local();
                if (nextPrayer.i === this._prayers.length - 1) {
                    midnight = GLib.DateTime.new_local(now.get_year(), now.get_month(), now.get_day_of_month(), 0, 0, 0.0);
                    if (midnight.compare(now) === -1) {
                        this._times = this._getDatePrayerTimes(now.add_days(1), midnight);
                    } else {
                        this._times = this._getDatePrayerTimes(now, midnight);
                    }
                    nextPrayer.i = 0;

                    this._menu.removeAll();
                    this._menu.populate(this._prayers, this._times, this._settings.clockFormat);
                } else {
                    nextPrayer.i++;
                }
                this._menu.highlightItem(nextPrayer.i);
                nextPrayer.name = this._prayers[nextPrayer.i].name;
                nextPrayer.timeLeft = this._differenceToMinutes(this._times[this._prayers[nextPrayer.i].id].difference(now));
            } else if (this._settings.reminder && nextPrayer.timeLeft === this._settings.reminder) {
                const text = _("%s in %d minutes").format(nextPrayer.name, this._settings.reminder); // Values are 0, 5, 15, 15 so ngettext not needed

                this._indicator.setText(text);

                if (this._settings.isNotifyPrayer) {
                    Main.notify(this.metadata.name, text);
                }
            } else {
                this._indicator.setTimeLeftText(nextPrayer.name, nextPrayer.timeLeft);
            }
            return GLib.SOURCE_CONTINUE;
        });

        this._menu.populate(this._prayers, this._times, this._settings.clockFormat);
        this._menu.highlightItem(nextPrayer.i);
    }

    // For setting changes
    _reloadMain() {
        if (this._timeoutId) {
            GLib.Source.remove(this._timeoutId);
            this._timeoutId = null;
        }
        this._menu.removeAll();
        this._main();
    }

    disable() {
        if (this._timeoutId) {
            GLib.Source.remove(this._timeoutId);
            this._timeoutId = null;
        }

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
