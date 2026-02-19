import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Animation from 'resource:///org/gnome/shell/ui/animation.js';

import {AvatarLoader} from './avatarLoader.js';

export const IssueSelectorDialog = GObject.registerClass(
class IssueSelectorDialog extends ModalDialog.ModalDialog {
    _init(settings, gettext, currentProject, currentIssue, onSelected) {
        super._init({ styleClass: 'gitlab-issue-selector-dialog' });

        this._settings = settings;
        this._ = gettext;
        this._onSelected = onSelected;
        this._preselectedProject = currentProject;
        this._preselectedIssue = currentIssue;
        this._httpSession = new Soup.Session();
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

        // Project list container with overlay support
        let projectContainer = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            style_class: 'popup-menu-content gitlab-list-container',
            x_expand: true,
            clip_to_allocation: true
        });

        let projectScrollView = new St.ScrollView({
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            x_expand: true,
            y_expand: true
        });

        this._projectList = new St.BoxLayout({
            vertical: true,
            style_class: 'gitlab-project-list'
        });
        projectScrollView.add_child(this._projectList);
        projectContainer.add_child(projectScrollView);

        this._projectLoadingOverlay = this._createLoadingOverlay();
        projectContainer.add_child(this._projectLoadingOverlay);

        projectBox.add_child(projectContainer);

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

        // Issue list container with overlay support
        let issueContainer = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            style_class: 'popup-menu-content gitlab-list-container',
            x_expand: true,
            clip_to_allocation: true
        });

        let issueScrollView = new St.ScrollView({
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            x_expand: true,
            y_expand: true
        });

        this._issueList = new St.BoxLayout({
            vertical: true,
            style_class: 'gitlab-issue-list'
        });
        issueScrollView.add_child(this._issueList);
        issueContainer.add_child(issueScrollView);

        this._issueLoadingOverlay = this._createLoadingOverlay();
        issueContainer.add_child(this._issueLoadingOverlay);

        issueBox.add_child(issueContainer);

        content.add_child(issueBox);

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

    _apiGet(path, overlay, loadingText, onSuccess) {
        this._showOverlay(overlay, loadingText);

        const url = this._settings.get_string('gitlab-url');
        const token = this._settings.get_string('gitlab-token');

        const message = Soup.Message.new('GET', `${url}/api/v4${path}`);
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
                        onSuccess(JSON.parse(response));
                        this._hideOverlay(overlay);
                    } else if (message.status_code === 401 || message.status_code === 403) {
                        this._showOverlay(overlay, this._('Please configure the server URL and token in preferences'));
                    } else {
                        this._showOverlay(overlay, `${this._('Error')}: ${message.status_code}`);
                    }
                } catch (e) {
                    this._showOverlay(overlay, `${this._('Error')}: ${e.message}`);
                }
            }
        );
    }

    _loadProjects() {
        this._apiGet(
            '/projects?membership=true&per_page=100&order_by=last_activity_at',
            this._projectLoadingOverlay,
            this._('Loading projects...'),
            (data) => {
                this._projects = data;
                this._updateProjectList();

                // Auto-select preselected project
                if (this._preselectedProject) {
                    const sorted = [...this._projects].sort((a, b) =>
                        a.path_with_namespace.localeCompare(b.path_with_namespace));
                    const index = sorted.findIndex(p => p.id === this._preselectedProject.id);
                    if (index >= 0) {
                        const widgets = this._projectList.get_children();
                        if (widgets[index])
                            this._selectProject(sorted[index], widgets[index]);
                    }
                }
            }
        );
    }

    _updateProjectList() {
        this._selectedProjectWidget = null;
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
                style_class: 'popup-menu-item',
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
                style: 'margin-left: 8px;',
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
        if (this._selectedProjectWidget)
            this._selectedProjectWidget.remove_style_pseudo_class('active');
        this._selectedProjectWidget = widget;
        widget.add_style_pseudo_class('active');

        // Load issues for this project
        this._loadIssues(project.id);
    }

    _loadIssues(projectId) {
        this._apiGet(
            `/projects/${projectId}/issues?state=opened&per_page=100`,
            this._issueLoadingOverlay,
            this._('Loading issues...'),
            (data) => {
                this._allIssues = data;
                this._updateIssueList();

                // Auto-select preselected issue
                if (this._preselectedIssue) {
                    const index = this._allIssues.findIndex(i => i.iid === this._preselectedIssue.iid);
                    if (index >= 0) {
                        const widgets = this._issueList.get_children();
                        if (widgets[index])
                            this._selectIssue(this._allIssues[index], widgets[index]);
                    }
                }
            }
        );
    }

    _updateIssueList() {
        this._selectedIssueWidget = null;
        this._issueList.destroy_all_children();

        const searchText = this._issueSearchEntry.get_text().toLowerCase();
        const filteredIssues = searchText
            ? this._allIssues.filter(i =>
                i.title.toLowerCase().includes(searchText) ||
                i.iid.toString().includes(searchText))
            : this._allIssues;

        for (let issue of filteredIssues) {
            let item = new St.Button({
                style_class: 'popup-menu-item',
                can_focus: true,
                track_hover: true,
                x_expand: true,
                x_align: Clutter.ActorAlign.FILL
            });

            let label = new St.Label({
                text: `#${issue.iid} - ${issue.title}`,
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
                style_class: 'gitlab-empty-label'
            });
            this._issueList.add_child(emptyLabel);
        }
    }

    _selectIssue(issue, widget) {
        this._selectedIssue = issue;

        // Highlight selected issue
        if (this._selectedIssueWidget)
            this._selectedIssueWidget.remove_style_pseudo_class('active');
        this._selectedIssueWidget = widget;
        widget.add_style_pseudo_class('active');
    }

    _filterProjects() {
        this._updateProjectList();
    }

    _filterIssues() {
        this._updateIssueList();
    }

    _createLoadingOverlay() {
        // Wrapper: fills the list area, holds both the bg overlay and the spinner
        let wrapper = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });

        // Background overlay
        wrapper._bg = new St.Widget({
            style_class: 'popup-menu-content',
            opacity: 200,
            x_expand: true,
            y_expand: true,
        });
        wrapper.add_child(wrapper._bg);

        // Spinner + label centered on top
        let content = new St.BoxLayout({
            vertical: false,
            style: 'padding: 8px;',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });

        wrapper._spinner = new Animation.Spinner(16);
        content.add_child(wrapper._spinner);

        wrapper._label = new St.Label({
            style: 'font-style: italic; margin-left: 8px;',
            y_align: Clutter.ActorAlign.CENTER
        });
        content.add_child(wrapper._label);

        wrapper.add_child(content);

        wrapper.hide();
        return wrapper;
    }

    _showOverlay(overlay, text) {
        overlay._label.text = text;
        // If already visible, just update the text
        if (overlay.visible) return;
        if (overlay._delayId) {
            GLib.source_remove(overlay._delayId);
            overlay._delayId = null;
        }
        overlay._delayId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
            overlay._delayId = null;
            overlay.show();
            overlay._spinner.play();
            return GLib.SOURCE_REMOVE;
        });
    }

    _hideOverlay(overlay) {
        if (overlay._delayId) {
            GLib.source_remove(overlay._delayId);
            overlay._delayId = null;
        }
        overlay._spinner.stop();
        overlay.hide();
    }

    _onSelect() {
        if (!this._selectedProject || !this._selectedIssue) {
            Main.notify(this._('GitLab Time Tracking'), this._('Please select a project and an issue'));
            return;
        }

        this._onSelected(this._selectedProject, this._selectedIssue);
        this.close();
    }

    destroy() {
        this._hideOverlay(this._projectLoadingOverlay);
        this._hideOverlay(this._issueLoadingOverlay);
        this._httpSession.abort();
        super.destroy();
    }
});
