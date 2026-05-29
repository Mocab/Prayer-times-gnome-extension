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
                }),
            );
            menuItem.add_child(
                new St.Label({
                    text: prayer.name,
                    style_class: "prayer-name",
                }),
            );
            menuItem.add_child(new St.Widget({ x_expand: true }));
            menuItem.add_child(
                new St.Label({
                    text: times[prayer.id].format(timeFormat),
                }),
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
        const mm = (Math.floor(minutesToNext) % 60).toString().padStart(2, "0");
        this.indicatorText.set_text(`${nextName} in ${hh}:${mm}`);
    }

    setClockTimeText(nextName, prayerTime, clockFormat) {
        const timeFormat = clockFormat === "12h" ? _("%l:%M %p") : _("%R");
        this.indicatorText.set_text(`${nextName} - ${prayerTime.format(timeFormat)}`);
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
        this._mawaqitRetryCount = 0;
        this._mawaqitMaxRetries = 30; // 30 × 10s = 5 min
        this._mawaqitRetryTimeout = null;
        this._mawaqitFellBackToLocal = false;
        this._lastMawaqitSlug = null;

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
        return (
            names[id] ||
            _(
                {
                    fajr: "Fajr",
                    duha: "Duha",
                    dhuhr: "Dhuhr",
                    asr: "Asr",
                    maghrib: "Maghrib",
                    isha: "Isha",
                }[id],
            )
        );
    }

    _getClockFormat() {
        if (this._settings.useAmPm) {
            return "12h";
        }
        return this._settings.clockFormat;
    }

    _cancelMawaqitRetry() {
        if (this._mawaqitRetryTimeout) {
            GLib.Source.remove(this._mawaqitRetryTimeout);
            this._mawaqitRetryTimeout = null;
        }
    }

    _fetchMawaqitTimesIfNeeded() {
        const slug = this._settings.mawaqitSlug;

        if (!this._settings.useMawaqit || !slug) {
            if (this._lastMawaqitSlug !== null) {
                this._lastMawaqitSlug = null;
                this._mawaqitRetryCount = 0;
                this._mawaqitFellBackToLocal = false;
                this._lastMawaqitRefreshDay = null;
            }
            this._mawaqitTimes = null;
            this._cancelMawaqitRetry();
            return;
        }

        if (slug !== this._lastMawaqitSlug) {
            this._lastMawaqitSlug = slug;
            this._mawaqitTimes = null;
            this._mawaqitRetryCount = 0;
            this._mawaqitFellBackToLocal = false;
            this._lastMawaqitRefreshDay = null;
            this._cancelMawaqitRetry();
        }

        const now = GLib.DateTime.new_now_local();
        const today = now.get_day_of_year();

        if (this._lastMawaqitRefreshDay === today && (this._mawaqitTimes || this._mawaqitFellBackToLocal)) {
            return;
        }

        this._mawaqitClient
            .fetchPrayerTimes(this._settings.mawaqitSlug)
            .then((times) => {
                this._mawaqitTimes = times;
                this._lastMawaqitRefreshDay = today;
                this._mawaqitRetryCount = 0;
                this._mawaqitFellBackToLocal = false;
                this._cancelMawaqitRetry();
                this._reloadMain();
            })
            .catch((error) => {
                console.error("Mawaqit fetch failed:", error);
                this._mawaqitTimes = null;
                this._mawaqitRetryCount++;

                if (this._mawaqitRetryCount === 1) {
                    Main.notify(this.metadata.name, _("Mawaqit fetch failed, retrying…"));
                }

                const canFallback = this._settings.useLocalCalc;
                const maxRetries = canFallback ? this._mawaqitMaxRetries : Infinity;

                if (this._mawaqitRetryCount < maxRetries) {
                    this._cancelMawaqitRetry();
                    this._mawaqitRetryTimeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 10, () => {
                        this._mawaqitRetryTimeout = null;
                        this._fetchMawaqitTimesIfNeeded();
                        return GLib.SOURCE_REMOVE;
                    });
                } else if (!this._mawaqitFellBackToLocal) {
                    this._mawaqitFellBackToLocal = true;
                    this._lastMawaqitRefreshDay = today;
                    Main.notify(this.metadata.name, _("Mawaqit unavailable, using local calculation"));
                    this._reloadMain();
                }
            });
    }

    _getDatePrayerTimes(now, midnight) {
        const date = { day: now.get_day_of_month(), month: now.get_month(), year: now.get_year() };
        const timezone = now.get_timezone();
        const useMawaqit = this._settings.useMawaqit;
        const useLocal = this._settings.useLocalCalc;

        // Remote only, no fallback
        if (useMawaqit && !useLocal) {
            if (this._mawaqitTimes && this._mawaqitTimes.calendar) {
                const mawaqitDateTimes = this._mawaqitClient.extractTimesForDate(this._mawaqitTimes.calendar, date.year, date.month, date.day);
                if (mawaqitDateTimes) return mawaqitDateTimes;
            }
            return null;
        }

        // Local only (no remote)
        if (useLocal && !useMawaqit) {
            return new CalcPrayerTimes(date, timezone, this._settings.location, this._settings.calcMethod, this._settings.asrMethod, this._settings.highLatAdjustment);
        }

        // Both: remote with local fallback
        if (useMawaqit && useLocal) {
            if (this._mawaqitTimes && this._mawaqitTimes.calendar) {
                const mawaqitDateTimes = this._mawaqitClient.extractTimesForDate(this._mawaqitTimes.calendar, date.year, date.month, date.day);
                if (mawaqitDateTimes) {
                    const localTimes = new CalcPrayerTimes(date, timezone, this._settings.location, this._settings.calcMethod, this._settings.asrMethod, this._settings.highLatAdjustment);
                    if (this._settings.isIncludeSunnah && localTimes.duha && !mawaqitDateTimes.duha) {
                        mawaqitDateTimes.duha = localTimes.duha;
                    }
                    return mawaqitDateTimes;
                }
            }
            return new CalcPrayerTimes(date, timezone, this._settings.location, this._settings.calcMethod, this._settings.asrMethod, this._settings.highLatAdjustment);
        }

        return null;
    }

    _differenceToMinutes(microseconds) {
        return microseconds / 6e7;
    }

    _getNextPrayer(now, midnight) {
        if (!this._times) return null;

        for (let i = 0; i < this._prayers.length; i++) {
            const t = this._times[this._prayers[i].id];
            if (!t) continue;
            const timeToPrayerUs = t.difference(now);
            if (timeToPrayerUs > 0) {
                return { timeLeft: this._differenceToMinutes(timeToPrayerUs), i };
            }
        }

        const tomorrow = now.add_days(1);
        const tomorrowMidnight = GLib.DateTime.new_local(tomorrow.get_year(), tomorrow.get_month(), tomorrow.get_day_of_month(), 0, 0, 0.0);
        this._times = this._getDatePrayerTimes(tomorrow, tomorrowMidnight);

        if (!this._times || !this._times.fajr) return null;
        const timeToFajrUs = this._times.fajr.difference(now);
        return { timeLeft: this._differenceToMinutes(timeToFajrUs), i: 0 };
    }

    _updateIndicator(nextPrayer) {
        if (this._settings.displayMode === "clock-time") {
            this._indicator.setClockTimeText(nextPrayer.name, this._times[this._prayers[nextPrayer.i].id], this._getClockFormat());
        } else {
            this._indicator.setTimeLeftText(nextPrayer.name, nextPrayer.timeLeft);
        }
    }

    _isAwaitingMawaqit() {
        return this._settings.useMawaqit && this._settings.mawaqitSlug && !this._mawaqitTimes && !this._mawaqitFellBackToLocal;
    }

    _hasAnySource() {
        return this._settings.useLocalCalc || this._settings.useMawaqit;
    }

    _main() {
        this._fetchMawaqitTimesIfNeeded();

        const isFriday = GLib.DateTime.new_now_local().get_day_of_week() === 5;

        this._prayers = [{ id: "fajr", name: this._getPrayerName("fajr") }, ...(this._settings.isIncludeSunnah ? [{ id: "duha", name: this._getPrayerName("duha") }] : []), { id: "dhuhr", name: this._getPrayerName("dhuhr", isFriday) }, { id: "asr", name: this._getPrayerName("asr") }, { id: "maghrib", name: this._getPrayerName("maghrib") }, { id: "isha", name: this._getPrayerName("isha") }];

        if (this._isAwaitingMawaqit()) {
            this._indicator.setText("…");
            this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
                if (this._mawaqitTimes) {
                    this._reloadMain();
                    return GLib.SOURCE_REMOVE;
                }
                if (this._mawaqitFellBackToLocal) {
                    this._reloadMain();
                    return GLib.SOURCE_REMOVE;
                }
                this._indicator.setText("…");
                return GLib.SOURCE_CONTINUE;
            });
            return;
        }

        if (!this._hasAnySource()) {
            this._indicator.setText("…");
            return;
        }

        let now = GLib.DateTime.new_now_local();
        let midnight = GLib.DateTime.new_local(now.get_year(), now.get_month(), now.get_day_of_month(), 0, 0, 0.0);
        this._times = this._getDatePrayerTimes(now, midnight);
        let nextPrayer = this._getNextPrayer(now, midnight);

        if (!nextPrayer || !this._times) {
            this._indicator.setText("…");
            return;
        }

        nextPrayer.name = this._prayers[nextPrayer.i].name;

        this._updateIndicator(nextPrayer);

        this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 60, () => {
            const currentNow = GLib.DateTime.new_now_local();
            if (currentNow.get_hour() === 0 && currentNow.get_minute() === 1) {
                this._fetchMawaqitTimesIfNeeded();
            }

            const timeToNextUs = this._times[this._prayers[nextPrayer.i].id].difference(currentNow);
            nextPrayer.timeLeft = this._differenceToMinutes(timeToNextUs);

            if (nextPrayer.timeLeft <= 0) {
                const text = _("Time for %s").format(nextPrayer.name);
                this._indicator.setText(text);

                if (this._settings.isNotifyPrayer) {
                    Main.notify(this.metadata.name, text);
                }
                if (this._settings.isSoundPlayer) {
                    this._player.play_from_file(this._soundFile, text, null);
                }

                // Recalculate from scratch — skip all past prayers
                this._reminderFired = false;
                const now2 = GLib.DateTime.new_now_local();
                const midnight2 = GLib.DateTime.new_local(now2.get_year(), now2.get_month(), now2.get_day_of_month(), 0, 0, 0.0);
                nextPrayer = this._getNextPrayer(now2, midnight2);
                if (!nextPrayer) {
                    this._reloadMain();
                    return GLib.SOURCE_REMOVE;
                }
                nextPrayer.name = this._prayers[nextPrayer.i].name;

                this._menu.removeAll();
                this._menu.populate(this._prayers, this._times, this._getClockFormat());
                this._menu.highlightItem(nextPrayer.i);
            } else if (this._settings.reminder && nextPrayer.timeLeft <= this._settings.reminder && nextPrayer.timeLeft > this._settings.reminder - 1 && !this._reminderFired) {
                this._reminderFired = true;
                const text = _("%s in %d minutes").format(nextPrayer.name, this._settings.reminder);
                this._indicator.setText(text);

                if (this._settings.isNotifyPrayer) {
                    Main.notify(this.metadata.name, text);
                }
            }

            this._updateIndicator(nextPrayer);
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
        this._cancelMawaqitRetry();
        this._menu.removeAll();
        this._main();
    }

    disable() {
        this._cancelMawaqitRetry();

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
