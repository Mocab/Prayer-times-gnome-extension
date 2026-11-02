import GObject from "gi://GObject";
import St from "gi://St";
import Clutter from "gi://Clutter";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";

export class Menu extends PopupMenu.PopupMenu {
    constructor(sourceActor, settings) {
        super(sourceActor, 0.5, St.Side.TOP);
        this._settings = settings;
        this._currentActiveIndex = null;
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
            const formattedTime = prayer.time.format(this._settings.timeFormat);
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
    _init(extensionName, settings, getNextPrayer) {
        super._init(0.5, extensionName, true);
        this._settings = settings;
        const toggleIcon = () => {
            if (this._settings.indicatorStyle !== "name") {
                if (!this._icon) {
                    this._icon = new St.Icon({ icon_size: 16, style: "margin-right: 6px" });
                    this._box.insert_child_at_index(this._icon, 0);
                }
                this.updateIcon(getNextPrayer());
            } else if (this._icon) {
                this._box.remove_child(this._icon);
                this._icon.destroy();
                this._icon = null;
            }
        };

        this._box = new St.BoxLayout({
            style: "padding: 0px 12px;",
        });
        toggleIcon();
        this._label = new St.Label({
            text: "...",
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._box.add_child(this._label);
        this.add_child(this._box);

        this._indicatorStyleSignal = this._settings.connect("changed::indicator-style", toggleIcon); // TODO: disconnect and handle adding new icon
    }

    set text(value) {
        this._label.set_text(value);
    }

    updateIcon(icon) {
        this._icon?.gicon = icon;
    }

    setUpcomingCountdown(prayerName, uSecLeft) {
        const totalMinutes = Math.floor(uSecLeft / 6e7);
        const minutes = totalMinutes % 60;
        this.text = _("%s %s").format(prayerName, `${Math.floor(totalMinutes / 60)}h ${minutes < 10 ? "0" + minutes : minutes}m`);
    }
    setUpcomingTime(prayer) {
        this.text = _("%s %s").format(prayer.name, prayer.time.format(this._settings.timeFormat));
    }

    setReminder(prayerName, reminderDuration) {
        this.text = _("%s in %d minutes").format(prayerName, reminderDuration);
    }

    setArrival(prayerName) {
        this.text = _("Time for %s").format(prayerName);
    }

    destroy() {
        if (this._indicatorStyleSignal) {
            this._settings.disconnectDesktop(this._indicatorStyleSignal);
            this._indicatorStyleSignal = null;
        }
        super.destroy();
    }
}
export const Indicator = GObject.registerClass(IndicatorClass);
