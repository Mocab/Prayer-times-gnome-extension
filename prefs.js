import Adw from "gi://Adw";
import Gtk from "gi://Gtk";
import { ExtensionPreferences, gettext as _ } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

export default class PrayerTimePreferences extends ExtensionPreferences {
    #gSettings;
    #page;

    fillPreferencesWindow(window) {
        this.#gSettings = this.getSettings();
        this.#page = new Adw.PreferencesPage();
        window.add(this.#page);

        this.#locationGroup();
        this.#calcGroup();
        this.#notificationGroup();
    }

    #locationGroup() {
        const locationGroup = new Adw.PreferencesGroup({
            title: "Location",
        });
        this.#page.add(locationGroup);

        const autoLocation = new Adw.SwitchRow({
            title: "Automatic location",
        });
        const customLocation = new Adw.ExpanderRow({
            title: "Custom location",
        });
        const latitude = new Adw.SpinRow({
            title: "Latitude",
            digits: 4,
            adjustment: new Gtk.Adjustment({
                lower: -90.0,
                upper: 90.0,
                step_increment: 0.0001,
            }),
        });
        const longitude = new Adw.SpinRow({
            title: "Longitude",
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
        this.#gSettings.bind("auto-location", autoLocation, "active", 0);
        this.#gSettings.bind("latitude", latitude, "value", 0);
        this.#gSettings.bind("longitude", longitude, "value", 0);
        function updateLocationSensitivity() {
            customLocation.sensitive = !autoLocation.active;
        }
        updateLocationSensitivity();
        autoLocation.connect("notify::active", updateLocationSensitivity);
    }

    #calcGroup() {
        const calcGroup = new Adw.PreferencesGroup({
            title: "Calculation",
        });
        this.#page.add(calcGroup);

        const presetAngles = [
            { id: "mwl", name: "Muslim World League (London)" },
            { id: "egypt", name: "Egyptian General Authority of Survey" },
            { id: "france", name: "Musulmans de France" },
            { id: "isna", name: "Islamic Society of North America" },
            { id: "karachi", name: "Uni of Islamic Sciences (Karachi)" },
            { id: "turkey", name: "Diyanet İşleri Başkanlığı (Turkey)" },
            { id: "makkah", name: "Umm al-Qura Uni (Makkah)" },
            { id: "malaysia", name: "Jabatan Kemajuan Islam Malaysia" },
            { id: "russia", name: "Spiritual Administration of Muslims of Russia" },
            { id: "custom", name: "Custom" },
        ];
        const presetAngle = new Adw.ComboRow({
            title: "Preset angles",
            model: new Gtk.StringList({ strings: presetAngles.map((a) => a.name) }),
        });
        const customAngles = new Adw.ExpanderRow({
            title: "Custom angles",
        });
        const fajrAngle = new Adw.SpinRow({
            title: "Fajr angle",
            digits: 1,
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 20,
                step_increment: 0.5,
            }),
        });
        const ishaAngle = new Adw.SpinRow({
            title: "Isha angle",
            digits: 1,
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 20,
                step_increment: 0.5,
            }),
        });
        const asrMethods = [
            { id: "standard", name: "Hanbali, Maliki, Shafi" },
            { id: "hanafi", name: "Hanafi" },
        ];
        const asrMethod = new Adw.ComboRow({
            title: "Asr method",
            model: new Gtk.StringList({ strings: asrMethods.map((a) => a.name) }),
        });
        const highLatMethods = [
            { id: "night-middle", name: "Middle of night" },
            { id: "night-seventh", name: "One seventh of night" },
            { id: "angle", name: "Angle based" },
        ];
        const highLatMethod = new Adw.ComboRow({
            title: "High latitude method",
            model: new Gtk.StringList({ strings: highLatMethods.map((h) => h.name) }),
        });
        const includeSunnah = new Adw.SwitchRow({
            title: "Include sunnah prayers",
        });

        calcGroup.add(presetAngle);
        calcGroup.add(customAngles);
        customAngles.add_row(fajrAngle);
        customAngles.add_row(ishaAngle);
        calcGroup.add(asrMethod);
        calcGroup.add(highLatMethod);
        calcGroup.add(includeSunnah);
        this.#gSettings.bind_with_mapping(
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
        this.#gSettings.bind("fajr-angle", fajrAngle, "value", 0);
        this.#gSettings.bind("isha-angle", ishaAngle, "value", 0);
        this.#gSettings.bind_with_mapping(
            "asr-method",
            asrMethod,
            "selected",
            0,
            (gObject, gSetting) => {
                gObject = asrMethods.indexOf((object) => object.id === gSetting.unpack());
                return true;
            },
            (gObject) => {
                return new Gio.GVariant("s", (gSetting = asrMethods[gObject].id));
            }
        );
        this.#gSettings.bind_with_mapping(
            "high-latitude-method",
            highLatMethod,
            "selected",
            0,
            (gObject, gSetting) => {
                gObject = highLatMethods.indexOf((object) => object.id === gSetting.unpack());
                return true;
            },
            (gObject) => {
                return new Gio.GVariant("s", (gSetting = highLatMethods[gObject].id));
            }
        );
        function updateAngleSensitivity() {
            customAngles.sensitive = presetAngles[presetAngle.selected].id === "custom";
        }
        updateAngleSensitivity();
        presetAngle.connect("notify::selected", updateAngleSensitivity);
        this.#gSettings.bind("include-sunnah", includeSunnah, "active", 0);
    }

    #notificationGroup() {
        const notificationGroup = new Adw.PreferencesGroup({
            title: "Notifications",
        });
        this.#page.add(notificationGroup);

        const notifyPrayer = new Adw.SwitchRow({
            title: "Send a notification for reminders and prayers",
        });
        const alarmPrayer = new Adw.SwitchRow({
            title: "Play athan for prayers",
        });
        const reminderTimes = [
            { length: 0, name: "Off" },
            { length: 5, name: "5 minutes" },
            { length: 10, name: "10 minutes" },
            { length: 15, name: "15 minutes" },
        ];
        const reminderTime = new Adw.ComboRow({
            title: "Notify before prayer",
            model: new Gtk.StringList({ strings: reminderTimes.map((r) => r.name) }),
        });

        notificationGroup.add(notifyPrayer);
        notificationGroup.add(alarmPrayer);
        notificationGroup.add(reminderTime);
        this.#gSettings.bind("notify-prayer", notifyPrayer, "active", 0);
        this.#gSettings.bind("athan-prayer", alarmPrayer, "active", 0);
        this.#gSettings.bind_with_mapping(
            "reminder",
            reminderTime,
            "selected",
            0,
            (gObject, gSetting) => {
                gObject = reminderTimes.indexOf((object) => object.length === gSetting.unpack());
                return true;
            },
            (gObject) => {
                return new Gio.GVariant("i", (gSetting = reminderTimes[gObject].length));
            }
        );
    }
}
