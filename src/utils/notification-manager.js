import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as MessageTray from "resource:///org/gnome/shell/ui/messageTray.js";

export class NotificationManager {
    #settings;
    #notificationSource;

    constructor(extensionName, settings) {
        this.#settings = settings;

        this.#notificationSource = new MessageTray.Source({
            title: extensionName,
            iconName: "preferences-system-time-symbolic",
        });
        Main.messageTray.add(this.#notificationSource);
    }

    notifyArrival(prayer) {
        this.#triggerNotification(prayer.icon, _("Time for %s").format(prayer.name), _("It is time to pray."));
    }

    notifyReminder(prayer) {
        this.#triggerNotification(prayer.icon, _("%s Reminder").format(prayer.name), _("Begins in %d minutes.").format(this.#settings.reminder));
    }

    #triggerNotification(gicon, title, body) {
        if (!this.#settings.isNotify) return;

        this.#notificationSource.addNotification(new MessageTray.Notification({ source: this.#notificationSource, title, body, gicon, isTransient: true }));
    }

    destroy() {
        if (this.#notificationSource) {
            this.#notificationSource.destroy();
            this.#notificationSource = null;
        }
    }
}
