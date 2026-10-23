import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as MessageTray from "resource:///org/gnome/shell/ui/messageTray.js";

export class NotificationManager {
    constructor(extensionName, settings) {
        this._settings = settings;

        this._notificationSource = new MessageTray.Source({
            title: extensionName,
            iconName: "preferences-system-time-symbolic",
        });
        Main.messageTray.add(this._notificationSource);
    }

    notifyArrival(prayer) {
        this._triggerNotification(prayer, _("Time for %s").format(prayer.name), _("It is time to pray."));
    }

    notifyReminder(prayer) {
        this._triggerNotification(prayer, _("%s Reminder").format(prayer.name), _("Begins in %d minutes.").format(this._settings.reminder));
    }

    _triggerNotification(prayer, title, body) {
        if (!this._settings.isNotify) return;

        this._notificationSource.addNotification(
            new MessageTray.Notification({
                source: this._notificationSource,
                title,
                body,
                gicon: prayer.icon,
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
