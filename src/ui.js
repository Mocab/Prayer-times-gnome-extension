import GObject from "gi://GObject";
import St from "gi://St";
import Clutter from "gi://Clutter";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";

export class Menu extends PopupMenu.PopupMenu {
    constructor(sourceActor, settings) {
        super(sourceActor, 0.5, St.Side.TOP);
        this._settings = settings;
        this._currentActiveIndex = null;
    }

    populate(schedule) {
        for (const prayer of schedule.prayers) {
            const menuItem = new PopupMenu.PopupBaseMenuItem({ reactive: false, activate: false, hover: false });
            const icon = new St.Icon({ gicon: prayer.icon, icon_size: 20 });
            const nameLabel = new St.Label({ text: prayer.name, style_class: "prayer-name" });
            const timeLabel = new St.Label({ text: prayer.time.format(this._settings.timeFormat) });

            menuItem._prayerIcon = icon;
            menuItem._prayerNameLabel = nameLabel;
            menuItem._prayerTimeLabel = timeLabel;
            menuItem.add_child(icon);
            menuItem.add_child(nameLabel);
            menuItem.add_child(new St.Widget({ x_expand: true }));
            menuItem.add_child(timeLabel);

            this.addMenuItem(menuItem);
        }
        this.highlightItem(schedule.nextPrayerI);
    }

    highlightItem(i) {
        const items = this._getMenuItems();
        if (!items[i]) return;

        items[this._currentActiveIndex]?.remove_style_class_name("prayer-next");

        items[i].add_style_class_name("prayer-next");
        this._currentActiveIndex = i;
    }

    update(schedule) {
        const rows = this._getMenuItems();
        this.updateIcons(schedule);

        for (let i = 0; i < rows.length; i++) {
            const prayer = schedule.prayers[i];
            const row = rows[i];
            if (!prayer) continue;
            if (row._prayerNameLabel.text !== prayer.name) row._prayerNameLabel.set_text(prayer.name);
            const formattedTime = prayer.time.format(this._settings.timeFormat);
            if (row._prayerTimeLabel.text !== formattedTime) row._prayerTimeLabel.set_text(formattedTime);
        }

        this.highlightItem(schedule.nextPrayerI);
    }

    updateIcons(schedule) {
        const rows = this._getMenuItems();

        for (let i = 0; i < rows.length && i < schedule.prayers.length; i++) {
            rows[i]._prayerIcon.gicon = schedule.prayers[i].icon;
        }
    }

    destroy() {
        this.removeAll();
        this._currentActiveIndex = null;
    }
}

class IndicatorClass extends PanelMenu.Button {
    _init(extensionName, settings) {
        super._init(0.5, extensionName, true);
        this._settings = settings;
        this._currentText = "...";
        this._iconOnlyText = "...";

        this._box = new St.BoxLayout({
            style: "padding: 0px 12px;",
        });
        this._icon = new St.Icon({ icon_size: 16, style: "margin-right: 6px" });
        this._box.add_child(this._icon);
        this._label = new St.Label({
            text: "...",
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._box.add_child(this._label);
        this.add_child(this._box);

        this._indicatorStyleSignal = this._settings.connect("changed::indicator-style", () => this._applyIndicatorStyle());
        this._applyIndicatorStyle();
    }

    _applyIndicatorStyle() {
        const style = this._settings.indicatorStyle;
        this._icon.visible = style !== "name";
        this._label.visible = true;
        this._label.set_text(style === "icon" ? this._iconOnlyText : this._currentText);
    }

    _setDisplay(fullText, iconOnlyText) {
        this._currentText = fullText;
        this._iconOnlyText = iconOnlyText;
        this._applyIndicatorStyle();
    }

    _setUpcomingDisplay(prayerName, value) {
        this._setDisplay(_("%s %s").format(prayerName, value), value);
    }

    set text(value) {
        this._setDisplay(value, value);
    }

    updateIcon(icon) {
        if (this._icon) this._icon.gicon = icon;
    }

    setUpcomingCountdown(prayerName, uSecLeft) {
        const totalMinutes = Math.floor(uSecLeft / 6e7);
        const minutes = totalMinutes % 60;
        this._setUpcomingDisplay(prayerName, `${Math.floor(totalMinutes / 60)}h ${minutes < 10 ? "0" + minutes : minutes}m`);
    }
    setUpcomingTime(prayer) {
        this._setUpcomingDisplay(prayer.name, prayer.time.format(this._settings.timeFormat));
    }

    setReminder(prayerName, reminderDuration) {
        const text = _("%s in %d minutes").format(prayerName, reminderDuration);
        this._setDisplay(text, text);
    }

    setArrival(prayerName) {
        const text = _("Time for %s").format(prayerName);
        this._setDisplay(text, text);
    }

    destroy() {
        if (this._indicatorStyleSignal) {
            this._settings.disconnect(this._indicatorStyleSignal);
            this._indicatorStyleSignal = null;
        }
        super.destroy();
    }
}
export const Indicator = GObject.registerClass(IndicatorClass);
