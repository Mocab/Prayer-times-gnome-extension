PACK_NAME    := prayertimes@mocab.shell-extension
EXT_DIR      := $(HOME)/.local/share/gnome-shell/extensions/$(PACK_NAME)
SRC          := src

.PHONY: all pack install clean dev

all: pack

$(PACK_NAME).zip:
	@echo "Creating & packing $(PACK_NAME).zip"
	@gnome-extensions pack $(SRC) \
	    --force \
	    --podir="../po" \
	    --extra-source="../CHANGELOG.md" \
		$(foreach item,$(shell ls $(SRC)),--extra-source="$(item)")

pack: clean $(PACK_NAME).zip

install:
	@echo "Installing to $(EXT_DIR)"
	@mkdir -p $(EXT_DIR)
	@rm -rf $(EXT_DIR)/*
	@cp -r $(SRC)/* $(EXT_DIR)/
	@echo "Compiling schemas..."
	@glib-compile-schemas $(EXT_DIR)/schemas/
	@echo "Done. Restart GNOME Shell (log out and back in) to apply."

clean:
	@echo "Deleting $(PACK_NAME).zip"
	@rm -f $(PACK_NAME).zip

dev: install
	dbus-run-session gnome-shell --devkit --wayland