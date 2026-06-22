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

    populate(prayers) {
        for (const prayer of prayers) {
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
    }

    highlightItem(i) {
        const items = this._getMenuItems();
        if (!items[i]) return;

        items[this._currentActiveIndex]?.remove_style_class_name("active");

        items[i].add_style_class_name("active");
        this._currentActiveIndex = i;
    }

    removeAll() {
        super.removeAll();
        this._currentActiveIndex = null;
    }
}

class IndicatorClass extends PanelMenu.Button {
    _init(extensionName, timeFormat) {
        super._init(0.5, extensionName, true);
        this.indicatorText = new St.Label({
            text: "...",
            y_align: Clutter.ActorAlign.CENTER,
            style: "padding: 0px 12px;",
        });
        this.add_child(this.indicatorText);
        this._timeFormat = timeFormat;
    }

    set text(text) {
        this.indicatorText.set_text(text);
    }

    setTimeLeftText(nextName, minutesToNext) {
        const hh = Math.floor(minutesToNext / 60)
            .toString()
            .padStart(2, "0");
        const mm = (Math.floor(minutesToNext) % 60).toString().padStart(2, "0");
        this.text = `${nextName} in ${hh}:${mm}`;
    }

    setClockTimeText(nextName, nextTime) {
        this.text = `${nextName} - ${nextTime.format(this._timeFormat)}`;
    }
}
export const Indicator = GObject.registerClass(IndicatorClass);
