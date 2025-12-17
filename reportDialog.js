import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup';
import Gio from 'gi://Gio';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export const ReportDialog = GObject.registerClass(
class ReportDialog extends ModalDialog.ModalDialog {
    _init(settings, gettext, preselectedProject = null) {
        super._init({ styleClass: 'gitlab-report-dialog' });

        this._settings = settings;
        this._ = gettext;
        this._httpSession = new Soup.Session();
        this._projects = [];
        this._selectedProject = null;
        this._preselectedProject = preselectedProject;
        this._reportData = null;
        this._projectSelectorOpen = false;
        this._projectAvatars = new Map(); // Cache for project avatars

        // Initialize date to current month
        const now = new Date();
        this._currentYear = now.getFullYear();
        this._currentMonth = now.getMonth(); // 0-11

        this._buildUI();
        this._loadProjects();
    }

    _buildUI() {
        // Main container
        let content = new St.BoxLayout({
            vertical: true,
            style_class: 'gitlab-report-content',
            style: 'min-width: 700px; min-height: 600px; padding: 20px;'
        });

        // Title
        let title = new St.Label({
            text: this._('Monthly Time Report'),
            style_class: 'gitlab-report-title',
            style: 'font-size: 18px; font-weight: bold; margin-bottom: 15px;'
        });
        content.add_child(title);

        // Project selection section
        let projectBox = new St.BoxLayout({
            vertical: true,
            style: 'margin-bottom: 15px;'
        });

        let projectHeaderBox = new St.BoxLayout({
            vertical: false,
            style: 'margin-bottom: 5px; spacing: 10px;'
        });

        let projectLabel = new St.Label({
            text: this._('Project') + ':',
            style: 'font-weight: bold;',
            y_align: Clutter.ActorAlign.CENTER
        });
        projectHeaderBox.add_child(projectLabel);

        this._projectDropdown = new St.Button({
            style: 'padding: 8px 12px; border: 1px solid #555; border-radius: 5px; min-width: 300px;',
            x_expand: true
        });

        let dropdownBox = new St.BoxLayout({
            vertical: false,
            style: 'spacing: 8px;',
            x_expand: true
        });

        this._projectIcon = new St.Icon({
            icon_name: 'folder-symbolic',
            icon_size: 20,
            style: 'width: 20px; height: 20px;'
        });
        dropdownBox.add_child(this._projectIcon);

        this._projectDropdownLabel = new St.Label({
            text: this._('Select a project...'),
            style: 'font-size: 12px;',
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.START,
            x_expand: true
        });
        dropdownBox.add_child(this._projectDropdownLabel);

        this._projectDropdown.set_child(dropdownBox);
        this._projectDropdown.connect('clicked', () => this._toggleProjectSelector());
        projectHeaderBox.add_child(this._projectDropdown);

        projectBox.add_child(projectHeaderBox);

        // Project selector (initially hidden)
        this._projectSelectorBox = new St.BoxLayout({
            vertical: true,
            style: 'margin-bottom: 10px;'
        });
        this._projectSelectorBox.hide();

        // Search box
        this._projectSearchEntry = new St.Entry({
            hint_text: this._('Search project...'),
            can_focus: true,
            track_hover: true,
            style: 'margin-bottom: 5px;'
        });
        this._projectSearchEntry.clutter_text.connect('text-changed', () => {
            this._filterProjects();
        });
        this._projectSelectorBox.add_child(this._projectSearchEntry);

        // Project list with scrolling
        let projectScrollView = new St.ScrollView({
            style: 'border: 1px solid #555; border-radius: 5px; height: 200px;',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC
        });

        this._projectList = new St.BoxLayout({
            vertical: true,
            style_class: 'gitlab-project-list'
        });
        projectScrollView.add_child(this._projectList);
        this._projectSelectorBox.add_child(projectScrollView);

        projectBox.add_child(this._projectSelectorBox);

        content.add_child(projectBox);

        // Month/Year navigation section (centered container)
        let dateBoxContainer = new St.BoxLayout({
            vertical: false,
            style: 'margin-bottom: 15px;',
            x_align: Clutter.ActorAlign.CENTER,
            x_expand: true
        });

        let dateBox = new St.BoxLayout({
            vertical: false,
            style: 'spacing: 10px;'
        });

        this._prevMonthBtn = new St.Button({
            style: 'padding: 8px 15px; border: 1px solid #555; border-radius: 5px;',
            label: '◀',
            y_align: Clutter.ActorAlign.CENTER
        });
        this._prevMonthBtn.connect('clicked', () => this._previousMonth());
        dateBox.add_child(this._prevMonthBtn);

        this._dateLabel = new St.Label({
            text: this._formatMonthYear(),
            style: 'font-size: 16px; font-weight: bold; min-width: 200px; text-align: center;',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER
        });
        dateBox.add_child(this._dateLabel);

        this._nextMonthBtn = new St.Button({
            style: 'padding: 8px 15px; border: 1px solid #555; border-radius: 5px;',
            label: '▶',
            y_align: Clutter.ActorAlign.CENTER
        });
        this._nextMonthBtn.connect('clicked', () => this._nextMonth());
        dateBox.add_child(this._nextMonthBtn);

        dateBoxContainer.add_child(dateBox);
        content.add_child(dateBoxContainer);

        // Chart area
        this._chartContainer = new St.ScrollView({
            style: 'border: 1px solid #555; border-radius: 5px; height: 300px; margin-bottom: 15px;',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC
        });

        this._chartBox = new St.BoxLayout({
            vertical: true,
            style: 'padding: 20px;'
        });
        this._chartContainer.add_child(this._chartBox);
        content.add_child(this._chartContainer);

        // Summary section
        this._summaryBox = new St.BoxLayout({
            vertical: true,
            style: 'padding: 15px; background-color: rgba(255,255,255,0.05); border-radius: 5px; margin-bottom: 15px;'
        });

        this._summaryLabel = new St.Label({
            text: this._('Total time') + ': 0h',
            style: 'font-size: 14px; font-weight: bold;'
        });
        this._summaryBox.add_child(this._summaryLabel);

        content.add_child(this._summaryBox);

        // Loading indicator
        this._loadingLabel = new St.Label({
            text: this._('Loading...'),
            style: 'font-style: italic; color: #999;'
        });
        this._loadingLabel.hide();
        content.add_child(this._loadingLabel);

        this.contentLayout.add_child(content);

        // Buttons
        this.setButtons([
            {
                label: this._('Export Markdown'),
                action: () => this._exportMarkdown()
            },
            {
                label: this._('Export CSV'),
                action: () => this._exportCSV()
            },
            {
                label: this._('Close'),
                action: () => this.close(),
                key: Clutter.KEY_Escape
            }
        ]);

        this._updateChart();
    }

    _formatMonthYear() {
        const monthNames = [
            this._('January'), this._('February'), this._('March'),
            this._('April'), this._('May'), this._('June'),
            this._('July'), this._('August'), this._('September'),
            this._('October'), this._('November'), this._('December')
        ];
        return `${monthNames[this._currentMonth]} ${this._currentYear}`;
    }

    _previousMonth() {
        this._currentMonth--;
        if (this._currentMonth < 0) {
            this._currentMonth = 11;
            this._currentYear--;
        }
        this._dateLabel.text = this._formatMonthYear();
        if (this._selectedProject) {
            this._loadReportData();
        }
    }

    _nextMonth() {
        this._currentMonth++;
        if (this._currentMonth > 11) {
            this._currentMonth = 0;
            this._currentYear++;
        }
        this._dateLabel.text = this._formatMonthYear();
        if (this._selectedProject) {
            this._loadReportData();
        }
    }

    _loadProjects() {
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

                        // If a project was preselected, select it
                        if (this._preselectedProject) {
                            const project = this._projects.find(p => p.id === this._preselectedProject.id);
                            if (project) {
                                this._selectProject(project, null);
                            }
                        }
                    } else {
                        Main.notify(this._('Error'), `${this._('Unable to load projects')}: ${message.status_code}`);
                    }
                } catch (e) {
                    Main.notify(this._('Error'), `${this._('Error loading projects')}: ${e.message}`);
                }
            }
        );
    }

    _toggleProjectSelector() {
        if (this._projectSelectorOpen) {
            this._projectSelectorBox.hide();
            this._projectSelectorOpen = false;
        } else {
            this._projectSelectorBox.show();
            this._projectSelectorOpen = true;
            this._updateProjectList();
            // Focus the search entry
            global.stage.set_key_focus(this._projectSearchEntry);
        }
    }

    _updateProjectList() {
        this._projectList.destroy_all_children();

        const searchText = this._projectSearchEntry.get_text().toLowerCase();
        let filteredProjects = searchText
            ? this._projects.filter(p => p.name.toLowerCase().includes(searchText) ||
                                         p.path_with_namespace.toLowerCase().includes(searchText))
            : this._projects;

        // Sort alphabetically by path_with_namespace
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

            // Load project avatar
            const namespace = project.namespace || null;
            this._loadProjectAvatar(project.id, namespace, icon);

            box.add_child(icon);

            let label = new St.Label({
                text: project.path_with_namespace,
                style: 'font-size: 12px;',
                y_align: Clutter.ActorAlign.CENTER
            });
            box.add_child(label);

            item.set_child(box);

            item.connect('clicked', () => {
                this._selectProject(project, icon.gicon);
            });

            this._projectList.add_child(item);
        }

        if (filteredProjects.length === 0) {
            let emptyLabel = new St.Label({
                text: this._('No projects available'),
                style: 'padding: 20px; font-style: italic; color: #999;'
            });
            this._projectList.add_child(emptyLabel);
        }
    }

    _filterProjects() {
        this._updateProjectList();
    }

    _selectProject(project, gicon) {
        this._selectedProject = project;
        this._projectDropdownLabel.text = project.path_with_namespace;

        // Update icon if available
        if (gicon) {
            this._projectIcon.set_gicon(gicon);
        } else {
            this._projectIcon.icon_name = 'folder-symbolic';
        }

        // Hide selector
        this._projectSelectorBox.hide();
        this._projectSelectorOpen = false;

        // Load report data
        this._loadReportData();
    }

    _loadProjectAvatar(projectId, namespace, iconWidget) {
        const cacheKey = `project-${projectId}`;

        // Check cache
        if (this._projectAvatars.has(cacheKey)) {
            const gicon = this._projectAvatars.get(cacheKey);
            if (gicon) {
                iconWidget.set_gicon(gicon);
            }
            return;
        }

        const url = this._settings.get_string('gitlab-url');
        const token = this._settings.get_string('gitlab-token');

        // Use GitLab API to get project avatar
        const apiUrl = `${url}/api/v4/projects/${projectId}/avatar`;

        try {
            const message = Soup.Message.new('GET', apiUrl);
            message.request_headers.append('PRIVATE-TOKEN', token);

            this._httpSession.send_and_read_async(
                message,
                GLib.PRIORITY_DEFAULT,
                null,
                (session, result) => {
                    try {
                        const bytes = session.send_and_read_finish(result);
                        if (message.status_code === 200 && bytes && bytes.get_size() > 0) {
                            const gicon = Gio.BytesIcon.new(bytes);
                            this._projectAvatars.set(cacheKey, gicon);
                            iconWidget.set_gicon(gicon);
                        } else if (namespace) {
                            // Fallback: try to load group/user avatar
                            this._loadNamespaceAvatar(namespace, iconWidget, cacheKey);
                        } else {
                            // No avatar available, keep default icon
                            this._projectAvatars.set(cacheKey, null);
                        }
                    } catch (e) {
                        this._projectAvatars.set(cacheKey, null);
                        log('GitLab Report: Failed to load project avatar:', e.message);
                    }
                }
            );
        } catch (e) {
            this._projectAvatars.set(cacheKey, null);
            log('GitLab Report: Error creating avatar request:', e.message);
        }
    }

    _loadNamespaceAvatar(namespace, iconWidget, cacheKey) {
        // Determine if it's a group or user
        const isUser = namespace.kind === 'user';

        if (isUser) {
            this._loadUserAvatar(namespace.id, iconWidget, cacheKey);
        } else {
            this._loadGroupAvatar(namespace.id, iconWidget, cacheKey);
        }
    }

    _loadUserAvatar(userId, iconWidget, cacheKey) {
        const url = this._settings.get_string('gitlab-url');
        const token = this._settings.get_string('gitlab-token');

        const apiUrl = `${url}/api/v4/users/${userId}`;

        try {
            const message = Soup.Message.new('GET', apiUrl);
            message.request_headers.append('PRIVATE-TOKEN', token);

            this._httpSession.send_and_read_async(
                message,
                GLib.PRIORITY_DEFAULT,
                null,
                (session, result) => {
                    try {
                        const bytes = session.send_and_read_finish(result);
                        if (message.status_code === 200) {
                            const decoder = new TextDecoder('utf-8');
                            const response = decoder.decode(bytes.get_data());
                            const user = JSON.parse(response);

                            if (user.avatar_url) {
                                this._downloadAvatar(user.avatar_url, iconWidget, cacheKey);
                            } else {
                                this._projectAvatars.set(cacheKey, null);
                            }
                        } else {
                            this._projectAvatars.set(cacheKey, null);
                        }
                    } catch (e) {
                        this._projectAvatars.set(cacheKey, null);
                        log('GitLab Report: Failed to load user info:', e.message);
                    }
                }
            );
        } catch (e) {
            this._projectAvatars.set(cacheKey, null);
            log('GitLab Report: Error creating user info request:', e.message);
        }
    }

    _downloadAvatar(avatarUrl, iconWidget, cacheKey) {
        let fullUrl = avatarUrl;
        if (avatarUrl.startsWith('/')) {
            const gitlabUrl = this._settings.get_string('gitlab-url');
            fullUrl = gitlabUrl + avatarUrl;
        }

        const token = this._settings.get_string('gitlab-token');
        if (fullUrl.includes('/uploads/')) {
            const separator = fullUrl.includes('?') ? '&' : '?';
            fullUrl = `${fullUrl}${separator}private_token=${token}`;
        }

        try {
            const message = Soup.Message.new('GET', fullUrl);

            this._httpSession.send_and_read_async(
                message,
                GLib.PRIORITY_DEFAULT,
                null,
                (session, result) => {
                    try {
                        const bytes = session.send_and_read_finish(result);
                        if (message.status_code === 200 && bytes && bytes.get_size() > 0) {
                            const gicon = Gio.BytesIcon.new(bytes);
                            this._projectAvatars.set(cacheKey, gicon);
                            iconWidget.set_gicon(gicon);
                        } else {
                            this._projectAvatars.set(cacheKey, null);
                        }
                    } catch (e) {
                        this._projectAvatars.set(cacheKey, null);
                        log('GitLab Report: Failed to download avatar:', e.message);
                    }
                }
            );
        } catch (e) {
            this._projectAvatars.set(cacheKey, null);
            log('GitLab Report: Error downloading avatar:', e.message);
        }
    }

    _loadGroupAvatar(groupId, iconWidget, cacheKey) {
        const url = this._settings.get_string('gitlab-url');
        const token = this._settings.get_string('gitlab-token');

        const apiUrl = `${url}/api/v4/groups/${groupId}/avatar`;

        try {
            const message = Soup.Message.new('GET', apiUrl);
            message.request_headers.append('PRIVATE-TOKEN', token);

            this._httpSession.send_and_read_async(
                message,
                GLib.PRIORITY_DEFAULT,
                null,
                (session, result) => {
                    try {
                        const bytes = session.send_and_read_finish(result);
                        if (message.status_code === 200 && bytes && bytes.get_size() > 0) {
                            const gicon = Gio.BytesIcon.new(bytes);
                            this._projectAvatars.set(cacheKey, gicon);
                            iconWidget.set_gicon(gicon);
                        } else {
                            this._projectAvatars.set(cacheKey, null);
                        }
                    } catch (e) {
                        this._projectAvatars.set(cacheKey, null);
                        log('GitLab Report: Failed to load group avatar:', e.message);
                    }
                }
            );
        } catch (e) {
            this._projectAvatars.set(cacheKey, null);
            log('GitLab Report: Error creating group avatar request:', e.message);
        }
    }

    _loadReportData() {
        this._showLoading();

        const url = this._settings.get_string('gitlab-url');
        const token = this._settings.get_string('gitlab-token');

        // Calculate date range for the selected month
        const startDate = new Date(this._currentYear, this._currentMonth, 1);
        const endDate = new Date(this._currentYear, this._currentMonth + 1, 0);

        const startDateStr = startDate.toISOString().split('T')[0];
        const endDateStr = endDate.toISOString().split('T')[0];

        // Get all issues updated in this month
        const apiUrl = `${url}/api/v4/projects/${this._selectedProject.id}/issues?updated_after=${startDateStr}&updated_before=${endDateStr}T23:59:59Z&per_page=100`;

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
                        const issues = JSON.parse(response);
                        this._processReportData(issues);
                    } else {
                        this._hideLoading();
                        Main.notify(this._('Error'), `${this._('Unable to load report')}: ${message.status_code}`);
                    }
                } catch (e) {
                    this._hideLoading();
                    Main.notify(this._('Error'), `${this._('Error loading report')}: ${e.message}`);
                }
            }
        );
    }

    _processReportData(issues) {
        // Get tag filter from settings
        const filterString = this._settings.get_string('report-tags-filter').trim();
        const tagFilters = this._parseTagFilters(filterString);

        // Aggregate time by labels
        const timeByLabel = {};
        let totalSeconds = 0;

        for (const issue of issues) {
            if (issue.time_stats && issue.time_stats.total_time_spent > 0) {
                const timeSpent = issue.time_stats.total_time_spent; // in seconds
                totalSeconds += timeSpent;

                // Group by labels
                const labels = issue.labels || [];

                // If filter is active, only count matching labels
                let matchedLabels = [];
                if (tagFilters.length > 0) {
                    matchedLabels = labels.filter(label => this._labelMatchesFilters(label, tagFilters));
                } else {
                    // No filter, use all labels
                    matchedLabels = labels;
                }

                if (matchedLabels.length === 0) {
                    // No matching label or no label at all
                    const otherLabel = tagFilters.length > 0 ? this._('Other') : this._('No label');
                    if (!timeByLabel[otherLabel]) {
                        timeByLabel[otherLabel] = 0;
                    }
                    timeByLabel[otherLabel] += timeSpent;
                } else {
                    for (const label of matchedLabels) {
                        if (!timeByLabel[label]) {
                            timeByLabel[label] = 0;
                        }
                        timeByLabel[label] += timeSpent;
                    }
                }
            }
        }

        this._reportData = {
            timeByLabel: timeByLabel,
            totalSeconds: totalSeconds,
            issues: issues,
            tagFilters: tagFilters
        };

        this._hideLoading();
        this._updateChart();
        this._updateSummary();
    }

    _parseTagFilters(filterString) {
        if (!filterString) {
            return [];
        }

        // Split by comma and trim
        const filters = filterString.split(',').map(f => f.trim()).filter(f => f.length > 0);

        // Parse each filter to determine if it's a regex or literal string
        return filters.map(filter => {
            // Check if it looks like a regex (starts with ^ or ends with $, or contains .* or .+)
            if (filter.startsWith('^') || filter.endsWith('$') || filter.includes('.*') || filter.includes('.+')) {
                try {
                    return { type: 'regex', pattern: new RegExp(filter) };
                } catch (e) {
                    log(`GitLab Report: Invalid regex "${filter}": ${e.message}`);
                    // Fall back to literal match
                    return { type: 'literal', value: filter };
                }
            } else {
                return { type: 'literal', value: filter };
            }
        });
    }

    _labelMatchesFilters(label, tagFilters) {
        for (const filter of tagFilters) {
            if (filter.type === 'regex') {
                if (filter.pattern.test(label)) {
                    return true;
                }
            } else {
                if (filter.value === label) {
                    return true;
                }
            }
        }
        return false;
    }

    _updateChart() {
        this._chartBox.destroy_all_children();

        if (!this._reportData || Object.keys(this._reportData.timeByLabel).length === 0) {
            let emptyLabel = new St.Label({
                text: this._('No time tracked for this period'),
                style: 'font-style: italic; color: #999; padding: 40px;'
            });
            this._chartBox.add_child(emptyLabel);
            return;
        }

        // Find max value for scaling
        const maxSeconds = Math.max(...Object.values(this._reportData.timeByLabel));

        // Create bars for each label
        const sortedLabels = Object.entries(this._reportData.timeByLabel)
            .sort((a, b) => b[1] - a[1]); // Sort by time descending

        for (const [label, seconds] of sortedLabels) {
            const hours = (seconds / 3600).toFixed(1);
            const barWidth = maxSeconds > 0 ? (seconds / maxSeconds) * 400 : 0;

            let barContainer = new St.BoxLayout({
                vertical: false,
                style: 'margin-bottom: 10px; spacing: 10px;'
            });

            // Label name
            let labelText = new St.Label({
                text: label,
                style: 'min-width: 150px; font-size: 12px;',
                y_align: Clutter.ActorAlign.CENTER
            });
            barContainer.add_child(labelText);

            // Bar
            let bar = new St.Widget({
                style: `background-color: #4a90d9; height: 25px; width: ${barWidth}px; border-radius: 3px;`
            });
            barContainer.add_child(bar);

            // Time value
            let timeText = new St.Label({
                text: `${hours}h`,
                style: 'font-size: 12px; margin-left: 10px;',
                y_align: Clutter.ActorAlign.CENTER
            });
            barContainer.add_child(timeText);

            this._chartBox.add_child(barContainer);
        }
    }

    _updateSummary() {
        if (!this._reportData) {
            this._summaryLabel.text = this._('Total time') + ': 0h';
            return;
        }

        const totalHours = (this._reportData.totalSeconds / 3600).toFixed(1);
        const labelCount = Object.keys(this._reportData.timeByLabel).length;
        const issueCount = this._reportData.issues.filter(i => i.time_stats && i.time_stats.total_time_spent > 0).length;

        this._summaryLabel.text = `${this._('Total time')}: ${totalHours}h | ${this._('Issues')}: ${issueCount} | ${this._('Categories')}: ${labelCount}`;
    }

    _exportMarkdown() {
        if (!this._reportData || !this._selectedProject) {
            Main.notify(this._('GitLab Time Tracking'), this._('No data to export'));
            return;
        }

        const monthYear = this._formatMonthYear();
        const totalHours = (this._reportData.totalSeconds / 3600).toFixed(2);

        // Build Markdown content
        let md = `# ${this._('Monthly Time Report')} - ${this._selectedProject.path_with_namespace}\n\n`;
        md += `**${this._('Project')}:** ${this._selectedProject.path_with_namespace}\n`;
        md += `**Période:** ${monthYear}\n`;
        md += `**${this._('Total time')}:** ${totalHours}h\n\n`;

        // Summary by label
        md += `## Résumé par catégorie\n\n`;
        const sortedLabels = Object.entries(this._reportData.timeByLabel)
            .sort((a, b) => b[1] - a[1]); // Sort by time descending

        for (const [label, seconds] of sortedLabels) {
            const hours = (seconds / 3600).toFixed(2);
            md += `- **${label}:** ${hours}h\n`;
        }

        // Detail by issue
        md += `\n## Détail par ticket\n\n`;

        // Group issues by label (respecting filters)
        const issuesByLabel = {};
        const tagFilters = this._reportData.tagFilters || [];

        for (const issue of this._reportData.issues) {
            if (issue.time_stats && issue.time_stats.total_time_spent > 0) {
                const labels = issue.labels || [];

                // Apply filters if configured
                let matchedLabels = [];
                if (tagFilters.length > 0) {
                    matchedLabels = labels.filter(label => this._labelMatchesFilters(label, tagFilters));
                } else {
                    matchedLabels = labels;
                }

                if (matchedLabels.length === 0) {
                    // Use 'Other' or 'No label' depending on filter status
                    const otherLabel = tagFilters.length > 0 ? this._('Other') : this._('No label');
                    if (!issuesByLabel[otherLabel]) {
                        issuesByLabel[otherLabel] = [];
                    }
                    issuesByLabel[otherLabel].push(issue);
                } else {
                    for (const label of matchedLabels) {
                        if (!issuesByLabel[label]) {
                            issuesByLabel[label] = [];
                        }
                        issuesByLabel[label].push(issue);
                    }
                }
            }
        }

        // Sort labels
        const sortedLabelKeys = Object.keys(issuesByLabel).sort((a, b) => {
            const timeA = this._reportData.timeByLabel[a] || 0;
            const timeB = this._reportData.timeByLabel[b] || 0;
            return timeB - timeA;
        });

        for (const label of sortedLabelKeys) {
            const issues = issuesByLabel[label];
            const labelTime = (this._reportData.timeByLabel[label] / 3600).toFixed(2);

            md += `### ${label} (${labelTime}h)\n\n`;

            for (const issue of issues) {
                const hours = (issue.time_stats.total_time_spent / 3600).toFixed(2);
                const issueUrl = issue.web_url || '#';
                md += `- [#${issue.iid}](${issueUrl}) - ${issue.title} *(${hours}h)*\n`;
            }
            md += `\n`;
        }

        // Save to file
        const safePath = this._selectedProject.path_with_namespace.replace(/[\/\\:*?"<>|]/g, '-');
        const filename = `gitlab-report-${safePath}-${this._currentYear}-${String(this._currentMonth + 1).padStart(2, '0')}.md`;

        // Use GLib to get the Downloads directory
        const downloadsDir = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DOWNLOAD) || GLib.get_home_dir();
        const filepath = `${downloadsDir}/${filename}`;

        try {
            const file = Gio.File.new_for_path(filepath);
            file.replace_contents(
                new TextEncoder().encode(md),
                null,
                false,
                Gio.FileCreateFlags.REPLACE_DESTINATION,
                null
            );

            Main.notify(this._('GitLab Time Tracking'), `${this._('Report exported')}: ${filename}`);
        } catch (e) {
            Main.notify(this._('Error'), `${this._('Unable to export')}: ${e.message}`);
            log('GitLab Timer: Export error:', e.message);
        }
    }

    _exportCSV() {
        if (!this._reportData || !this._selectedProject) {
            Main.notify(this._('GitLab Time Tracking'), this._('No data to export'));
            return;
        }

        // Build CSV content
        let csv = `"Project","Month","Label","Time (hours)"\n`;

        const monthYear = this._formatMonthYear();
        for (const [label, seconds] of Object.entries(this._reportData.timeByLabel)) {
            const hours = (seconds / 3600).toFixed(2);
            csv += `"${this._selectedProject.path_with_namespace}","${monthYear}","${label}","${hours}"\n`;
        }

        // Add total
        const totalHours = (this._reportData.totalSeconds / 3600).toFixed(2);
        csv += `"${this._selectedProject.path_with_namespace}","${monthYear}","TOTAL","${totalHours}"\n`;

        // Save to file
        // Replace all invalid filename characters (/, \, :, *, ?, ", <, >, |)
        const safePath = this._selectedProject.path_with_namespace.replace(/[\/\\:*?"<>|]/g, '-');
        const filename = `gitlab-report-${safePath}-${this._currentYear}-${String(this._currentMonth + 1).padStart(2, '0')}.csv`;

        // Use GLib to get the Downloads directory
        const downloadsDir = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DOWNLOAD) || GLib.get_home_dir();
        const filepath = `${downloadsDir}/${filename}`;

        try {
            const file = Gio.File.new_for_path(filepath);
            file.replace_contents(
                new TextEncoder().encode(csv),
                null,
                false,
                Gio.FileCreateFlags.REPLACE_DESTINATION,
                null
            );

            Main.notify(this._('GitLab Time Tracking'), `${this._('Report exported')}: ${filename}`);
        } catch (e) {
            Main.notify(this._('Error'), `${this._('Unable to export')}: ${e.message}`);
            log('GitLab Timer: Export error:', e.message);
        }
    }

    _showLoading() {
        this._loadingLabel.show();
    }

    _hideLoading() {
        this._loadingLabel.hide();
    }
});
