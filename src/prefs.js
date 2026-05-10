import Adw from "gi://Adw";
import Gtk from "gi://Gtk";
import GLib from "gi://GLib";
import Gio from "gi://Gio";
import Soup from "gi://Soup";
import { ExtensionPreferences, gettext as _ } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

export default class PrayerTimePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const gSettings = this.getSettings();

        // Tab 1: General
        const generalPage = new Adw.PreferencesPage({
            title: _("General"),
            icon_name: "preferences-system-symbolic",
        });
        window.add(generalPage);
        this.#prayerNamesGroup(generalPage, gSettings);
        this.#displayGroup(generalPage, gSettings);
        this.#notificationGroup(generalPage, gSettings);

        // Tab 2: Configuration
        const calcPage = new Adw.PreferencesPage({
            title: _("Configuration"),
            icon_name: "system-run-symbolic",
        });
        window.add(calcPage);
        this.#localCalcToggle(calcPage, gSettings);
        this.#calcGroup(calcPage, gSettings);
        this.#locationGroup(calcPage, gSettings);

        // Tab 3: Online
        const mawaqitPage = new Adw.PreferencesPage({
            title: _("Online"),
            icon_name: "network-wireless-symbolic",
        });
        window.add(mawaqitPage);
        this.#mawaqitGroup(mawaqitPage, gSettings);
    }

    // ─── General Tab ───

    #prayerNamesGroup(page, gSettings) {
        const group = new Adw.PreferencesGroup({
            title: _("Prayer Names"),
        });
        page.add(group);

        const defaultNames = { fajr: "Fajr", duha: "Duha", dhuhr: "Dhuhr", asr: "Asr", maghrib: "Maghrib", isha: "Isha", jummah: "Jummah" };
        const prayerIds = ["fajr", "duha", "dhuhr", "asr", "maghrib", "isha", "jummah"];
        const prayerLabels = {
            fajr: _("Fajr"),
            duha: _("Duha"),
            dhuhr: _("Dhuhr"),
            asr: _("Asr"),
            maghrib: _("Maghrib"),
            isha: _("Isha"),
            jummah: _("Jummah (Friday)"),
        };

        const entries = {};
        let ignoreChanges = false;
        for (const id of prayerIds) {
            const entry = new Adw.EntryRow({
                title: prayerLabels[id],
            });
            group.add(entry);
            entries[id] = entry;
            entry.connect("changed", () => {
                if (ignoreChanges) return;
                const names = {};
                for (const pid of prayerIds) {
                    names[pid] = entries[pid].text || defaultNames[pid];
                }
                gSettings.set_string("prayer-names", JSON.stringify(names));
            });
        }

        gSettings.connect("changed::prayer-names", () => {
            ignoreChanges = true;
            try {
                const names = JSON.parse(gSettings.get_string("prayer-names"));
                for (const id of prayerIds) {
                    entries[id].text = names[id] || defaultNames[id];
                }
            } catch (e) {
                for (const id of prayerIds) {
                    entries[id].text = defaultNames[id];
                }
            }
            ignoreChanges = false;
        });

        // Initial load
        try {
            const names = JSON.parse(gSettings.get_string("prayer-names"));
            ignoreChanges = true;
            for (const id of prayerIds) {
                entries[id].text = names[id] || defaultNames[id];
            }
            ignoreChanges = false;
        } catch (e) {
            // defaults already set
        }
    }

    #displayGroup(page, gSettings) {
        const group = new Adw.PreferencesGroup({
            title: _("Display"),
        });
        page.add(group);

        const displayModes = [
            { id: "countdown", name: _("Countdown") },
            { id: "clock-time", name: _("Prayer time") },
        ];
        const displayMode = new Adw.ComboRow({
            title: _("Display mode"),
            subtitle: _("Show countdown or prayer clock time in the top bar"),
            model: new Gtk.StringList({ strings: displayModes.map((m) => m.name) }),
        });
        group.add(displayMode);

        const showSeconds = new Adw.SwitchRow({
            title: _("Show seconds"),
            subtitle: _("Display seconds in the countdown"),
        });
        group.add(showSeconds);

        const useAmPm = new Adw.SwitchRow({
            title: _("Use AM/PM format"),
            subtitle: _("Override system clock format"),
        });
        group.add(useAmPm);

        let updatingDisplay = false;
        function displayModeGSettingToUi() {
            updatingDisplay = true;
            displayMode.selected = displayModes.findIndex((m) => m.id === gSettings.get_string("display-mode"));
            updatingDisplay = false;
        }
        displayModeGSettingToUi();
        gSettings.connect("changed::display-mode", displayModeGSettingToUi);
        displayMode.connect("notify::selected", () => {
            if (!updatingDisplay) gSettings.set_string("display-mode", displayModes[displayMode.selected].id);
        });

        function updateSecondsSensitivity() {
            showSeconds.sensitive = gSettings.get_string("display-mode") === "countdown";
        }
        updateSecondsSensitivity();
        gSettings.connect("changed::display-mode", updateSecondsSensitivity);

        gSettings.bind("show-seconds", showSeconds, "active", 0);
        gSettings.bind("use-am-pm", useAmPm, "active", 0);
    }

    #notificationGroup(page, gSettings) {
        const group = new Adw.PreferencesGroup({
            title: _("Notifications"),
        });
        page.add(group);

        const notifyPrayer = new Adw.SwitchRow({
            title: _("Send notifications"),
        });
        const soundPlayer = new Adw.SwitchRow({
            title: _("Play a sound for prayers"),
        });
        const reminderTimes = [
            { value: 0, name: _("Off") },
            { value: 5, name: _("5 minutes") },
            { value: 10, name: _("10 minutes") },
            { value: 15, name: _("15 minutes") },
        ];
        const reminderTime = new Adw.ComboRow({
            title: _("Notify before prayer"),
            model: new Gtk.StringList({ strings: reminderTimes.map((r) => r.name) }),
        });

        group.add(notifyPrayer);
        group.add(soundPlayer);
        group.add(reminderTime);
        gSettings.bind("notify-prayer", notifyPrayer, "active", 0);
        gSettings.bind("sound-player", soundPlayer, "active", 0);
        let updatingReminder = false;
        function reminderGSettingToUi() {
            updatingReminder = true;
            reminderTime.selected = reminderTimes.findIndex((object) => object.value === gSettings.get_int("reminder"));
            updatingReminder = false;
        }
        reminderGSettingToUi();
        gSettings.connect("changed::reminder", reminderGSettingToUi);
        reminderTime.connect("notify::selected", () => {
            if (!updatingReminder) gSettings.set_int("reminder", reminderTimes[reminderTime.selected].value);
        });
    }

    // ─── Calculation Tab ───

    #localCalcToggle(page, gSettings) {
        const group = new Adw.PreferencesGroup({
            title: _("Local Calculation"),
        });
        page.add(group);

        const useLocalCalc = new Adw.SwitchRow({
            title: _("Use local calculation"),
            subtitle: _("Calculate prayer times based on your location"),
        });
        group.add(useLocalCalc);
        gSettings.bind("use-local-calc", useLocalCalc, "active", 0);

        this._localCalcToggle = useLocalCalc;
        this._localCalcGroup = group;
    }

    #locationGroup(page, gSettings) {
        const group = new Adw.PreferencesGroup({
            title: _("Location"),
        });
        page.add(group);

        const useLocalCalc = this._localCalcToggle;
        const updateGroupSensitivity = () => {
            group.sensitive = useLocalCalc.active;
        };
        updateGroupSensitivity();
        useLocalCalc.connect("notify::active", updateGroupSensitivity);

        const autoLocation = new Adw.SwitchRow({
            title: _("Automatic"),
        });
        const customLocation = new Adw.ExpanderRow({
            title: _("Custom"),
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

        group.add(autoLocation);
        group.add(customLocation);
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
        const group = new Adw.PreferencesGroup({
            title: _("Calculations"),
        });
        page.add(group);

        const useLocalCalc = this._localCalcToggle;
        const updateCalcSensitivity = () => {
            group.sensitive = useLocalCalc.active;
        };
        updateCalcSensitivity();
        useLocalCalc.connect("notify::active", updateCalcSensitivity);

        const presetMethods = [
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
        const presetMethod = new Adw.ComboRow({
            title: _("Preset methods"),
            model: new Gtk.StringList({ strings: presetMethods.map((a) => a.name) }),
        });
        const customMethod = new Adw.ExpanderRow({
            title: _("Custom methods"),
        });
        const fajrAngle = new Adw.SpinRow({
            title: _("Fajr method"),
            digits: 1,
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 20,
                step_increment: 0.5,
            }),
        });
        const ishaAngle = new Adw.SpinRow({
            title: _("Isha method"),
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

        group.add(presetMethod);
        group.add(customMethod);
        customMethod.add_row(fajrAngle);
        customMethod.add_row(ishaAngle);
        group.add(asrMethod);
        group.add(highLatAdjustment);
        group.add(includeSunnah);

        let updatingFromGSettings = false;

        function presetMethodGSettingToUi() {
            updatingFromGSettings = true;
            presetMethod.selected = presetMethods.findIndex((object) => object.id === gSettings.get_string("preset-methods"));
            updatingFromGSettings = false;
        }
        presetMethodGSettingToUi();
        gSettings.connect("changed::preset-methods", presetMethodGSettingToUi);
        presetMethod.connect("notify::selected", () => {
            if (!updatingFromGSettings) gSettings.set_string("preset-methods", presetMethods[presetMethod.selected].id);
        });
        gSettings.bind("fajr-method", fajrAngle, "value", 0);
        gSettings.bind("isha-method", ishaAngle, "value", 0);
        function asrMethodGSettingToUi() {
            updatingFromGSettings = true;
            asrMethod.selected = asrMethods.findIndex((object) => object.id === gSettings.get_string("asr-method"));
            updatingFromGSettings = false;
        }
        asrMethodGSettingToUi();
        gSettings.connect("changed::asr-method", asrMethodGSettingToUi);
        asrMethod.connect("notify::selected", () => {
            if (!updatingFromGSettings) gSettings.set_string("asr-method", asrMethods[asrMethod.selected].id);
        });
        function highLatAdjustmentGSettingToUi() {
            updatingFromGSettings = true;
            highLatAdjustment.selected = highLatAdjustments.findIndex((object) => object.id === gSettings.get_string("high-latitude-adjustment"));
            updatingFromGSettings = false;
        }
        highLatAdjustmentGSettingToUi();
        gSettings.connect("changed::high-latitude-adjustment", highLatAdjustmentGSettingToUi);
        highLatAdjustment.connect("notify::selected", () => {
            if (!updatingFromGSettings) gSettings.set_string("high-latitude-adjustment", highLatAdjustments[highLatAdjustment.selected].id);
        });
        function updateAngleSensitivity() {
            customMethod.sensitive = presetMethods[presetMethod.selected].id === "custom";
        }
        updateAngleSensitivity();
        presetMethod.connect("notify::selected", updateAngleSensitivity);
        gSettings.bind("include-sunnah", includeSunnah, "active", 0);
    }

    // ─── Online Tab ───

    #mawaqitGroup(page, gSettings) {
        const toggleGroup = new Adw.PreferencesGroup({
            title: _("Online Prayer Times"),
        });
        page.add(toggleGroup);

        const useMawaqit = new Adw.SwitchRow({
            title: _("Use Mawaqit for prayer times"),
            subtitle: _("Choose a mosque to get its daily prayer times from mawaqit.net"),
        });
        toggleGroup.add(useMawaqit);
        gSettings.bind("use-mawaqit", useMawaqit, "active", 0);

        const mosqueGroup = new Adw.PreferencesGroup({
            title: _("Mosque"),
        });
        page.add(mosqueGroup);

        const searchRow = new Adw.EntryRow({
            title: _("Search for a mosque"),
        });
        mosqueGroup.add(searchRow);

        let resultRows = [];

        const myMosqueRow = new Adw.ActionRow({
            title: _("No mosque selected"),
        });
        const refreshButton = new Gtk.Button({
            icon_name: "view-refresh-symbolic",
            valign: Gtk.Align.CENTER,
            tooltip_text: _("Refresh prayer times"),
        });
        myMosqueRow.add_suffix(refreshButton);
        mosqueGroup.add(myMosqueRow);

        const timesGroup = new Adw.PreferencesGroup({
            title: _("Prayer Times"),
        });
        page.add(timesGroup);

        const prayerIds = ["fajr", "dhuhr", "asr", "maghrib", "isha"];
        const prayerLabels = {
            fajr: _("Fajr"),
            dhuhr: _("Dhuhr"),
            asr: _("Asr"),
            maghrib: _("Maghrib"),
            isha: _("Isha"),
        };
        const timeRows = {};
        for (const id of prayerIds) {
            const row = new Adw.ActionRow({
                title: prayerLabels[id],
            });
            const timeLabel = new Gtk.Label({
                label: "--:--",
                valign: Gtk.Align.CENTER,
            });
            timeLabel.add_css_class("heading");
            row.add_suffix(timeLabel);
            timesGroup.add(row);
            timeRows[id] = timeLabel;
        }

         myMosqueRow.visible = false;
         timesGroup.visible = false;

         const controlledGroups = [mosqueGroup, timesGroup];

         function updateSensitivity() {
             const active = useMawaqit.active;
             for (const g of controlledGroups) {
                 g.sensitive = active;
             }
         }
         updateSensitivity();
         useMawaqit.connect("notify::active", updateSensitivity);

         function displayTimes(times) {
             if (!times || times.length < 5) return;
             if (times.length === 6) {
                 timeRows.fajr.label = times[0];
                 timeRows.dhuhr.label = times[2];
                 timeRows.asr.label = times[3];
                 timeRows.maghrib.label = times[4];
                 timeRows.isha.label = times[5];
             } else {
                 timeRows.fajr.label = times[0];
                 timeRows.dhuhr.label = times[1];
                 timeRows.asr.label = times[2];
                 timeRows.maghrib.label = times[3];
                 timeRows.isha.label = times[4];
             }
             timesGroup.visible = true;
         }

         function selectMosque(mosque) {
             gSettings.set_string("mawaqit-slug", mosque.slug);
             gSettings.set_string("mawaqit-label", mosque.label || mosque.name);
             myMosqueRow.title = mosque.label || mosque.name;
             myMosqueRow.subtitle = mosque.localisation || "";
             myMosqueRow.visible = true;
             displayTimes(mosque.times);
             searchRow.text = "";
             clearResults();
         }

         function clearResults() {
             for (const row of resultRows) {
                 mosqueGroup.remove(row);
             }
             resultRows = [];
         }

         const currentSlug = gSettings.get_string("mawaqit-slug");
         const currentLabel = gSettings.get_string("mawaqit-label");
         if (currentSlug) {
             myMosqueRow.title = currentLabel || currentSlug;
             myMosqueRow.visible = true;
             this._fetchMosqueTimes(currentSlug, displayTimes);
         }

         let searchTimeout = null;
         searchRow.connect("changed", () => {
             if (searchTimeout) {
                 GLib.Source.remove(searchTimeout);
             }
             const query = searchRow.text.trim();
             if (query.length < 2) {
                 clearResults();
                 return;
             }
             searchTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                 this._searchMosques(query, mosqueGroup, resultRows, selectMosque);
                 searchTimeout = null;
                 return GLib.SOURCE_REMOVE;
             });
         });

         refreshButton.connect("clicked", () => {
             const slug = gSettings.get_string("mawaqit-slug");
             if (slug) {
                 for (const id of prayerIds) timeRows[id].label = "...";
                 this._fetchMosqueTimes(slug, displayTimes);
             }
         });

         gSettings.connect("changed::mawaqit-slug", () => {
             const slug = gSettings.get_string("mawaqit-slug");
             const label = gSettings.get_string("mawaqit-label");
             if (slug) {
                 myMosqueRow.title = label || slug;
                 myMosqueRow.visible = true;
                 this._fetchMosqueTimes(slug, displayTimes);
             } else {
                 myMosqueRow.visible = false;
                 timesGroup.visible = false;
             }
         });

        // Credits
        const logoPath = this.dir.get_child("assets").get_child("mawaqit-logo.png").get_path();
        const creditsBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 12,
            margin_top: 24,
            margin_bottom: 12,
            halign: Gtk.Align.CENTER,
        });
        const logoPicture = new Gtk.Picture({
            file: Gio.File.new_for_path(logoPath),
            width_request: 42,
            height_request: 64,
            keep_aspect_ratio: true,
            can_shrink: true,
            valign: Gtk.Align.CENTER,
        });
        creditsBox.append(logoPicture);
        const creditsVBox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 2,
            valign: Gtk.Align.CENTER,
            hexpand: true,
            width_request: 300,
        });
        const creditsTitle = new Gtk.Label({
            label: _("Prayer times provided by <a href=\"https://mawaqit.net/fr/\">Mawaqit</a>"),
            use_markup: true,
            xalign: 0,
            halign: Gtk.Align.START,
            wrap: true,
        });
        creditsTitle.add_css_class("heading");
        const creditsSubtitle = new Gtk.Label({
            label: _("Data sourced from the Mawaqit API — Non-commercial use only"),
            xalign: 0,
            halign: Gtk.Align.START,
            wrap: true,
        });
        creditsSubtitle.add_css_class("dim-label");
        creditsSubtitle.add_css_class("caption");
        creditsVBox.append(creditsTitle);
        creditsVBox.append(creditsSubtitle);
        creditsBox.append(creditsVBox);

        const creditsGroup = new Adw.PreferencesGroup({});
        creditsGroup.add(creditsBox);
        page.add(creditsGroup);
    }

    _searchMosques(query, searchGroup, resultRows, onSelect) {
        if (!this._soupSession) this._soupSession = new Soup.Session();
        const encodedQuery = encodeURIComponent(query);
        const uri = `https://mawaqit.net/api/2.0/mosque/search?word=${encodedQuery}&fields=slug,label,localisation,name,times`;
        const message = Soup.Message.new("GET", uri);

        this._soupSession.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (session, result) => {
            try {
                const bytes = session.send_and_read_finish(result);
                if (message.status_code !== Soup.Status.OK) return;

                const data = JSON.parse(new TextDecoder().decode(bytes.get_data()));
                if (!Array.isArray(data) || data.length === 0) return;

                for (const row of resultRows) {
                    searchGroup.remove(row);
                }
                resultRows.length = 0;

                for (const mosque of data.slice(0, 8)) {
                    const row = new Adw.ActionRow({
                        title: mosque.label || mosque.name,
                        subtitle: mosque.localisation || mosque.slug,
                        activatable: true,
                    });
                    row.connect("activated", () => onSelect(mosque));
                    searchGroup.add(row);
                    resultRows.push(row);
                }
            } catch (e) {
                console.error("Mawaqit search error:", e);
            }
        });
    }

    _fetchMosqueTimes(slug, onTimes) {
        if (!this._soupSession) this._soupSession = new Soup.Session();
        const message = Soup.Message.new("GET", `https://mawaqit.net/fr/${slug}`);

        this._soupSession.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (session, result) => {
            try {
                const bytes = session.send_and_read_finish(result);
                if (message.status_code !== Soup.Status.OK) return;

                const html = new TextDecoder().decode(bytes.get_data());
                const times = this._parseConfDataTimes(html);
                if (times) onTimes(times);
            } catch (e) {
                console.error("Mawaqit fetch times error:", e);
            }
        });
    }

    _parseConfDataTimes(html) {
        let startMarker = "var confData = ";
        let startIndex = html.indexOf(startMarker);
        if (startIndex === -1) {
            startMarker = "let confData = ";
            startIndex = html.indexOf(startMarker);
        }
        if (startIndex === -1) return null;

        let braceCount = 0;
        let inString = false;
        let stringChar = null;
        let escapeNext = false;
        const jsonStart = startIndex + startMarker.length;

        for (let i = jsonStart; i < html.length; i++) {
            const char = html[i];
            if (escapeNext) { escapeNext = false; continue; }
            if (char === '\\') { escapeNext = true; continue; }
            if (!inString && (char === '"' || char === "'")) { inString = true; stringChar = char; continue; }
            if (inString && char === stringChar) { inString = false; stringChar = null; continue; }
            if (!inString) {
                if (char === '{') braceCount++;
                else if (char === '}') braceCount--;
                if (braceCount === 0 && i > jsonStart) {
                    const jsonStr = html.substring(jsonStart, i + 1);
                    try {
                        const confData = JSON.parse(jsonStr);
                        return confData.times || null;
                    } catch (e) {
                        return null;
                    }
                }
            }
        }
        return null;
    }
}
