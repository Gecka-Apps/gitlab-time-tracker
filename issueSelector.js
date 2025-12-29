import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {AvatarLoader} from './avatarLoader.js';

export const IssueSelectorDialog = GObject.registerClass(
class IssueSelectorDialog extends ModalDialog.ModalDialog {
    _init(settings, gettext, httpSession, onSelected) {
        super._init({ styleClass: 'gitlab-issue-selector-dialog' });

        this._settings = settings;
        this._ = gettext;
        this._onSelected = onSelected;
        this._httpSession = httpSession;
        this._avatarLoader = new AvatarLoader(settings, this._httpSession);
        this._projects = [];
        this._allIssues = [];
        this._selectedProject = null;

        this._buildUI();
        this._loadProjects();
    }

    _buildUI() {
        // Main container
        let content = new St.BoxLayout({
            vertical: true,
            style_class: 'gitlab-selector-content',
            style: 'min-width: 600px; min-height: 500px;'
        });

        // Title
        let title = new St.Label({
            text: this._('Select a project and an issue'),
            style_class: 'gitlab-selector-title',
            style: 'font-size: 16px; font-weight: bold; margin-bottom: 10px;'
        });
        content.add_child(title);

        // Project section
        let projectBox = new St.BoxLayout({
            vertical: true,
            style: 'margin-bottom: 20px;'
        });

        let projectLabel = new St.Label({
            text: this._('Project'),
            style: 'font-weight: bold; margin-bottom: 5px;'
        });
        projectBox.add_child(projectLabel);

        // Project search
        this._projectSearchEntry = new St.Entry({
            hint_text: this._('Search project...'),
            can_focus: true,
            track_hover: true,
            style: 'margin-bottom: 5px;'
        });
        this._projectSearchEntry.clutter_text.connect('text-changed', () => {
            this._filterProjects();
        });
        projectBox.add_child(this._projectSearchEntry);

        // Project list container with scrolling
        let projectScrollView = new St.ScrollView({
            style: 'border: 1px solid #555; border-radius: 5px; height: 180px;',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC
        });

        this._projectList = new St.BoxLayout({
            vertical: true,
            style_class: 'gitlab-project-list'
        });
        projectScrollView.add_child(this._projectList);
        projectBox.add_child(projectScrollView);

        content.add_child(projectBox);

        // Issue section
        let issueBox = new St.BoxLayout({
            vertical: true,
            style: 'margin-bottom: 20px;'
        });

        let issueLabel = new St.Label({
            text: this._('Issue'),
            style: 'font-weight: bold; margin-bottom: 5px;'
        });
        issueBox.add_child(issueLabel);

        // Issue search
        this._issueSearchEntry = new St.Entry({
            hint_text: this._('Search issue...'),
            can_focus: true,
            track_hover: true,
            style: 'margin-bottom: 5px;'
        });
        this._issueSearchEntry.clutter_text.connect('text-changed', () => {
            this._filterIssues();
        });
        issueBox.add_child(this._issueSearchEntry);

        // Issue list container with scrolling
        let issueScrollView = new St.ScrollView({
            style: 'border: 1px solid #555; border-radius: 5px; height: 180px;',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC
        });

        this._issueList = new St.BoxLayout({
            vertical: true,
            style_class: 'gitlab-issue-list'
        });
        issueScrollView.add_child(this._issueList);
        issueBox.add_child(issueScrollView);

        content.add_child(issueBox);

        // Loading indicator
        this._loadingLabel = new St.Label({
            text: this._('Loading...'),
            style: 'font-style: italic; color: #999;'
        });
        content.add_child(this._loadingLabel);

        this.contentLayout.add_child(content);

        // Buttons
        this.setButtons([
            {
                label: this._('Cancel'),
                action: () => this.close(),
                key: Clutter.KEY_Escape
            },
            {
                label: this._('Select'),
                action: () => this._onSelect(),
                default: true
            }
        ]);

        this._selectedProjectWidget = null;
        this._selectedIssueWidget = null;
    }

    _loadProjects() {
        this._showLoading(this._('Loading projects...'));

        const url = this._settings.get_string('gitlab-url');
        const token = this._settings.get_string('gitlab-token');

        const apiUrl = `${url}/api/v4/projects?membership=true&per_page=100&order_by=last_activity_at`;

        const message = Soup.Message.new('GET', apiUrl);
        message.request_headers.append('PRIVATE-TOKEN', token);

        this._httpSession.send_and_read_async(
            message,
            GLib.PRIORITY_DEFAULT,
            null,
            (session, result) => {
                try {
                    const bytes = session.send_and_read_finish(result);
                    const decoder = new TextDecoder('utf-8');
                    const response = decoder.decode(bytes.get_data());

                    if (message.status_code === 200) {
                        this._projects = JSON.parse(response);
                        this._updateProjectList();
                        this._hideLoading();
                    } else {
                        this._showLoading(`${this._('Error')}: ${message.status_code}`);
                    }
                } catch (e) {
                    this._showLoading(`${this._('Error')}: ${e.message}`);
                }
            }
        );
    }

    _updateProjectList() {
        this._projectList.destroy_all_children();

        const searchText = this._projectSearchEntry.get_text().toLowerCase();
        let filteredProjects = searchText
            ? this._projects.filter(p => p.name.toLowerCase().includes(searchText) ||
                                         p.path_with_namespace.toLowerCase().includes(searchText))
            : this._projects;

        filteredProjects = filteredProjects.sort((a, b) =>
            a.path_with_namespace.localeCompare(b.path_with_namespace)
        );

        for (let project of filteredProjects) {
            let item = new St.Button({
                style_class: 'gitlab-list-item',
                style: 'padding: 8px; border-radius: 3px;',
                can_focus: true,
                track_hover: true,
                x_expand: true,
                x_align: Clutter.ActorAlign.FILL
            });

            // Create horizontal box for icon + text
            let box = new St.BoxLayout({
                vertical: false,
                x_align: Clutter.ActorAlign.START,
                x_expand: true,
                style: 'spacing: 8px;'
            });

            // Add project/group icon
            let icon = new St.Icon({
                icon_name: 'folder-symbolic',
                icon_size: 24,
                style: 'width: 24px; height: 24px; border-radius: 3px;'
            });

            // Load project avatar using shared loader
            const namespace = project.namespace || null;
            this._avatarLoader.loadProjectAvatar(project.id, namespace, icon);

            box.add_child(icon);

            let label = new St.Label({
                text: project.path_with_namespace,
                style: 'font-size: 12px;',
                y_align: Clutter.ActorAlign.CENTER
            });
            box.add_child(label);

            item.set_child(box);

            item.connect('clicked', () => {
                this._selectProject(project, item);
            });

            this._projectList.add_child(item);
        }
    }

    _selectProject(project, widget) {
        this._selectedProject = project;

        // Highlight selected project
        if (this._selectedProjectWidget) {
            this._selectedProjectWidget.style = 'padding: 8px; border-radius: 3px;';
        }
        this._selectedProjectWidget = widget;
        widget.style = 'padding: 8px; border-radius: 3px; background-color: #4a90d9;';

        // Load issues for this project
        this._loadIssues(project.id);
    }

    _loadIssues(projectId) {
        this._showLoading(this._('Loading issues...'));

        const url = this._settings.get_string('gitlab-url');
        const token = this._settings.get_string('gitlab-token');

        const apiUrl = `${url}/api/v4/projects/${projectId}/issues?state=opened&per_page=100`;

        const message = Soup.Message.new('GET', apiUrl);
        message.request_headers.append('PRIVATE-TOKEN', token);

        this._httpSession.send_and_read_async(
            message,
            GLib.PRIORITY_DEFAULT,
            null,
            (session, result) => {
                try {
                    const bytes = session.send_and_read_finish(result);
                    const decoder = new TextDecoder('utf-8');
                    const response = decoder.decode(bytes.get_data());

                    if (message.status_code === 200) {
                        this._allIssues = JSON.parse(response);
                        this._updateIssueList();
                        this._hideLoading();
                    } else {
                        this._showLoading(`${this._('Error')}: ${message.status_code}`);
                    }
                } catch (e) {
                    this._showLoading(`${this._('Error')}: ${e.message}`);
                }
            }
        );
    }

    _updateIssueList() {
        this._issueList.destroy_all_children();

        const searchText = this._issueSearchEntry.get_text().toLowerCase();
        const filteredIssues = searchText
            ? this._allIssues.filter(i =>
                i.title.toLowerCase().includes(searchText) ||
                i.iid.toString().includes(searchText))
            : this._allIssues;

        for (let issue of filteredIssues) {
            let item = new St.Button({
                style_class: 'gitlab-list-item',
                style: 'padding: 8px; border-radius: 3px;',
                can_focus: true,
                track_hover: true,
                x_expand: true,
                x_align: Clutter.ActorAlign.FILL
            });

            let label = new St.Label({
                text: `#${issue.iid} - ${issue.title}`,
                style: 'font-size: 12px;',
                x_align: Clutter.ActorAlign.START,
                x_expand: true
            });
            item.set_child(label);

            item.connect('clicked', () => {
                this._selectIssue(issue, item);
            });

            this._issueList.add_child(item);
        }

        if (filteredIssues.length === 0) {
            let emptyLabel = new St.Label({
                text: this._('No issues found'),
                style: 'padding: 20px; font-style: italic; color: #999;'
            });
            this._issueList.add_child(emptyLabel);
        }
    }

    _selectIssue(issue, widget) {
        this._selectedIssue = issue;

        // Highlight selected issue
        if (this._selectedIssueWidget) {
            this._selectedIssueWidget.style = 'padding: 8px; border-radius: 3px;';
        }
        this._selectedIssueWidget = widget;
        widget.style = 'padding: 8px; border-radius: 3px; background-color: #4a90d9;';
    }

    _filterProjects() {
        this._updateProjectList();
    }

    _filterIssues() {
        this._updateIssueList();
    }

    _showLoading(text) {
        this._loadingLabel.text = text;
        this._loadingLabel.show();
    }

    _hideLoading() {
        this._loadingLabel.hide();
    }

    _onSelect() {
        if (!this._selectedProject || !this._selectedIssue) {
            Main.notify(this._('GitLab Time Tracking'), this._('Please select a project and an issue'));
            return;
        }

        this._onSelected(this._selectedProject, this._selectedIssue);
        this.close();
    }
});
