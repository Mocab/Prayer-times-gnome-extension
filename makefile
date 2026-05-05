PACK_NAME=prayertimes@mocab.shell-extension
EXT_DIR=~/.local/share/gnome-shell/extensions/prayertimes@mocab
SRC=src

.PHONY: all pack install clean dev

all: pack

$(PACK_NAME).zip:
	@echo "Creating & packing $(PACK_NAME).zip"
	@gnome-extensions pack $(SRC) \
	    --force \
	    --podir="../po" \
	    --extra-source="setting-manager.js" \
	    --extra-source="calc-prayer-times.js" \
	    --extra-source="mawaqit-client.js" \
	    --extra-source="assets" \
	    --extra-source="../CHANGELOG.md"
	@unzip -o $(PACK_NAME).zip -d /tmp/$(PACK_NAME)-extract/
	@cp $(SRC)/schemas/gschemas.compiled /tmp/$(PACK_NAME)-extract/schemas/
	@cd /tmp/$(PACK_NAME)-extract/ && zip -r $(PWD)/$(PACK_NAME).zip .
	@rm -rf /tmp/$(PACK_NAME)-extract/

pack: clean $(PACK_NAME).zip

install:
	@echo "Compiling schemas..."
	@glib-compile-schemas $(SRC)/schemas/
	@echo "Installing to $(EXT_DIR)"
	@rm -rf $(EXT_DIR)
	@mkdir -p $(EXT_DIR)
	@cp -r $(SRC)/* $(EXT_DIR)/
	@rm -rf ~/.local/share/gnome-shell/extension-updates/prayertimes@mocab/
	@echo "Done. Restart GNOME Shell (Alt+F2 → r) to apply."

clean:
	@echo "Deleting $(PACK_NAME).zip"
	@rm -rf $(PACK_NAME).zip

dev: clean install
	dbus-run-session -- gnome-shell --nested --wayland
