import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as MessageTray from "resource:///org/gnome/shell/ui/messageTray.js";

export class NotificationManager {
    #settings;
    #extensionName;
    #notificationSource;

    constructor(extensionName, settings) {
        this.#settings = settings;
        this.#extensionName = extensionName;
        this.#createNotificationSource();
    }

    #createNotificationSource() {
        const source = new MessageTray.Source({
            title: this.#extensionName,
            iconName: "preferences-system-time-symbolic",
        });
        source.connect("destroy", () => {
            if (this.#notificationSource === source) this.#notificationSource = null;
        });
        this.#notificationSource = source;
        Main.messageTray.add(source);
    }

    notifyArrival(prayer) {
        this.#triggerNotification(prayer.icon, _("Time for %s").format(prayer.name), _("It is time to pray."));
    }

    notifyReminder(prayer) {
        this.#triggerNotification(prayer.icon, _("%s Reminder").format(prayer.name), _("Begins in %d minutes.").format(this.#settings.reminder));
    }

    #triggerNotification(gicon, title, body) {
        if (!this.#settings.isNotify) return;

        try {
            if (!this.#notificationSource) this.#createNotificationSource();
            const source = this.#notificationSource;
            source.addNotification(new MessageTray.Notification({
                source,
                title,
                body,
                gicon,
                urgency: MessageTray.Urgency.NORMAL,
                isTransient: true,
            }));
        } catch (error) {
            console.error("[Prayer Times] Failed to show notification:", error);
        }
    }

    destroy() {
        if (this.#notificationSource) {
            const source = this.#notificationSource;
            this.#notificationSource = null;
            source.destroy();
        }
    }
}
