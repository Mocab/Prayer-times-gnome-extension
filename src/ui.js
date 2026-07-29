import Gio from "gi://Gio";
import GObject from "gi://GObject";
import St from "gi://St";
import Clutter from "gi://Clutter";

import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";

export class Menu extends PopupMenu.PopupMenu {
    constructor(sourceActor, arrowAlignment, arrowSide, extensionPath, timeFormat) {
        super(sourceActor, arrowAlignment, arrowSide);
        this.extensionPath = extensionPath;
        this._currentActiveIndex = null;
        this._timeFormat = timeFormat;
    }

    populate(schedule) {
        for (const prayer of schedule.prayers) {
            const menuItem = new PopupMenu.PopupBaseMenuItem({ reactive: false, activate: false, hover: false });

            menuItem.add_child(
                new St.Icon({
                    gicon: Gio.icon_new_for_string(`${this.extensionPath}/assets/icons/${prayer.id}.svg`),
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
                    text: prayer.time.format(this._timeFormat),
                }),
            );

            this.addMenuItem(menuItem);
        }
        this.highlightItem(schedule.nextPrayerI);
    }

    highlightItem(i) {
        const items = this._getMenuItems();
        if (!items[i]) return;

        items[this._currentActiveIndex]?.remove_style_class_name("active");

        items[i].add_style_class_name("active");
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
    _init(extensionName) {
        super._init(0.5, extensionName, true);
        this._label = new St.Label({
            text: "...",
            y_align: Clutter.ActorAlign.CENTER,
            style: "padding: 0px 12px;",
        });
        this.add_child(this._label);
    }

    get text() {
        return this._label.text;
    }

    set text(value) {
        if (this._label.text !== value) this._label.set_text(value);
    }
}
export const Indicator = GObject.registerClass(IndicatorClass);
