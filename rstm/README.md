# RSTM patches for Chatwoot (helpdesk.rstm.company)

This branch (`rstm`) only adds this folder. The app itself is the official `chatwoot/chatwoot` release image;
the Dockerfile copies the patches below on top. No asset build is needed, so a build takes seconds.

| Patch | What it does |
|---|---|
| `config/initializers/rstm_open_counts.rb` | Sidebar badges (inboxes, labels, teams, folders) count **open** conversations instead of unread ones, like the Gorgias views. Needs the account features `conversation_unread_counts` and `unread_count_for_filters`. |

## Update Chatwoot

1. Change `CHATWOOT_VERSION` in `Dockerfile` (or the build arg in the Coolify compose).
2. Check that the patched methods still exist in the new version
   (`app/services/conversations/unread_counts/{builder,refresher,filtered_counter,filter_query_counter}.rb`).
3. Commit, put the new commit into the Coolify compose (`build.context`), deploy.

Operations notes: `connectors/registry/helpdesk.md` in rstm-mission-control.
