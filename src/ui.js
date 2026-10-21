import Gio from "gi://Gio";
import GObject from "gi://GObject";
import St from "gi://St";
import Clutter from "gi://Clutter";

import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";

export class Menu extends PopupMenu.PopupMenu {
    constructor(sourceActor, arrowAlignment, arrowSide, timeFormat) {
        super(sourceActor, arrowAlignment, arrowSide);
        this._currentActiveIndex = null;
        this._timeFormat = timeFormat;
    }

    populate(schedule) {
        for (const prayer of schedule.prayers) {
            const menuItem = new PopupMenu.PopupBaseMenuItem({ reactive: false, activate: false, hover: false });

            menuItem.add_child(new St.Icon({ gicon: prayer.icon, icon_size: 20 }));
            menuItem.add_child(new St.Label({ text: prayer.name, style_class: "prayer-name" }));
            menuItem.add_child(new St.Widget({ x_expand: true }));
            menuItem.add_child(new St.Label({ text: prayer.time.format(this._timeFormat) }));

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

        for (let i = 0; i < rows.length; i++) {
            const children = rows[i].get_children();
            const prayer = schedule.prayers[i];

            const nameLabel = children[1];
            if (nameLabel.text !== prayer.name) nameLabel.set_text(prayer.name);

            const timeLabel = children[children.length - 1];
            const formattedTime = prayer.time.format(this._timeFormat);
            if (timeLabel.text !== formattedTime) timeLabel.set_text(formattedTime);
        }

        this.highlightItem(schedule.nextPrayerI);
    }

    destroy() {
        this.removeAll();
        this._currentActiveIndex = null;
    }
}

class IndicatorClass extends PanelMenu.Button {
    _init(extensionName, settings, timeFormat) {
        super._init(0.5, extensionName, true);
        this._settings = settings;
        this._timeFormat = timeFormat;
        this._prayerId = null;
        this._icon = null;

        this._label = new St.Label({
            text: "...",
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._box = new St.BoxLayout({
            style: "padding: 0px 12px;",
        });
        this._box.add_child(this._label);
        this.add_child(this._box);
    }

    icon(prayer) {
        if (this._settings.indicatorStyle !== "name" && prayer.id) {
            if (this._prayerId === prayer.id && this._icon) return;
            this._prayerId = prayer.id;
            // TODO: in the settings-manager refactor move to a changed::indicator-style signal and call this on class init if enabled
            if (!this._icon) {
                this._icon = new St.Icon({ icon_size: 16, style: "margin-right: 6px" });
                this._box.insert_child_at_index(this._icon, 0);
            }
            this._icon.gicon = prayer.icon;
        } else if (this._icon) {
            this._prayerId = null;
            this._box.remove_child(this._icon);
            this._icon.destroy();
            this._icon = null;
        }
    }

    set text(value) {
        if (this._label.text !== value) this._label.set_text(value);
    }

    setArrival(prayerName) {
        this.text = _("Time for %s").format(prayerName);
    }

    setReminder(prayerName, minutesLeft) {
        this.text = _("%s in %d minutes").format(prayerName, minutesLeft);
    }

    setUpcoming(prayer, minutesLeft = 0) {
        const formattedTime = this._formatTime(prayer, minutesLeft);
        this.text = this._settings.indicatorStyle === "icon" ? formattedTime : _("%s %s").format(prayer.name, formattedTime);
    }
    _formatTime(prayer, minutesLeft) {
        if (this._settings.displayMode === "time") return prayer.time.format(this._timeFormat);

        const reminder = minutesLeft % 60;
        return `${(minutesLeft / 60) | 0}h ${reminder < 10 ? "0" + reminder : reminder}m`;
    }
}
export const Indicator = GObject.registerClass(IndicatorClass);
