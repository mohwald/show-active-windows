//    Show Active Windows
//    GNOME Shell extension
//    Simple window icons display for current workspace

import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const ICON_SIZE = 22;

const WindowButton = GObject.registerClass(
    class WindowButton extends St.Button {
        _init(window) {
            super._init({
                style_class: 'window-button',
                reactive: true,
                can_focus: true,
                track_hover: true
            });

            this._window = window;
            this._app = Shell.WindowTracker.get_default().get_window_app(this._window);

            this._createIcon();
            this._updateAppearance();
            this._signalHandlerIds = [];
            this._connectSignals();

            // Try to refresh icon after a short delay, in case app mapping appears later
            this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                let app = Shell.WindowTracker.get_default().get_window_app(this._window);
                if (app && app !== this._app) {
                    this._app = app;
                    this._updateIcon();
                }
                this._timeoutId = null;
                return GLib.SOURCE_REMOVE;
            });
        }

        _createIcon() {
            this._icon = new St.Icon({
                icon_size: ICON_SIZE,
                style_class: 'window-icon'
            });
            this.set_child(this._icon);
            this._updateIcon();
        }

        _updateIcon() {
            // Improved icon logic: only set gicon or icon_name if valid, always provide fallback
            if (this._app) {
                let gicon = this._app.get_icon();
                if (gicon) {
                    this._icon.set_gicon(gicon);
                    return;
                }
            }
            // Try WM_CLASS as icon name
            let wmClass = this._window.get_wm_class();
            if (wmClass && wmClass.trim() !== "") {
                this._icon.set_gicon(null); // Switch to icon_name mode
                this._icon.set_icon_name(wmClass.toLowerCase());
                return;
            }
            // Fallback
            this._icon.set_gicon(null);
            this._icon.set_icon_name('application-x-executable');
        }

        _connectSignals() {
            this._signalHandlerIds = [];
            this._signalHandlerIds.push(
                this.connect('clicked', () => this._onClicked())
            );
            this._signalHandlerIds.push(
                this._window.connect('notify::appears-focused', () => this._updateAppearance())
            );
            this._signalHandlerIds.push(
                this._window.connect('unmanaging', () => this._onWindowUnmanaging())
            );
            // Listen for changes in WM_CLASS and TITLE to refresh icon
            this._signalHandlerIds.push(
                this._window.connect('notify::wm-class', () => this._updateIcon())
            );
            this._signalHandlerIds.push(
                this._window.connect('notify::title', () => this._updateIcon())
            );
        }

        _onClicked() {
            if (this._window.has_focus()) {
                if (this._window.can_minimize()) {
                    this._window.minimize();
                }
            } else {
                this._window.activate(global.get_current_time());
            }
        }

        _updateAppearance() {
            this._updateIcon();
            if (this._window.appears_focused) {
                this.add_style_class_name('focused');
                this.remove_style_class_name('unfocused');
            } else {
                this.add_style_class_name('unfocused');
                this.remove_style_class_name('focused');
            }
        }

        _onWindowUnmanaging() {
            this.destroy();
        }

        destroy() {
            if (this._timeoutId) {
                GLib.Source.remove(this._timeoutId);
                this._timeoutId = null;
            }

            if (this._window && this._signalHandlerIds) {
                this._signalHandlerIds.forEach(handlerId => {
                    try { this._window.disconnect(handlerId); } catch (e) {}
                });
                this._signalHandlerIds = [];
            }
            super.destroy();
        }


    }
);

const WindowIcons = GObject.registerClass(
    class WindowIcons extends GObject.Object {
        _init() {
            super._init();
            this._windowButtons = new Map();
            this._box = new St.BoxLayout({
                style_class: 'window-icons-box'
            });

            // Store references to global objects
            this._display = global.display;
            this._workspaceManager = global.workspace_manager;

            // Add the box to the left side of the panel
            Main.panel._leftBox.insert_child_at_index(this._box, 1);

            this._signalHandlers = [];
            this._updateWindowList();
            this._connectSignals();
        }

        _connectSignals() {
            // Listen for new windows
            this._signalHandlers.push(
                this._display.connect('window-created', (display, window) => {
                    this._addWindow(window);
                })
            );

            // Listen for workspace changes
            this._signalHandlers.push(
                this._workspaceManager.connect('active-workspace-changed', () => {
                    this._updateWindowList();
                })
            );

            // Listen for window focus changes
            this._signalHandlers.push(
                this._display.connect('notify::focus-window', () => {
                    this._updateAllButtons();
                })
            );
        }

        _shouldShowWindow(window) {
            if (!window || window.is_skip_taskbar()) {
                return false;
            }

            let windowType = window.get_window_type();
            if (windowType === Meta.WindowType.DESKTOP ||
                windowType === Meta.WindowType.DOCK ||
                windowType === Meta.WindowType.MODAL_DIALOG) {
                return false;
            }

            let activeWorkspace = this._workspaceManager.get_active_workspace();
            return window.located_on_workspace(activeWorkspace);
        }

        _addWindow(window) {
            if (!this._shouldShowWindow(window)) {
                return;
            }

            if (this._windowButtons.has(window)) {
                return;
            }

            let button = new WindowButton(window);
            this._windowButtons.set(window, button);
            this._box.add_child(button);

            // Connect to workspace-changed to handle window moving between workspaces
            let handlerId = window.connect('workspace-changed', () => {
                if (this._shouldShowWindow(window)) {
                    if (!this._windowButtons.has(window)) {
                        this._addWindow(window);
                    }
                } else {
                    this._removeWindow(window);
                }
            });
            button._workspaceChangedHandlerId = handlerId;
        }

        _removeWindow(window) {
            let button = this._windowButtons.get(window);
            if (button) {
                if (button._workspaceChangedHandlerId) {
                    window.disconnect(button._workspaceChangedHandlerId);
                }
                button.destroy();
                this._windowButtons.delete(window);
            }
        }

        _updateWindowList() {
            // Clear existing buttons
            this._windowButtons.forEach((button, window) => {
                if (button._workspaceChangedHandlerId) {
                    window.disconnect(button._workspaceChangedHandlerId);
                }
                button.destroy();
            });
            this._windowButtons.clear();

            // Get windows from active workspace
            let activeWorkspace = this._workspaceManager.get_active_workspace();
            let windows = activeWorkspace.list_windows();

            windows.forEach(window => {
                this._addWindow(window);
            });
        }

        _updateAllButtons() {
            this._windowButtons.forEach((button) => {
                button._updateAppearance();
            });
        }

        destroy() {
            // Destroy all window buttons and disconnect per-window signals
            this._windowButtons.forEach((button, window) => {
                if (button._workspaceChangedHandlerId) {
                    window.disconnect(button._workspaceChangedHandlerId);
                }
                button.destroy();
            });
            this._windowButtons.clear();

            // Remove the icon box from the panel if it exists
            if (this._box && Main.panel._leftBox.get_children().includes(this._box)) {
                Main.panel._leftBox.remove_child(this._box);
                this._box.destroy();
                this._box = null;
            }

            // Disconnect only our signals
            this._signalHandlers.forEach(handlerId => {
                if (handlerId) {
                    try { this._display.disconnect(handlerId); } catch (e) {}
                    try { this._workspaceManager.disconnect(handlerId); } catch (e) {}
                }
            });
            this._signalHandlers = [];
        }
    }
);

export default class ShowActiveWindowsExtension {
    enable() {
        this._windowIcons = new WindowIcons();
    }

    disable() {
        if (this._windowIcons) {
            this._windowIcons.destroy();
            this._windowIcons = null;
        }
    }
}
