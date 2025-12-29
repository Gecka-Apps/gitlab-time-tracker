import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup';

/**
 * AvatarLoader - Shared utility for loading GitLab project/group/user avatars
 */
export class AvatarLoader {
    constructor(settings, httpSession) {
        this._settings = settings;
        this._httpSession = httpSession;
        this._avatarCache = new Map();
    }

    /**
     * Load avatar for a project, with fallback to namespace avatar
     * @param {number} projectId - The project ID
     * @param {object|null} namespace - The project namespace (optional)
     * @param {St.Icon} iconWidget - The icon widget to update
     */
    loadProjectAvatar(projectId, namespace, iconWidget) {
        const cacheKey = `project-${projectId}`;

        // Check cache
        if (this._avatarCache.has(cacheKey)) {
            const gicon = this._avatarCache.get(cacheKey);
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
                            this._avatarCache.set(cacheKey, gicon);
                            iconWidget.set_gicon(gicon);
                        } else if (namespace) {
                            // Fallback: try to load group/user avatar
                            this._loadNamespaceAvatar(namespace, iconWidget, cacheKey);
                        } else {
                            // No avatar available, keep default icon
                            this._avatarCache.set(cacheKey, null);
                        }
                    } catch (e) {
                        this._avatarCache.set(cacheKey, null);
                        console.debug('GitLab AvatarLoader: Failed to load project avatar:', e.message);
                    }
                }
            );
        } catch (e) {
            this._avatarCache.set(cacheKey, null);
            console.debug('GitLab AvatarLoader: Error creating avatar request:', e.message);
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

        // Get user info to retrieve avatar_url
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

                            // Download avatar if URL exists
                            if (user.avatar_url) {
                                this._downloadAvatar(user.avatar_url, iconWidget, cacheKey);
                            } else {
                                this._avatarCache.set(cacheKey, null);
                            }
                        } else {
                            this._avatarCache.set(cacheKey, null);
                        }
                    } catch (e) {
                        this._avatarCache.set(cacheKey, null);
                        console.debug('GitLab AvatarLoader: Failed to load user info:', e.message);
                    }
                }
            );
        } catch (e) {
            this._avatarCache.set(cacheKey, null);
            console.debug('GitLab AvatarLoader: Error creating user info request:', e.message);
        }
    }

    _downloadAvatar(avatarUrl, iconWidget, cacheKey) {
        // Convert relative URLs to absolute URLs
        let fullUrl = avatarUrl;
        if (avatarUrl.startsWith('/')) {
            const gitlabUrl = this._settings.get_string('gitlab-url');
            fullUrl = gitlabUrl + avatarUrl;
        }

        // Add token for private avatars
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
                            this._avatarCache.set(cacheKey, gicon);
                            // Check if widget still exists before accessing it
                            if (iconWidget && !iconWidget.is_finalized || (typeof iconWidget.is_finalized === 'function' && !iconWidget.is_finalized())) {
                                iconWidget.set_gicon(gicon);
                            }
                        } else {
                            this._avatarCache.set(cacheKey, null);
                        }
                    } catch (e) {
                        this._avatarCache.set(cacheKey, null);
                        console.debug('GitLab AvatarLoader: Failed to download avatar:', e.message);
                    }
                }
            );
        } catch (e) {
            this._avatarCache.set(cacheKey, null);
            console.debug('GitLab AvatarLoader: Error downloading avatar:', e.message);
        }
    }

    _loadGroupAvatar(groupId, iconWidget, cacheKey) {
        const url = this._settings.get_string('gitlab-url');
        const token = this._settings.get_string('gitlab-token');

        // Use GitLab API to get group avatar
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
                            this._avatarCache.set(cacheKey, gicon);
                            iconWidget.set_gicon(gicon);
                        } else {
                            // No group avatar either, keep default icon
                            this._avatarCache.set(cacheKey, null);
                        }
                    } catch (e) {
                        this._avatarCache.set(cacheKey, null);
                        console.debug('GitLab AvatarLoader: Failed to load group avatar:', e.message);
                    }
                }
            );
        } catch (e) {
            this._avatarCache.set(cacheKey, null);
            console.debug('GitLab AvatarLoader: Error creating group avatar request:', e.message);
        }
    }

    /**
     * Get cached avatar for a project
     * @param {number} projectId - The project ID
     * @returns {Gio.Icon|null} The cached icon or null
     */
    getCachedAvatar(projectId) {
        const cacheKey = `project-${projectId}`;
        return this._avatarCache.get(cacheKey) || null;
    }

    /**
     * Clear the avatar cache
     */
    clearCache() {
        this._avatarCache.clear();
    }
}
