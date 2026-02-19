import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import * as Animation from 'resource:///org/gnome/shell/ui/animation.js';

import {AvatarLoader} from './avatarLoader.js';

export const ReportDialog = GObject.registerClass(
class ReportDialog extends ModalDialog.ModalDialog {
    _init(settings, gettext, preselectedProject = null) {
        super._init({ styleClass: 'gitlab-report-dialog' });

        this._settings = settings;
        this._ = gettext;
        this._httpSession = new Soup.Session();
        this._avatarLoader = new AvatarLoader(settings, this._httpSession);
        this._projects = [];
        this._selectedProject = null;
        this._preselectedProject = preselectedProject;
        this._reportData = null;
        this._projectSelectorOpen = false;

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
            style: 'margin-bottom: 5px;'
        });

        let projectLabel = new St.Label({
            text: this._('Project') + ':',
            style: 'font-weight: bold;',
            y_align: Clutter.ActorAlign.CENTER
        });
        projectHeaderBox.add_child(projectLabel);

        this._projectDropdown = new St.Button({
            style_class: 'popup-menu-item',
            style: 'padding: 8px 12px; min-width: 300px; margin-left: 10px;',
            x_expand: true
        });

        let dropdownBox = new St.BoxLayout({
            vertical: false,
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
            style: 'font-size: 12px; margin-left: 8px;',
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

        // Project list with scrolling and overlay
        let projectContainer = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            style_class: 'popup-menu-content gitlab-report-project-list',
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

        this._projectSelectorBox.add_child(projectContainer);

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
        });

        this._prevMonthBtn = new St.Button({
            style_class: 'popup-menu-item',
            style: 'padding: 8px 15px;',
            label: '◀',
            y_align: Clutter.ActorAlign.CENTER
        });
        this._prevMonthBtn.connect('clicked', () => this._previousMonth());
        dateBox.add_child(this._prevMonthBtn);

        this._dateLabel = new St.Label({
            text: this._formatMonthYear(),
            style: 'font-size: 16px; font-weight: bold; min-width: 200px; text-align: center; margin-left: 10px;',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER
        });
        dateBox.add_child(this._dateLabel);

        this._nextMonthBtn = new St.Button({
            style_class: 'popup-menu-item',
            style: 'padding: 8px 15px; margin-left: 10px;',
            label: '▶',
            y_align: Clutter.ActorAlign.CENTER
        });
        this._nextMonthBtn.connect('clicked', () => this._nextMonth());
        dateBox.add_child(this._nextMonthBtn);

        dateBoxContainer.add_child(dateBox);
        content.add_child(dateBoxContainer);

        // Chart area with overlay
        let chartWrapper = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            style_class: 'popup-menu-content gitlab-chart-container',
            x_expand: true,
            clip_to_allocation: true
        });

        this._chartContainer = new St.ScrollView({
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            x_expand: true,
            y_expand: true
        });

        this._chartBox = new St.BoxLayout({
            vertical: true,
            style: 'padding: 20px;'
        });
        this._chartContainer.add_child(this._chartBox);
        chartWrapper.add_child(this._chartContainer);

        this._chartLoadingOverlay = this._createLoadingOverlay();
        chartWrapper.add_child(this._chartLoadingOverlay);

        content.add_child(chartWrapper);

        // Summary section
        this._summaryBox = new St.BoxLayout({
            vertical: true,
            style_class: 'popup-menu-content',
            style: 'padding: 15px; margin-bottom: 15px;'
        });

        this._summaryLabel = new St.Label({
            text: this._('Total time') + ': 0h',
            style: 'font-size: 14px; font-weight: bold;'
        });
        this._summaryBox.add_child(this._summaryLabel);

        content.add_child(this._summaryBox);

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
        this._showOverlay(this._projectLoadingOverlay, this._('Loading projects...'));

        this._apiGet(
            '/projects?membership=true&per_page=100&order_by=last_activity_at',
            (data) => {
                this._projects = data;
                this._hideOverlay(this._projectLoadingOverlay);

                // If a project was preselected, select it
                if (this._preselectedProject) {
                    const project = this._projects.find(p => p.id === this._preselectedProject.id);
                    if (project) {
                        this._selectProject(project, null);
                    }
                }
            },
            (error) => {
                if (error === 401 || error === 403)
                    this._showOverlay(this._projectLoadingOverlay, this._('Please configure the server URL and token in preferences'));
                else
                    this._showOverlay(this._projectLoadingOverlay, `${this._('Error')}: ${error}`);
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
        const searchWords = searchText.split(/\s+/).filter(w => w.length > 0);
        let filteredProjects = searchWords.length > 0
            ? this._projects.filter(p => {
                const haystack = `${p.name} ${p.path_with_namespace}`.toLowerCase();
                return searchWords.every(word => haystack.includes(word));
            })
            : this._projects;

        // Sort alphabetically by path_with_namespace
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
                style: 'font-size: 12px; margin-left: 8px;',
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
                style_class: 'gitlab-empty-label'
            });
            this._projectList.add_child(emptyLabel);
        }
    }

    _filterProjects() {
        this._updateProjectList();
    }

    _apiGet(path, onSuccess, onError = null) {
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
                    } else {
                        console.debug(`GitLab Report: API error ${message.status_code} for ${path}`);
                        if (onError) onError(message.status_code);
                    }
                } catch (e) {
                    console.debug(`GitLab Report: API error for ${path}: ${e.message}`);
                    if (onError) onError(e);
                }
            }
        );
    }

    _selectProject(project, gicon) {
        this._selectedProject = project;
        this._projectDropdownLabel.text = project.path_with_namespace;

        // Update icon if available (use passed gicon, cache, or load)
        const cachedIcon = gicon || this._avatarLoader.getCachedAvatar(project.id);
        if (cachedIcon) {
            this._projectIcon.set_gicon(cachedIcon);
        } else {
            this._projectIcon.icon_name = 'folder-symbolic';
            this._avatarLoader.loadProjectAvatar(project.id, project.namespace || null, this._projectIcon);
        }

        // Hide selector
        this._projectSelectorBox.hide();
        this._projectSelectorOpen = false;

        // Load report data
        this._loadReportData();
    }

    _loadReportData() {
        this._showOverlay(this._chartLoadingOverlay, this._('Loading...'));

        // Build date range strings without UTC conversion (avoids timezone shift)
        const month = String(this._currentMonth + 1).padStart(2, '0');
        const lastDay = new Date(this._currentYear, this._currentMonth + 1, 0).getDate();
        const startDateStr = `${this._currentYear}-${month}-01`;
        const endDateStr = `${this._currentYear}-${month}-${String(lastDay).padStart(2, '0')}`;

        // Fetch issues updated in this period (gives us labels and metadata)
        this._apiGet(
            `/projects/${this._selectedProject.id}/issues?updated_after=${startDateStr}&updated_before=${endDateStr}T23:59:59Z&per_page=100`,
            (issues) => {
                const issuesWithTime = issues.filter(i =>
                    i.time_stats && i.time_stats.total_time_spent > 0);

                if (issuesWithTime.length === 0) {
                    this._processReportData([], new Map());
                    return;
                }

                // Fetch timelogs for each issue to get accurate monthly time
                let pending = issuesWithTime.length;
                const timelogsByIssue = new Map();

                for (const issue of issuesWithTime) {
                    this._apiGet(
                        `/projects/${this._selectedProject.id}/issues/${issue.iid}/timelogs?per_page=100`,
                        (timelogs) => {
                            // Only count timelogs spent during the selected month
                            const monthTime = timelogs
                                .filter(tl => {
                                    const spentAt = tl.spent_at || tl.created_at;
                                    if (!spentAt) return false;
                                    const date = new Date(spentAt);
                                    return date.getFullYear() === this._currentYear &&
                                           date.getMonth() === this._currentMonth;
                                })
                                .reduce((sum, tl) => sum + tl.time_spent, 0);

                            timelogsByIssue.set(issue.iid, monthTime);
                            pending--;
                            if (pending === 0)
                                this._processReportData(issuesWithTime, timelogsByIssue);
                        },
                        (error) => {
                            // Timelogs API failed, fall back to cumulative total_time_spent
                            console.debug(`GitLab Report: timelogs API failed for issue #${issue.iid} (${error}), using total_time_spent`);
                            timelogsByIssue.set(issue.iid, issue.time_stats.total_time_spent);
                            pending--;
                            if (pending === 0)
                                this._processReportData(issuesWithTime, timelogsByIssue);
                        }
                    );
                }
            },
            (error) => {
                if (error === 401 || error === 403)
                    this._showOverlay(this._chartLoadingOverlay, this._('Please configure the server URL and token in preferences'));
                else
                    this._showOverlay(this._chartLoadingOverlay, `${this._('Error')}: ${error}`);
            }
        );
    }

    _processReportData(issues, timelogsByIssue) {
        // Get tag filter from settings
        const filterString = this._settings.get_string('report-tags-filter').trim();
        const tagFilters = this._parseTagFilters(filterString);

        // Aggregate time by labels using per-month timelogs
        const timeByLabel = {};
        let totalSeconds = 0;
        const issuesWithMonthTime = [];

        for (const issue of issues) {
            const timeSpent = timelogsByIssue.get(issue.iid) || 0;
            if (timeSpent <= 0) continue;

            totalSeconds += timeSpent;
            issuesWithMonthTime.push(issue);

            // Group by labels
            const labels = issue.labels || [];

            let matchedLabels = [];
            if (tagFilters.length > 0) {
                matchedLabels = labels.filter(label => this._labelMatchesFilters(label, tagFilters));
            } else {
                matchedLabels = labels;
            }

            if (matchedLabels.length === 0) {
                const otherLabel = tagFilters.length > 0 ? this._('Other') : this._('No label');
                if (!timeByLabel[otherLabel]) timeByLabel[otherLabel] = 0;
                timeByLabel[otherLabel] += timeSpent;
            } else {
                for (const label of matchedLabels) {
                    if (!timeByLabel[label]) timeByLabel[label] = 0;
                    timeByLabel[label] += timeSpent;
                }
            }
        }

        this._reportData = {
            timeByLabel,
            totalSeconds,
            issues: issuesWithMonthTime,
            tagFilters,
            timelogsByIssue
        };

        this._hideOverlay(this._chartLoadingOverlay);
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
                    console.debug(`GitLab Report: Invalid regex "${filter}": ${e.message}`);
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
                style_class: 'gitlab-empty-label'
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
                style: 'margin-bottom: 10px;'
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
                style_class: 'gitlab-chart-bar',
                style: `height: 25px; width: ${barWidth}px; margin-left: 10px;`
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
        const issueCount = this._reportData.issues.length;

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
        md += `**${this._('Period')}:** ${monthYear}\n`;
        md += `**${this._('Total time')}:** ${totalHours}h\n\n`;

        // Summary by label
        md += `## ${this._('Summary by category')}\n\n`;
        const sortedLabels = Object.entries(this._reportData.timeByLabel)
            .sort((a, b) => b[1] - a[1]); // Sort by time descending

        for (const [label, seconds] of sortedLabels) {
            const hours = (seconds / 3600).toFixed(2);
            md += `- **${label}:** ${hours}h\n`;
        }

        // Detail by issue
        md += `\n## ${this._('Detail by issue')}\n\n`;

        // Group issues by label (respecting filters)
        const issuesByLabel = {};
        const tagFilters = this._reportData.tagFilters || [];

        for (const issue of this._reportData.issues) {
            const labels = issue.labels || [];

            let matchedLabels = [];
            if (tagFilters.length > 0) {
                matchedLabels = labels.filter(label => this._labelMatchesFilters(label, tagFilters));
            } else {
                matchedLabels = labels;
            }

            if (matchedLabels.length === 0) {
                const otherLabel = tagFilters.length > 0 ? this._('Other') : this._('No label');
                if (!issuesByLabel[otherLabel]) issuesByLabel[otherLabel] = [];
                issuesByLabel[otherLabel].push(issue);
            } else {
                for (const label of matchedLabels) {
                    if (!issuesByLabel[label]) issuesByLabel[label] = [];
                    issuesByLabel[label].push(issue);
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
                const hours = ((this._reportData.timelogsByIssue.get(issue.iid) || 0) / 3600).toFixed(2);
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

            this._notifyExportSuccess(filepath, filename);
        } catch (e) {
            Main.notify(this._('Error'), `${this._('Unable to export')}: ${e.message}`);
            console.debug('GitLab Timer: Export error:', e.message);
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

            this._notifyExportSuccess(filepath, filename);
        } catch (e) {
            Main.notify(this._('Error'), `${this._('Unable to export')}: ${e.message}`);
            console.debug('GitLab Timer: Export error:', e.message);
        }
    }

    _getNotificationSource() {
        if (!this._notificationSource) {
            this._notificationSource = new MessageTray.Source({
                title: this._('GitLab Time Tracking'),
                iconName: 'document-save-symbolic'
            });
            Main.messageTray.add(this._notificationSource);
        }
        return this._notificationSource;
    }

    _notifyExportSuccess(filepath, filename) {
        const source = this._getNotificationSource();

        const notification = new MessageTray.Notification({
            source: source,
            title: this._('GitLab Time Tracking'),
            body: `${this._('Report exported')}: ${filename}`,
            iconName: 'document-save-symbolic'
        });

        // Add action to open file
        notification.addAction(this._('Open File'), () => {
            try {
                const file = Gio.File.new_for_path(filepath);
                Gio.AppInfo.launch_default_for_uri(file.get_uri(), null);
            } catch (e) {
                console.debug(`GitLab Timer: Error opening file: ${e.message}`);
            }
        });

        // Add action to open containing folder with file selected
        notification.addAction(this._('Open Containing Folder'), () => {
            try {
                const file = Gio.File.new_for_path(filepath);
                const fileUri = file.get_uri();
                console.debug(`GitLab Timer: Opening containing folder for: ${fileUri}`);

                // Use org.freedesktop.FileManager1 DBus interface to show the file in its folder
                const bus = Gio.bus_get_sync(Gio.BusType.SESSION, null);
                bus.call(
                    'org.freedesktop.FileManager1',
                    '/org/freedesktop/FileManager1',
                    'org.freedesktop.FileManager1',
                    'ShowItems',
                    new GLib.Variant('(ass)', [[fileUri], '']),
                    null,
                    Gio.DBusCallFlags.NONE,
                    -1,
                    null,
                    (connection, result) => {
                        try {
                            connection.call_finish(result);
                        } catch (e) {
                            console.debug(`GitLab Timer: DBus call failed, falling back to opening folder: ${e.message}`);
                            // Fallback: just open the folder
                            const parent = file.get_parent();
                            if (parent) {
                                Gio.AppInfo.launch_default_for_uri(parent.get_uri(), null);
                            }
                        }
                    }
                );
            } catch (e) {
                console.debug(`GitLab Timer: Error opening containing folder: ${e.message}`);
            }
        });

        source.addNotification(notification);
    }

    _createLoadingOverlay() {
        let wrapper = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });

        wrapper._bg = new St.Widget({
            style_class: 'popup-menu-content',
            opacity: 200,
            x_expand: true,
            y_expand: true,
        });
        wrapper.add_child(wrapper._bg);

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

    destroy() {
        this._hideOverlay(this._projectLoadingOverlay);
        this._hideOverlay(this._chartLoadingOverlay);
        this._httpSession.abort();
        super.destroy();
    }
});
