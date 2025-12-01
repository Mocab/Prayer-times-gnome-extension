import Adw from "gi://Adw";
import Gtk from "gi://Gtk";
import { ExtensionPreferences, gettext as _ } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

export default class PrayerTimePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const page = new Adw.PreferencesPage();
        const gSettings = this.getSettings();
        window.add(page);

        this.#locationGroup(page, gSettings);
        this.#calcGroup(page, gSettings);
        this.#notificationGroup(page, gSettings);
    }

    #locationGroup(page, gSettings) {
        const locationGroup = new Adw.PreferencesGroup({
            title: _("Location"),
        });
        page.add(locationGroup);

        const autoLocation = new Adw.SwitchRow({
            title: _("Automatic location"),
        });
        const customLocation = new Adw.ExpanderRow({
            title: _("Custom location"),
        });
        const latitude = new Adw.SpinRow({
            title: _("Latitude"),
            digits: 4,
            adjustment: new Gtk.Adjustment({
                lower: -90.0,
                upper: 90.0,
                step_increment: 0.0001,
            }),
        });
        const longitude = new Adw.SpinRow({
            title: _("Longitude"),
            digits: 4,
            adjustment: new Gtk.Adjustment({
                lower: -180.0,
                upper: 180.0,
                step_increment: 0.0001,
            }),
        });

        locationGroup.add(autoLocation);
        locationGroup.add(customLocation);
        customLocation.add_row(latitude);
        customLocation.add_row(longitude);
        gSettings.bind("auto-location", autoLocation, "active", 0);
        gSettings.bind("latitude", latitude, "value", 0);
        gSettings.bind("longitude", longitude, "value", 0);
        function updateLocationSensitivity() {
            customLocation.sensitive = !autoLocation.active;
        }
        updateLocationSensitivity();
        autoLocation.connect("notify::active", updateLocationSensitivity);
    }

    #calcGroup(page, gSettings) {
        const calcGroup = new Adw.PreferencesGroup({
            title: _("Calculations"),
        });
        page.add(calcGroup);

        const presetAngles = [
            { id: "mwl", name: _("Muslim World League (London)") },
            { id: "egypt", name: _("Egyptian General Authority of Survey") },
            { id: "france", name: _("Musulmans de France") },
            { id: "isna", name: _("Islamic Society of North America") },
            { id: "karachi", name: _("Uni of Islamic Sciences (Karachi)") },
            { id: "turkey", name: _("Diyanet İşleri Başkanlığı (Turkey)") },
            { id: "makkah", name: _("Umm al-Qura Uni (Makkah)") },
            { id: "malaysia", name: _("Jabatan Kemajuan Islam Malaysia") },
            { id: "russia", name: _("Spiritual Administration of Muslims of Russia") },
            { id: "custom", name: _("Custom") },
        ];
        const presetAngle = new Adw.ComboRow({
            title: _("Preset angles"),
            model: new Gtk.StringList({ strings: presetAngles.map((a) => a.name) }),
        });
        const customAngles = new Adw.ExpanderRow({
            title: _("Custom angles"),
        });
        const fajrAngle = new Adw.SpinRow({
            title: _("Fajr angle"),
            digits: 1,
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 20,
                step_increment: 0.5,
            }),
        });
        const ishaAngle = new Adw.SpinRow({
            title: _("Isha angle"),
            digits: 1,
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 20,
                step_increment: 0.5,
            }),
        });
        const asrMethods = [
            { id: "standard", name: _("Hanbali, Maliki, Shafi") },
            { id: "hanafi", name: _("Hanafi") },
        ];
        const asrMethod = new Adw.ComboRow({
            title: _("Asr shadow method"),
            model: new Gtk.StringList({ strings: asrMethods.map((a) => a.name) }),
        });
        const highLatAdjustments = [
            { id: "night-middle", name: _("Middle of night") },
            { id: "night-seventh", name: _("One seventh of night") },
            { id: "angle", name: _("Angle based") },
        ];
        const highLatAdjustment = new Adw.ComboRow({
            title: _("High latitude adjustment"),
            model: new Gtk.StringList({ strings: highLatAdjustments.map((h) => h.name) }),
        });
        const includeSunnah = new Adw.SwitchRow({
            title: _("Include sunnah prayers"),
        });

        calcGroup.add(presetAngle);
        calcGroup.add(customAngles);
        customAngles.add_row(fajrAngle);
        customAngles.add_row(ishaAngle);
        calcGroup.add(asrMethod);
        calcGroup.add(highLatAdjustment);
        calcGroup.add(includeSunnah);
        gSettings.bind_with_mapping(
            "preset-angles",
            presetAngle,
            "selected",
            0,
            (gObject, gSetting) => {
                gObject = presetAngles.indexOf((object) => object.id === gSetting.unpack());
                return true;
            },
            (gObject) => {
                return new Gio.GVariant("s", presetAngles[gObject].id);
            }
        );
        gSettings.bind("fajr-angle", fajrAngle, "value", 0);
        gSettings.bind("isha-angle", ishaAngle, "value", 0);
        gSettings.bind_with_mapping(
            "asr-method",
            asrMethod,
            "selected",
            0,
            (gObject, gSetting) => {
                gObject = asrMethods.indexOf((object) => object.id === gSetting.unpack());
                return true;
            },
            (gObject) => {
                return new Gio.GVariant("s", asrMethods[gObject].id);
            }
        );
        gSettings.bind_with_mapping(
            "high-latitude-adjustment",
            highLatAdjustment,
            "selected",
            0,
            (gObject, gSetting) => {
                gObject = highLatAdjustments.indexOf((object) => object.id === gSetting.unpack());
                return true;
            },
            (gObject) => {
                return new Gio.GVariant("s", highLatAdjustments[gObject].id);
            }
        );
        function updateAngleSensitivity() {
            customAngles.sensitive = presetAngles[presetAngle.selected].id === "custom";
        }
        updateAngleSensitivity();
        presetAngle.connect("notify::selected", updateAngleSensitivity);
        gSettings.bind("include-sunnah", includeSunnah, "active", 0);
    }

    #notificationGroup(page, gSettings) {
        const notificationGroup = new Adw.PreferencesGroup({
            title: _("Notifications"),
        });
        page.add(notificationGroup);

        const notifyPrayer = new Adw.SwitchRow({
            title: _("Send notifications"),
        });
        const soundPlayer = new Adw.SwitchRow({
            title: _("Play a sound for prayers"),
        });
        const reminderTimes = [
            { length: 0, name: _("Off") },
            { length: 5, name: _("5 minutes") },
            { length: 10, name: _("10 minutes") },
            { length: 15, name: _("15 minutes") },
        ];
        const reminderTime = new Adw.ComboRow({
            title: _("Notify before prayer"),
            model: new Gtk.StringList({ strings: reminderTimes.map((r) => r.name) }),
        });

        notificationGroup.add(notifyPrayer);
        notificationGroup.add(soundPlayer);
        notificationGroup.add(reminderTime);
        gSettings.bind("notify-prayer", notifyPrayer, "active", 0);
        gSettings.bind("sound-player", soundPlayer, "active", 0);
        gSettings.bind_with_mapping(
            "reminder",
            reminderTime,
            "selected",
            0,
            (gObject, gSetting) => {
                gObject = reminderTimes.indexOf((object) => object.length === gSetting.unpack());
                return true;
            },
            (gObject) => {
                return new Gio.GVariant("i", reminderTimes[gObject].length);
            }
        );
    }
}
