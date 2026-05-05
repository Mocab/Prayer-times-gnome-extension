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
import { MawaqitClient } from "./mawaqit-client.js";

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
        super._init(0.5, extensionName, true);
        this.indicatorText = new St.Label({
            text: "...",
            y_align: Clutter.ActorAlign.CENTER,
            style: "padding: 0px 12px;",
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

export default class PrayerTime extends Extension {
    constructor(metadata) {
        super(metadata);
    }

    enable() {
        this._settings = new SettingManager(this);
        this._mawaqitClient = new MawaqitClient();
        this._mawaqitTimes = null;
        this._lastMawaqitRefreshDay = null;

        this._indicator = new Indicator(this.metadata.name);
        this._menu = new Menu(this._indicator, 0.5, St.Side.TOP, this.path);
        this._indicator.setMenu(this._menu);
        Main.panel.addToStatusArea(this.uuid, this._indicator, 1, "center");

        this._soundFile = Gio.File.new_for_path(this.path + "/assets/audio/athan.ogg");
        this._player = global.display.get_sound_player();

        this._main();

        this._settings.connectSettings();
    }

    _getPrayerName(id, isFriday = false) {
        const names = this._settings.prayerNames;
        if (isFriday && id === "dhuhr" && names.jummah) {
            return names.jummah;
        }
        return names[id] || _({
            fajr: "Fajr",
            duha: "Duha",
            dhuhr: "Dhuhr",
            asr: "Asr",
            maghrib: "Maghrib",
            isha: "Isha",
        }[id]);
    }

    _getClockFormat() {
        if (this._settings.useAmPm) {
            return "12h";
        }
        return this._settings.clockFormat;
    }

    _fetchMawaqitTimesIfNeeded() {
        if (!this._settings.useMawaqit || !this._settings.mawaqitSlug) {
            this._mawaqitTimes = null;
            return;
        }

        const now = GLib.DateTime.new_now_local();
        const today = now.get_day_of_year();

        // Already refreshed today
        if (this._lastMawaqitRefreshDay === today && this._mawaqitTimes) {
            return;
        }

        this._mawaqitClient.fetchPrayerTimes(this._settings.mawaqitSlug)
            .then((times) => {
                this._mawaqitTimes = times;
                this._lastMawaqitRefreshDay = today;
                // Reload to display Mawaqit times
                this._reloadMain();
            })
            .catch((error) => {
                console.error("Mawaqit fetch failed:", error);
                this._mawaqitTimes = null;
                // Only notify once per day
                if (this._lastMawaqitRefreshDay !== today) {
                    this._lastMawaqitRefreshDay = today;
                    Main.notify(this.metadata.name, _("Mawaqit fetch failed, using local calculation"));
                }
            });
    }

    _getDatePrayerTimes(now, midnight) {
        const today = { day: now.get_day_of_month(), month: now.get_month(), year: now.get_year() };
        const timezone = now.get_timezone();
        const localTimes = new CalcPrayerTimes(today, timezone, this._settings.location, this._settings.calcMethod, this._settings.asrMethod, this._settings.highLatAdjustment);

        // If Mawaqit times are available and valid, use them
        if (this._mawaqitTimes) {
            const mTimes = this._mawaqitTimes;
            // Validate: all required prayers must exist
            const hasAllTimes = ["fajr", "dhuhr", "asr", "maghrib", "isha"].every(
                (id) => mTimes[id] instanceof GLib.DateTime
            );
            if (hasAllTimes) {
                // If duha is included locally but not in Mawaqit, keep local duha
                if (this._settings.isIncludeSunnah && localTimes.duha && !mTimes.duha) {
                    mTimes.duha = localTimes.duha;
                }
                return mTimes;
            }
        }

        return localTimes;
    }

    _differenceToMinutes(microseconds) {
        return Math.round(microseconds / 6e7);
    }

    _getNextPrayer(now, midnight) {
        let i = 0;

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
            if (isNowBeforeMidnight) {
                return { timeLeft: this._differenceToMinutes(timeToIshaUs), i };
            } else {
                this._times = this._getDatePrayerTimes(now.add_days(-1), midnight);
                return { timeLeft: this._differenceToMinutes(this._times.isha.difference(now)), i };
            }
        } else {
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
        // Try to fetch Mawaqit times in background
        this._fetchMawaqitTimesIfNeeded();

        const isFriday = GLib.DateTime.new_now_local().get_day_of_week() === 5;

        this._prayers = [
            { id: "fajr", name: this._getPrayerName("fajr") },
            ...(this._settings.isIncludeSunnah ? [{ id: "duha", name: this._getPrayerName("duha") }] : []),
            { id: "dhuhr", name: this._getPrayerName("dhuhr", isFriday) },
            { id: "asr", name: this._getPrayerName("asr") },
            { id: "maghrib", name: this._getPrayerName("maghrib") },
            { id: "isha", name: this._getPrayerName("isha") },
        ];

        let now = GLib.DateTime.new_now_local();
        let midnight = GLib.DateTime.new_local(now.get_year(), now.get_month(), now.get_day_of_month(), 0, 0, 0.0);
        this._times = this._getDatePrayerTimes(now, midnight);
        let nextPrayer = this._getNextPrayer(now, midnight);
        nextPrayer.name = this._prayers[nextPrayer.i].name;

        this._indicator.setTimeLeftText(nextPrayer.name, nextPrayer.timeLeft);
        this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 60, () => {
            nextPrayer.timeLeft--;

            // Check for day change at 00:01 to refresh Mawaqit
            const currentNow = GLib.DateTime.new_now_local();
            if (currentNow.get_hour() === 0 && currentNow.get_minute() === 1) {
                this._fetchMawaqitTimesIfNeeded();
            }

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
                    this._menu.populate(this._prayers, this._times, this._getClockFormat());
                } else {
                    nextPrayer.i++;
                }
                this._menu.highlightItem(nextPrayer.i);
                nextPrayer.name = this._prayers[nextPrayer.i].name;
                nextPrayer.timeLeft = this._differenceToMinutes(this._times[this._prayers[nextPrayer.i].id].difference(now));
            } else if (this._settings.reminder && nextPrayer.timeLeft === this._settings.reminder) {
                const text = _("%s in %d minutes").format(nextPrayer.name, this._settings.reminder);

                this._indicator.setText(text);

                if (this._settings.isNotifyPrayer) {
                    Main.notify(this.metadata.name, text);
                }
            } else {
                this._indicator.setTimeLeftText(nextPrayer.name, nextPrayer.timeLeft);
            }
            return GLib.SOURCE_CONTINUE;
        });

        this._menu.populate(this._prayers, this._times, this._getClockFormat());
        this._menu.highlightItem(nextPrayer.i);
    }

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

        if (this._mawaqitClient) {
            this._mawaqitClient.destroy();
            this._mawaqitClient = null;
        }

        if (this._settings) {
            this._settings.destroy();
            this._settings = null;
        }
    }
}
