# RSTM patches for Chatwoot (helpdesk.rstm.company)

This branch (`rstm`) only adds this folder. The app itself is the official `chatwoot/chatwoot` release image;
the Dockerfile copies the patches below on top. No asset build is needed, so a build takes seconds.

| Patch | What it does |
|---|---|
| `config/initializers/rstm_open_counts.rb` | Sidebar badges (inboxes, labels, teams, folders) count **open** conversations instead of unread ones, like the Gorgias views. Folder badges refresh within 30 s (Chatwoot default 5 min). Needs the account features `conversation_unread_counts` and `unread_count_for_filters`. |
| `config/initializers/rstm_branding.rb` | Turns on `disable_branding` for every account: no "Powered by Chatwoot" in the chat widget, help center and emails. |
| `app/views/public/api/v1/portals/**/_footer.html.erb` | Empty help center footers (no Chatwoot links on the public pages). |
| `config/locales/zz_rstm_de.yml` | Customer-facing German texts in "du" (chat bot prompts, CSAT, help center hero and 404). |
| `public/rstm/gorgias-macros.js` | Macros like in Gorgias: a macro picked with "#" in the reply box puts its text (variables filled in) and files into the reply instead of sending right away; labels, note and status run when the reply is sent. Loaded via DASHBOARD_SCRIPTS: `<script src="/rstm/gorgias-macros.js?v=<commit>" defer></script>`. |

## Update Chatwoot

1. Change `CHATWOOT_VERSION` in `Dockerfile` (or the build arg in the Coolify compose).
2. Check that the patched methods still exist in the new version
   (`app/services/conversations/unread_counts/{builder,refresher,filtered_counter,filter_query_counter}.rb`), that the
   overridden footer templates still exist under the same path, and that the locale keys in `zz_rstm_de.yml` still exist.
3. Test `gorgias-macros.js` by hand: it hooks into the reply box component (`onExecuteMacro`, `message`,
   `messageVariables`, `toggleSignatureForDraft`, `onFileUpload`, `setReplyMode`) and the Vuex action
   `sendMessageWithData`. If one of them changed, the script falls back to Chatwoot's normal behaviour (run right away).
4. Commit, put the new commit into the Coolify compose (`build.context`), deploy.

Operations notes: `connectors/registry/helpdesk.md` in rstm-mission-control.
