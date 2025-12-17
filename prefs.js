import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class GitLabIssuesPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        // Create a preferences page
        const page = new Adw.PreferencesPage();
        window.add(page);

        // Create a preferences group
        const group = new Adw.PreferencesGroup({
            title: 'Configuration GitLab',
            description: 'Configurez votre serveur GitLab et votre token d\'accès',
        });
        page.add(group);

        // GitLab URL setting
        const urlRow = new Adw.EntryRow({
            title: 'URL du serveur GitLab',
        });
        urlRow.set_text(settings.get_string('gitlab-url'));
        urlRow.connect('changed', (widget) => {
            settings.set_string('gitlab-url', widget.get_text());
        });
        group.add(urlRow);

        // GitLab Token setting
        const tokenRow = new Adw.PasswordEntryRow({
            title: 'Token d\'accès',
        });
        tokenRow.set_text(settings.get_string('gitlab-token'));
        tokenRow.connect('changed', (widget) => {
            settings.set_string('gitlab-token', widget.get_text());
        });
        group.add(tokenRow);

        // Reports configuration group
        const reportsGroup = new Adw.PreferencesGroup({
            title: 'Configuration des rapports',
            description: 'Configurez les filtres pour les rapports mensuels',
        });
        page.add(reportsGroup);

        // Report tags filter setting
        const tagsFilterRow = new Adw.EntryRow({
            title: 'Tags inclus dans les rapports',
        });
        tagsFilterRow.set_text(settings.get_string('report-tags-filter'));
        tagsFilterRow.connect('changed', (widget) => {
            settings.set_string('report-tags-filter', widget.get_text());
        });
        reportsGroup.add(tagsFilterRow);

        // Help text for tags filter
        const tagsInfoLabel = new Gtk.Label({
            label: 'Laissez vide pour afficher tous les tags.\n' +
                   'Sinon, entrez une liste de tags séparés par des virgules ou des expressions régulières.\n' +
                   'Exemples:\n' +
                   '  • "Maintenance corrective,Maintenance préventive"\n' +
                   '  • "^Maintenance.*$" (tous les tags commençant par "Maintenance")\n' +
                   '  • "Bug,^Feature.*$"\n' +
                   '\nLes issues sans ces tags apparaîtront comme "Autre" dans les rapports.',
            wrap: true,
            xalign: 0,
        });
        tagsInfoLabel.add_css_class('dim-label');

        const tagsInfoRow = new Adw.ActionRow();
        tagsInfoRow.set_child(tagsInfoLabel);
        reportsGroup.add(tagsInfoRow);

        // Information group
        const infoGroup = new Adw.PreferencesGroup({
            title: 'Informations',
        });
        page.add(infoGroup);

        const infoLabel = new Gtk.Label({
            label: 'Pour créer un token d\'accès personnel:\n' +
                   '1. Allez dans votre profil GitLab\n' +
                   '2. Paramètres → Tokens d\'accès\n' +
                   '3. Créez un nouveau token avec les permissions "api"\n' +
                   '4. Copiez le token et collez-le ci-dessus',
            wrap: true,
            xalign: 0,
        });
        infoLabel.add_css_class('dim-label');

        const infoRow = new Adw.ActionRow();
        infoRow.set_child(infoLabel);
        infoGroup.add(infoRow);
    }
}
