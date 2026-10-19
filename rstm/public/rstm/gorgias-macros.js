/*
 * RSTM patch (19.10.2026): macros work like in Gorgias.
 *
 * Chatwoot 4.18 runs a macro picked in the reply box ("#" + search) right away: the reply is sent before the agent
 * can read or change it. With this script, picking a macro there
 *   - puts its reply text into the editor (variables filled in), where it can be edited before sending,
 *   - attaches its files to the reply,
 *   - keeps its other actions (labels, internal note, status, assignment) and runs them once the reply is sent.
 *     A bar above the reply box lists them, with "Jetzt ausführen" and "Verwerfen".
 * Macros without reply text or files, and macros started from the conversation side panel, still run right away.
 *
 * Hooks into Chatwoot's own Vue app (reply box component + Vuex store), no DOM scraping of the editor.
 * Loaded through DASHBOARD_SCRIPTS (Super Admin > App config) as <script src="/rstm/gorgias-macros.js">.
 * Tied to the Chatwoot version of the rstm-helpdesk image: test again after a Chatwoot upgrade.
 */
(function () {
  if (window.__rstmMacros) return;
  window.__rstmMacros = true;

  const TEXT = 'send_message';
  const FILE = 'send_attachment';
  const STATUS_ACTIONS = ['change_status', 'resolve_conversation', 'snooze_conversation'];
  const pending = new Map(); // conversation id -> { names: [], actions: [], vars: {} }

  const getStore = () => document.getElementById('app')?.__vue_app__?.config?.globalProperties?.$store || null;

  // The reply box component, found by walking Vue's vnode tree from the app root (production builds do not link DOM
  // elements to components). It is the only component with an onExecuteMacro method.
  let cachedReplyBox = null;
  function findComponent(vnode, test, depth = 0) {
    if (!vnode || depth > 500) return null;
    if (vnode.component) {
      if (test(vnode.component)) return vnode.component;
      const found = findComponent(vnode.component.subTree, test, depth + 1);
      if (found) return found;
    }
    if (vnode.suspense?.activeBranch) {
      const found = findComponent(vnode.suspense.activeBranch, test, depth + 1);
      if (found) return found;
    }
    if (Array.isArray(vnode.children)) {
      for (const child of vnode.children) {
        const found = child && typeof child === 'object' ? findComponent(child, test, depth + 1) : null;
        if (found) return found;
      }
    }
    return null;
  }
  function replyBox() {
    if (cachedReplyBox && !cachedReplyBox.isUnmounted) return cachedReplyBox;
    cachedReplyBox = findComponent(document.getElementById('app')?._vnode,
      c => c.ctx && typeof c.ctx.onExecuteMacro === 'function');
    return cachedReplyBox;
  }

  // ---------- picking a macro ----------

  function patchReplyBox() {
    const inst = replyBox();
    if (!inst || inst.ctx.__rstmMacros) return;
    const runNow = inst.ctx.onExecuteMacro;
    inst.ctx.onExecuteMacro = macro => applyMacro(inst.proxy, macro, runNow);
    inst.ctx.__rstmMacros = true;
    inst.proxy.$forceUpdate(); // the template reads the handler at render time
  }

  async function applyMacro(rb, macro, runNow) {
    const actions = macro.actions || [];
    const texts = actions.filter(a => a.action_name === TEXT).map(a => (a.action_params || [])[0]).filter(Boolean);
    const files = actions.filter(a => a.action_name === FILE);
    const conversationId = rb.currentChat?.id;
    if ((!texts.length && !files.length) || !conversationId) return runNow(macro);

    try {
      if (rb.isPrivate) {
        rb.setReplyMode('reply');
        await rb.$nextTick(); // let the reply-mode switch load its draft first, then add to it
      }
      const vars = rb.messageVariables || {};
      if (texts.length) insertText(rb, fill(texts.join('\n\n'), vars));
      files.forEach(a => attachFile(rb, macro, (a.action_params || [])[0]));

      const rest = actions.filter(a => a.action_name !== TEXT && a.action_name !== FILE);
      if (rest.length) {
        const job = pending.get(conversationId) || { names: [], actions: [], vars };
        job.names.push(macro.name.trim());
        job.actions.push(...rest);
        job.vars = vars;
        pending.set(conversationId, job);
      }
      renderBar();
    } catch (e) {
      console.error('[rstm-macros]', e);
      toast('Makro konnte nicht eingefügt werden, es wird direkt ausgeführt.', true);
      runNow(macro);
    }
  }

  // {{contact.first_name}} etc., same variables Chatwoot uses for canned responses. An empty value also drops the
  // space before it ("Hallo {{contact.first_name}}," -> "Hallo,"). Unknown variables stay, Chatwoot warns on send.
  function fill(text, vars) {
    return text.replace(/( ?)\{\{\s*([\w.]+)\s*\}\}/g, (match, space, key) => {
      if (!(key in vars)) return match;
      const value = vars[key];
      return value ? space + value : '';
    });
  }

  function insertText(rb, text) {
    const signatureOnly = rb.toggleSignatureForDraft('').trim();
    let draft = (rb.message || '').trim();
    if (signatureOnly && draft.endsWith(signatureOnly)) draft = draft.slice(0, -signatureOnly.length).trim();
    if (draft && /[-_*]{3}$/.test(draft)) draft = draft.replace(/[-_*]{3}$/, '').trim(); // leftover signature delimiter
    rb.message = rb.toggleSignatureForDraft(draft ? `${draft}\n\n${text}` : text);
  }

  async function attachFile(rb, macro, blobId) {
    const meta = (macro.files || []).find(f => String(f.blob_id) === String(blobId));
    if (!meta) return toast('Ein Anhang des Makros fehlt, bitte von Hand anhängen.', true);
    try {
      // proxy URL: served by Rails itself, no cross-origin redirect to the bucket
      const url = meta.file_url.replace('/rails/active_storage/blobs/redirect/', '/rails/active_storage/blobs/proxy/');
      const res = await fetch(url, { credentials: 'same-origin' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const file = new File([blob], meta.filename || 'Anhang', { type: blob.type || meta.file_type || '' });
      rb.onFileUpload({ name: file.name, type: file.type, size: file.size, file });
    } catch (e) {
      console.error('[rstm-macros]', e);
      toast(`Anhang "${meta.filename}" konnte nicht angehängt werden.`, true);
    }
  }

  // ---------- running the rest when the reply is sent ----------

  function hookStore() {
    const store = getStore();
    if (!store || store.__rstmMacros) return;
    store.__rstmMacros = true;
    store.subscribeAction({
      // fires only after the API accepted the message (sendMessageWithData throws on failure)
      after: action => {
        if (action.type !== 'sendMessageWithData') return;
        const message = action.payload || {};
        if (message.private) return;
        const job = pending.get(message.conversation_id);
        if (!job) return;
        pending.delete(message.conversation_id);
        renderBar();
        runActions(message.conversation_id, job);
      },
    });
  }

  async function runActions(conversationId, job) {
    const store = getStore();
    const ordered = [
      ...job.actions.filter(a => !STATUS_ACTIONS.includes(a.action_name)),
      ...job.actions.filter(a => STATUS_ACTIONS.includes(a.action_name)), // status last
    ];
    const failed = [];
    for (const action of ordered) {
      const params = action.action_params || [];
      try {
        switch (action.action_name) {
          case 'add_label':
          case 'remove_label': {
            const current = store.getters['conversationLabels/getConversationLabels'](conversationId) || [];
            const labels = action.action_name === 'add_label'
              ? [...new Set([...current, ...params])]
              : current.filter(l => !params.includes(l));
            await store.dispatch('conversationLabels/update', { conversationId, labels });
            break;
          }
          case 'add_private_note':
            await store.dispatch('createPendingMessageAndSend', {
              conversationId, message: fill(params[0] || '', job.vars), private: true,
            });
            break;
          case 'change_status':
            await store.dispatch('toggleStatus', { conversationId, status: statusName(params[0]) });
            break;
          case 'resolve_conversation':
            await store.dispatch('toggleStatus', { conversationId, status: 'resolved' });
            break;
          case 'assign_agent':
            await store.dispatch('assignAgent', { conversationId, agentId: params[0] === 'self' ? store.getters.getCurrentUserID : params[0] });
            break;
          case 'assign_team':
            await store.dispatch('assignTeam', { conversationId, teamId: params[0] });
            break;
          case 'change_priority':
            await store.dispatch('assignPriority', { conversationId, priority: params[0] });
            break;
          default:
            failed.push(describe(action));
        }
      } catch (e) {
        console.error('[rstm-macros]', e);
        failed.push(describe(action));
      }
    }
    if (failed.length) toast(`Bitte von Hand erledigen: ${failed.join(', ')}`, true);
    else toast(`Makro-Aktionen ausgeführt: ${ordered.map(describe).join(', ')}`);
  }

  function statusName(value) {
    return { 0: 'open', 1: 'resolved', 2: 'pending', 3: 'snoozed' }[value] || value || 'resolved';
  }

  // ---------- bar above the reply box ----------

  const STATUS_DE = { open: 'offen', resolved: 'gelöst', pending: 'ausstehend', snoozed: 'zurückgestellt' };

  function describe(action) {
    const p = action.action_params || [];
    switch (action.action_name) {
      case 'add_label': return `Label + ${p.join(', ')}`;
      case 'remove_label': return `Label − ${p.join(', ')}`;
      case 'add_private_note': return 'interne Notiz';
      case 'change_status': return `Status → ${STATUS_DE[statusName(p[0])] || statusName(p[0])}`;
      case 'resolve_conversation': return 'Status → gelöst';
      case 'assign_agent': return 'Agent zuweisen';
      case 'assign_team': return 'Team zuweisen';
      case 'change_priority': return `Priorität → ${p[0]}`;
      default: return action.action_name;
    }
  }

  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function renderBar() {
    const box = document.querySelector('.reply-box');
    const id = replyBox()?.proxy?.currentChat?.id;
    const job = id && pending.get(id);
    let bar = document.getElementById('rstm-macro-bar');
    if (!box || !job) {
      bar?.remove();
      return;
    }
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'rstm-macro-bar';
      bar.addEventListener('click', onBarClick);
    }
    if (bar.nextElementSibling !== box) box.parentNode.insertBefore(bar, box);
    const key = `${id}|${job.names.join('|')}|${job.actions.length}`;
    if (bar.dataset.key === key) return;
    bar.dataset.key = key;
    bar.dataset.conversation = id;
    bar.innerHTML =
      `<span class="rstm-mb-title">⚡ ${esc(job.names.join(' + '))}</span>` +
      `<span class="rstm-mb-when">beim Senden:</span>` +
      job.actions.map(a => `<span class="rstm-mb-chip">${esc(describe(a))}</span>`).join('') +
      '<span class="rstm-mb-spacer"></span>' +
      '<button type="button" data-rstm="now">Jetzt ausführen</button>' +
      '<button type="button" data-rstm="drop" title="Aktionen verwerfen (Text bleibt)">Verwerfen</button>';
  }

  function onBarClick(event) {
    const button = event.target.closest('button[data-rstm]');
    if (!button) return;
    const id = Number(event.currentTarget.dataset.conversation);
    const job = pending.get(id);
    pending.delete(id);
    renderBar();
    if (job && button.dataset.rstm === 'now') runActions(id, job);
  }

  function toast(text, warn) {
    const el = document.createElement('div');
    el.className = `rstm-mb-toast${warn ? ' rstm-mb-warn' : ''}`;
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), warn ? 8000 : 4000);
  }

  const style = document.createElement('style');
  style.textContent = `
    #rstm-macro-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 0 0 6px; padding: 6px 10px;
      border-radius: 10px; border: 1px solid rgba(59,130,246,.35); background: rgba(59,130,246,.10); font-size: 12px; line-height: 18px; }
    #rstm-macro-bar .rstm-mb-title { font-weight: 600; }
    #rstm-macro-bar .rstm-mb-when { opacity: .7; }
    #rstm-macro-bar .rstm-mb-chip { padding: 0 8px; border-radius: 999px; background: rgba(59,130,246,.18); }
    #rstm-macro-bar .rstm-mb-spacer { flex: 1; }
    #rstm-macro-bar button { padding: 1px 10px; border-radius: 8px; border: 1px solid rgba(59,130,246,.45); background: transparent;
      font-size: 12px; cursor: pointer; color: inherit; }
    #rstm-macro-bar button:hover { background: rgba(59,130,246,.18); }
    .rstm-mb-toast { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); z-index: 10000; max-width: 640px;
      padding: 8px 14px; border-radius: 10px; background: #1f2937; color: #fff; font-size: 13px; box-shadow: 0 6px 24px rgba(0,0,0,.25); }
    .rstm-mb-toast.rstm-mb-warn { background: #b45309; }
  `;
  document.head.appendChild(style);

  setInterval(() => {
    hookStore();
    patchReplyBox();
    renderBar();
  }, 700);
})();
