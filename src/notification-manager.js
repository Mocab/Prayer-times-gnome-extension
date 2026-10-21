import Gio from "gi://Gio";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as MessageTray from "resource:///org/gnome/shell/ui/messageTray.js";

export class NotificationManager {
    constructor(extensionName, settings, basePath, timeFormat) {
        this._settings = settings;
        this._basePath = basePath;
        this._timeFormat = timeFormat;

        this._notificationSource = new MessageTray.Source({
            title: extensionName,
            iconName: "preferences-system-time-symbolic",
        });
        Main.messageTray.add(this._notificationSource);
    }

    notifyPrayer(prayer) {
        this._triggerNotification(prayer, _("Time for %s").format(prayer.name), _("It is time to pray."));
    }

    notifyReminder(prayer) {
        this._triggerNotification(prayer, _("Upcoming prayer"), _("%s is in %d minutes (%s).").format(prayer.name, this._settings.reminder, prayer.time.format(this._timeFormat)));
    }

    _triggerNotification(prayer, title, body) {
        if (!this._settings.isNotify) return;

        this._notificationSource.addNotification(
            new MessageTray.Notification({
                source: this._notificationSource,
                title,
                body,
                gicon: new Gio.FileIcon({ file: Gio.File.new_for_path(`${this._basePath}/assets/icons/${prayer.id}.svg`) }),
                isTransient: true,
            }),
        );
    }

    destroy() {
        if (this._notificationSource) {
            this._notificationSource.destroy();
            this._notificationSource = null;
        }
    }
}
