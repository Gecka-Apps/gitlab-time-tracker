import GObject from 'gi://GObject';
import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {IssueSelectorDialog} from './issueSelector.js';
import {ReportDialog} from './reportDialog.js';

const GitLabIssuesIndicator = GObject.registerClass(
class GitLabIssuesIndicator extends PanelMenu.Button {
    _init(settings, path, gettext) {
        super._init(0.0, 'GitLab Issues Timer');

        this._ = gettext;

        this._settings = settings;
        this._httpSession = new Soup.Session();
        this._extensionPath = path;

        // Timer state
        this._timerRunning = false;
        this._timerPaused = false;
        this._elapsedSeconds = 0;
        this._timerId = null;
        this._selectedProject = null;
        this._selectedIssue = null;

        // Create icon
        this._icon = new St.Icon({
            style_class: 'system-status-icon',
        });
        this._updateIcon();
        this.add_child(this._icon);

        // Build menu
        this._buildMenu();
    }

    _getIconGicon(iconName) {
        const iconPath = `${this._extensionPath}/icons/${iconName}`;
        const file = Gio.File.new_for_path(iconPath);
        return new Gio.FileIcon({ file });
    }

    _validateSettings() {
        const url = this._settings.get_string('gitlab-url');
        const token = this._settings.get_string('gitlab-token');

        if (!url || !token) {
            Main.notify(this._('GitLab Issues Timer'), this._('Please configure the server URL and token in preferences'));
            return false;
        }
        return true;
    }

    _buildMenu() {
        // Project/Issue selection button
        let selectButton = new PopupMenu.PopupMenuItem(this._('Select project & issue'));
        selectButton.connect('activate', () => {
            this._openIssueSelector();
        });
        this.menu.addMenuItem(selectButton);

        // Current selection display
        this._projectLabel = new PopupMenu.PopupMenuItem(this._('Project: None'), {reactive: false});
        this.menu.addMenuItem(this._projectLabel);

        this._issueLabel = new PopupMenu.PopupMenuItem(this._('Issue: None'), {reactive: false});
        this.menu.addMenuItem(this._issueLabel);

        // Open links buttons
        this._openProjectButton = new PopupMenu.PopupMenuItem(this._('Open project in browser'));
        this._openProjectButton.connect('activate', () => this._openProjectInBrowser());
        this._openProjectButton.visible = false;
        this.menu.addMenuItem(this._openProjectButton);

        this._openIssueButton = new PopupMenu.PopupMenuItem(this._('Open issue in browser'));
        this._openIssueButton.connect('activate', () => this._openIssueInBrowser());
        this._openIssueButton.visible = false;
        this.menu.addMenuItem(this._openIssueButton);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Timer display
        this._timerLabel = new PopupMenu.PopupMenuItem('00:00:00', {reactive: false});
        this._timerLabel.label.set_style('font-size: 18px; font-weight: bold;');
        this.menu.addMenuItem(this._timerLabel);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Control buttons
        this._startButton = new PopupMenu.PopupMenuItem(this._('Start'));
        this._startButton.connect('activate', () => this._startTimer());
        this.menu.addMenuItem(this._startButton);

        this._pauseButton = new PopupMenu.PopupMenuItem(this._('Pause'));
        this._pauseButton.connect('activate', () => this._pauseTimer());
        this._pauseButton.visible = false;
        this.menu.addMenuItem(this._pauseButton);

        this._stopButton = new PopupMenu.PopupMenuItem(this._('Stop & Send'));
        this._stopButton.connect('activate', () => this._stopTimer());
        this._stopButton.visible = false;
        this.menu.addMenuItem(this._stopButton);

        this._cancelButton = new PopupMenu.PopupMenuItem(this._('Cancel'));
        this._cancelButton.connect('activate', () => this._cancelTimer());
        this._cancelButton.visible = false;
        this.menu.addMenuItem(this._cancelButton);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Report button
        let reportItem = new PopupMenu.PopupMenuItem(this._('Monthly Report'));
        reportItem.connect('activate', () => {
            this._openReport();
        });
        this.menu.addMenuItem(reportItem);

        // Settings button
        let settingsItem = new PopupMenu.PopupMenuItem(this._('Settings'));
        settingsItem.connect('activate', () => {
            this._openPreferences();
        });
        this.menu.addMenuItem(settingsItem);
    }

    _openIssueSelector() {
        log('GitLab Timer: Opening issue selector...');
        if (!this._validateSettings()) {
            log('GitLab Timer: Settings validation failed');
            return;
        }

        try {
            log('GitLab Timer: Creating IssueSelectorDialog...');
            let dialog = new IssueSelectorDialog(this._settings, this._, (project, issue) => {
                this._selectedProject = project;
                this._selectedIssue = issue;
                this._projectLabel.label.text = `${this._('Project')}: ${project.path_with_namespace}`;
                this._issueLabel.label.text = `${this._('Issue')}: #${issue.iid} - ${issue.title.substring(0, 40)}...`;

                // Show the browser open buttons
                this._openProjectButton.visible = true;
                this._openIssueButton.visible = true;
            });

            log('GitLab Timer: Opening dialog...');
            dialog.open();
            log('GitLab Timer: Dialog opened successfully');
        } catch (e) {
            log('GitLab Timer: Error opening issue selector: ' + e.message);
            log('Stack trace: ' + e.stack);
            Main.notify(this._('Error'), this._('Unable to open selector') + ': ' + e.message);
        }
    }

    _openProjectInBrowser() {
        if (!this._selectedProject) {
            Main.notify(this._('GitLab Issues Timer'), this._('No project selected'));
            return;
        }

        // Use the web_url from the GitLab API response
        const projectUrl = this._selectedProject.web_url;

        if (!projectUrl) {
            Main.notify(this._('Error'), this._('Project URL not available'));
            log('GitLab Timer: Project web_url is missing');
            return;
        }

        try {
            // Detect the scheme from the URL (http or https)
            const scheme = projectUrl.startsWith('https://') ? 'https' : 'http';
            const launcher = Gio.AppInfo.get_default_for_uri_scheme(scheme);
            if (launcher) {
                launcher.launch_uris([projectUrl], null);
            } else {
                // Fallback: use xdg-open
                GLib.spawn_command_line_async(`xdg-open "${projectUrl}"`);
            }
        } catch (e) {
            Main.notify(this._('Error'), this._('Unable to open browser') + ': ' + e.message);
            log('GitLab Timer: Error opening project URL:', e.message);
        }
    }

    _openIssueInBrowser() {
        if (!this._selectedProject || !this._selectedIssue) {
            Main.notify(this._('GitLab Issues Timer'), this._('No issue selected'));
            return;
        }

        // Use the web_url from the GitLab API response
        const issueUrl = this._selectedIssue.web_url;

        if (!issueUrl) {
            Main.notify(this._('Error'), this._('Issue URL not available'));
            log('GitLab Timer: Issue web_url is missing');
            return;
        }

        try {
            // Detect the scheme from the URL (http or https)
            const scheme = issueUrl.startsWith('https://') ? 'https' : 'http';
            const launcher = Gio.AppInfo.get_default_for_uri_scheme(scheme);
            if (launcher) {
                launcher.launch_uris([issueUrl], null);
            } else {
                // Fallback: use xdg-open
                GLib.spawn_command_line_async(`xdg-open "${issueUrl}"`);
            }
        } catch (e) {
            Main.notify(this._('Error'), this._('Unable to open browser') + ': ' + e.message);
            log('GitLab Timer: Error opening issue URL:', e.message);
        }
    }

    _startTimer() {
        if (!this._selectedProject || !this._selectedIssue) {
            Main.notify(this._('GitLab Issues Timer'), this._('Please select a project and an issue'));
            return;
        }

        this._timerRunning = true;
        this._timerPaused = false;

        this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
            if (!this._timerPaused) {
                this._elapsedSeconds++;
                this._updateTimerDisplay();
            }
            return GLib.SOURCE_CONTINUE;
        });

        this._updateButtonVisibility();
        this._updateIcon();
    }

    _pauseTimer() {
        if (this._timerPaused) {
            this._timerPaused = false;
            this._pauseButton.label.text = this._('Pause');
        } else {
            this._timerPaused = true;
            this._pauseButton.label.text = this._('Resume');
        }
        this._updateIcon();
    }

    _stopTimer() {
        if (!this._timerRunning) return;

        // Send time to GitLab
        this._sendTimeToGitLab();

        // Reset timer
        this._resetTimer();
    }

    _cancelTimer() {
        this._resetTimer();
        Main.notify(this._('GitLab Issues Timer'), this._('Timer cancelled'));
    }

    _resetTimer() {
        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = null;
        }

        this._timerRunning = false;
        this._timerPaused = false;
        this._elapsedSeconds = 0;
        this._updateTimerDisplay();
        this._updateButtonVisibility();
        this._updateIcon();
    }

    _updateTimerDisplay() {
        const hours = Math.floor(this._elapsedSeconds / 3600);
        const minutes = Math.floor((this._elapsedSeconds % 3600) / 60);
        const seconds = this._elapsedSeconds % 60;

        const timeString = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        this._timerLabel.label.text = timeString;
    }

    _updateButtonVisibility() {
        this._startButton.visible = !this._timerRunning;
        this._pauseButton.visible = this._timerRunning;
        this._stopButton.visible = this._timerRunning;
        this._cancelButton.visible = this._timerRunning;
    }

    _updateIcon() {
        if (!this._timerRunning) {
            // Timer stopped - show stop icon
            this._icon.gicon = this._getIconGicon('timer-outline-symbolic.svg');
        } else if (this._timerPaused) {
            // Timer paused - show pause icon
            this._icon.gicon = this._getIconGicon('timer-pause-outline-symbolic.svg');
        } else {
            // Timer running - show play/recording icon
            this._icon.gicon = this._getIconGicon('timer-play-outline-symbolic.svg');
        }
    }

    _sendTimeToGitLab() {
        const url = this._settings.get_string('gitlab-url');
        const token = this._settings.get_string('gitlab-token');

        // Convert seconds to GitLab format (hours and minutes)
        const hours = Math.floor(this._elapsedSeconds / 3600);
        const minutes = Math.floor((this._elapsedSeconds % 3600) / 60);

        let duration = '';
        if (hours > 0) duration += `${hours}h`;
        if (minutes > 0) duration += `${minutes}m`;
        if (duration === '') duration = '1m'; // Minimum 1 minute

        const apiUrl = `${url}/api/v4/projects/${this._selectedProject.id}/issues/${this._selectedIssue.iid}/add_spent_time?duration=${duration}`;

        const message = Soup.Message.new('POST', apiUrl);
        message.request_headers.append('PRIVATE-TOKEN', token);

        this._httpSession.send_and_read_async(
            message,
            GLib.PRIORITY_DEFAULT,
            null,
            (session, result) => {
                try {
                    if (message.status_code === 201 || message.status_code === 200) {
                        Main.notify(this._('GitLab Issues Timer'), `${this._('Time sent')}: ${duration} ${this._('on issue')} #${this._selectedIssue.iid}`);
                    } else {
                        Main.notify(this._('Error'), `${this._('Unable to send time')}: ${message.status_code}`);
                    }
                } catch (e) {
                    Main.notify(this._('Error'), `${this._('Error sending time')}: ${e.message}`);
                }
            }
        );
    }

    _openReport() {
        log('GitLab Timer: Opening report dialog...');
        if (!this._validateSettings()) {
            log('GitLab Timer: Settings validation failed');
            return;
        }

        try {
            // Pass the currently selected project if available
            let dialog = new ReportDialog(this._settings, this._, this._selectedProject);
            dialog.open();
            log('GitLab Timer: Report dialog opened successfully');
        } catch (e) {
            log('GitLab Timer: Error opening report dialog: ' + e.message);
            log('Stack trace: ' + e.stack);
            Main.notify(this._('Error'), this._('Unable to open report') + ': ' + e.message);
        }
    }

    _openPreferences() {
        try {
            const extensionManager = Main.extensionManager;
            const extension = extensionManager.lookup('gitlab-time-tracker@gecka.nc');
            if (extension) {
                extensionManager.openExtensionPrefs(extension.uuid, '', {});
            } else {
                Main.notify(this._('Error'), this._('Extension not found'));
                log('GitLab Timer: Extension not found');
            }
        } catch (e) {
            Main.notify(this._('Error'), this._('Unable to open preferences') + ': ' + e.message);
            log('GitLab Timer: Error opening preferences:', e.message);
            log('GitLab Timer: Stack:', e.stack);
        }
    }

    destroy() {
        if (this._timerId) {
            GLib.source_remove(this._timerId);
        }
        super.destroy();
    }
});

export default class GitLabIssuesExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._indicator = new GitLabIssuesIndicator(this._settings, this.path, this.gettext.bind(this));
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
        this._settings = null;
    }
}
