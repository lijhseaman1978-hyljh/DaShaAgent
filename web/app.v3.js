// DaShaAgent 前端 — P0-P3 UI + 完整面板渲染 — 2026-08-05
const $ = (id) => document.getElementById(id);
let ws = null, busy = false;
let sessionId = localStorage.getItem('ah_session') || ('sess_' + Date.now());
let currentModelId = null, modelGroups = [], currentView = 'chat';
let _customModels = [];
let activeAssistEl = null, activeActsEl = null, activeThoughtEl = null;
let pendingAttachments = [];
const chat = $('chat'), input = $('input'), sendBtn = $('sendBtn');
const hasMarked = typeof marked !== 'undefined';
const hasHljs = typeof hljs !== 'undefined';
const hasDOMPurify = typeof DOMPurify !== 'undefined';
var _themeMode = localStorage.getItem('ah_theme') || 'system';  // light | dark | system
function syncHljsTheme(dark) { const l = $('hljs-light'), d = $('hljs-dark'); if (l) l.disabled = dark; if (d) d.disabled = !dark; }

function escapeHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function renderMarkdown(text) { if (!text) return ''; var e = escapeHtml(text); e = e.replace(/```(\w*)\n?([\s\S]*?)```/g, function(m, lang, code) { return '<pre><code>' + code.replace(/\n$/, '') + '</code></pre>'; }); e = e.replace(/`([^`\n]+)`/g, '<code>$1</code>'); e = e.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>'); return e; }
function renderMarkdownFull(text) { if (!text) return ''; if (hasMarked) { try { marked.setOptions({ breaks: true, gfm: true }); var raw = marked.parse(text); if (hasDOMPurify) { try { return DOMPurify.sanitize(raw); } catch (e) {} } return renderMarkdown(text); } catch (e) {} } return renderMarkdown(text); }
function fmtTime(ts) { if (!ts) return ''; var d = new Date(ts), diff = Date.now() - d.getTime(); var min = 60000, hour = 3600000, day = 86400000; if (diff < 0 || diff > 365 * day) return d.toLocaleString('zh-CN', { hour12: false }); if (diff < min) return '刚刚'; if (diff < hour) return Math.floor(diff / min) + ' 分钟前'; if (diff < day) return Math.floor(diff / hour) + ' 小时前'; if (diff < 7 * day) return Math.floor(diff / day) + ' 天前'; return d.toLocaleString('zh-CN', { hour12: false }); }
function updateSessionTitle(t) { var el = $('sessionTitle'); if (el) el.textContent = t || '新对话'; }
function updateMsgCount() { var el = $('msgCount'); if (!el) return; el.textContent = chat.querySelectorAll('.msg').length + ' 条'; }
function fmtUptime(s) { s = Math.floor(s); var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60; return (h ? h + '小时' : '') + m + '分' + sec + '秒'; }
function showToast(msg, type) { type = type || ''; var c = $('toastContainer'); if (!c) return; var t = document.createElement('div'); t.className = 'toast toast-' + type; t.innerHTML = '<span>' + escapeHtml(msg) + '</span><button class="toast-close" aria-label="关闭">X</button>'; t.querySelector('.toast-close').onclick = function() { t.remove(); }; c.appendChild(t); setTimeout(function() { if (t.parentNode) t.remove(); }, 3000); }
function enhanceCodeBlocks(container) { if (!container) return; var pres = container.querySelectorAll('pre'); for (var p = 0; p < pres.length; p++) { var pre = pres[p]; if (pre.parentElement && pre.parentElement.classList.contains('code-block-wrapper')) continue; var code = pre.querySelector('code'), lang = code ? (code.className.replace('language-', '') || '') : ''; var wrapper = document.createElement('div'); wrapper.className = 'code-block-wrapper'; if (lang) { var lt = document.createElement('div'); lt.className = 'code-lang'; lt.textContent = lang; wrapper.appendChild(lt); } var cbtn = document.createElement('button'); cbtn.className = 'copy-btn'; cbtn.textContent = '复制'; cbtn.onclick = function() { var txt = code ? code.textContent : pre.textContent || ''; navigator.clipboard.writeText(txt).then(function() { cbtn.textContent = '已复制'; cbtn.classList.add('copied'); setTimeout(function() { cbtn.textContent = '复制'; cbtn.classList.remove('copied'); }, 1500); }).catch(function() { var ta = document.createElement('textarea'); ta.value = txt; ta.style.cssText = 'position:fixed;left:-9999px'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); cbtn.textContent = '已复制'; cbtn.classList.add('copied'); setTimeout(function() { cbtn.textContent = '复制'; cbtn.classList.remove('copied'); }, 1500); }); }; wrapper.appendChild(cbtn); pre.parentNode.insertBefore(wrapper, pre); wrapper.appendChild(pre); if (hasHljs && code) { try { hljs.highlightElement(code); } catch {} } } }

var currentTokens = 0;
function estimateTokensJS(text) { if (!text) return 0; var cjk = 0, other = 0; for (var i = 0; i < text.length; i++) { var code = text.charCodeAt(i); if ((code >= 0x2e80 && code <= 0xfaff) || (code >= 0xff00 && code <= 0xffef) || (code >= 0x3000 && code <= 0x303f)) cjk++; else other++; } return Math.ceil(cjk + other / 4); }
var CTX_WARN = 4000, CTX_DANGER = 10000;
function updateCtxBadge(extraDraft) { extraDraft = extraDraft || 0; var el = $('ctxTokens'); if (!el) return; var total = currentTokens + extraDraft; var pct = Math.min(100, Math.round(total / CTX_DANGER * 100)); el.classList.toggle('warn', total >= CTX_WARN && total < CTX_DANGER); el.classList.toggle('danger', total >= CTX_DANGER); el.innerHTML = '<span class="ctx-bar" style="width:' + pct + '%"></span><span class="ctx-txt">上下文 ~' + total.toLocaleString() + ' tokens</span>'; }
async function refreshTokens() { try { var d = await fetch('/api/sessions/' + encodeURIComponent(sessionId) + '/tokens').then(function(r) { return r.json(); }); currentTokens = d.tokens || 0; updateCtxBadge(0); } catch {} }
function updateInputTokens() { var el = $('tokenCounter'); if (!el) return; var n = estimateTokensJS(input.value); el.textContent = n.toLocaleString() + ' tokens'; el.classList.toggle('warn', n > 2000); el.classList.toggle('danger', n > 4000); }

var scrollRAF = null, _userScrolledUp = false;
function isNearBottom() { return chat.scrollHeight - chat.scrollTop - chat.clientHeight < 80; }
function scrollDown(force) {
  // double-RAF: first frame lets layout settle, second applies the scroll
  if (scrollRAF) cancelAnimationFrame(scrollRAF);
  scrollRAF = requestAnimationFrame(function() {
    scrollRAF = requestAnimationFrame(function() {
      scrollRAF = null;
      if (force || !_userScrolledUp || isNearBottom()) {
        chat.scrollTop = chat.scrollHeight;
      }
      var btn = $('scrollToBottomBtn');
      if (btn) btn.hidden = isNearBottom();
    });
  });
}
chat.addEventListener('scroll', function() { _userScrolledUp = !isNearBottom(); var btn = $('scrollToBottomBtn'); if (btn) btn.hidden = !_userScrolledUp; });
var stbb = $('scrollToBottomBtn'); if (stbb) stbb.addEventListener('click', function() { _userScrolledUp = false; scrollDown(true); });

function addMsgActions(el, role, rawText) { var a = document.createElement('div'); a.className = 'msg-actions'; var cb = document.createElement('button'); cb.className = 'msg-act-btn'; cb.textContent = '复制'; cb.title = '复制'; cb.onclick = function(e) { e.stopPropagation(); var txt = rawText || (el.querySelector('.bubble') ? el.querySelector('.bubble').textContent : ''); if (navigator.clipboard) { navigator.clipboard.writeText(txt).then(function() { showToast('已复制', 'success'); }).catch(function() { showToast('复制失败', 'error'); }); } }; a.appendChild(cb); if (role === 'assistant') { var sb = document.createElement('button'); sb.className = 'msg-act-btn speak-btn'; sb.textContent = '朗读'; sb.title = '朗读 / 停止'; sb.onclick = function(e) { e.stopPropagation(); var txt = el.querySelector('.bubble') ? el.querySelector('.bubble').textContent : ''; toggleSpeak(el, sb, txt); }; a.appendChild(sb); } if (role === 'user') { var eb = document.createElement('button'); eb.className = 'msg-act-btn'; eb.textContent = '编辑'; eb.title = '编辑并重发（截断后续对话）'; eb.onclick = function(e) { e.stopPropagation(); editAndResend(el, rawText || ''); }; a.appendChild(eb); } var db = document.createElement('button'); db.className = 'msg-act-btn'; db.textContent = '删除'; db.title = '删除本条及后续对话'; db.onclick = function(e) { e.stopPropagation(); deleteFrom(el); }; a.appendChild(db); var _main = el.querySelector('.msg-main'); if (_main) { _main.appendChild(a); } else { el.appendChild(a); } }

function appendActivity(ev) { if (!activeAssistEl) return; if (!activeActsEl) { activeActsEl = document.createElement('div'); activeActsEl.className = 'acts'; activeAssistEl.appendChild(activeActsEl); } var labelMap = { tool_start: 'TOOL', tool_end: 'DONE', tool_error: 'ERR', thought: 'THINK', info: 'INFO' }; var label = labelMap[ev.type] || 'INFO', tc = 'tag tag-' + (ev.type || 'info'); var d = document.createElement('details'); d.className = 'tool-call act act-' + (ev.type || 'info'); d.innerHTML = '<summary><span class="' + tc + '">' + label + '</span><span>' + escapeHtml(ev.message) + '</span></summary>'; if (ev.detail) { var body = document.createElement('div'); body.className = 'tool-body'; body.textContent = typeof ev.detail === 'string' ? ev.detail : JSON.stringify(ev.detail, null, 2); d.appendChild(body); } activeActsEl.appendChild(d); scrollDown(); }

function addMsg(role, text) { var el = document.createElement('div'); el.className = 'msg ' + role; var label = role === 'user' ? (chatUI.labelUser || '你') : role === 'assistant' ? (chatUI.labelAgent || '助手') : '系统'; el.setAttribute('aria-label', label + '消息'); if (role !== 'system') { var avEl = document.createElement('div'); avEl.className = 'msg-avatar'; renderAvatarInto(avEl, role); avEl.setAttribute('aria-hidden', 'true'); el.appendChild(avEl); } var main = document.createElement('div'); main.className = 'msg-main'; main.innerHTML = '<div class="who">' + label + '</div><div class="bubble"></div>'; if (role === 'assistant' && !text) { main.querySelector('.bubble').innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div>'; } else { main.querySelector('.bubble').innerHTML = renderMarkdownFull(text); enhanceCodeBlocks(main.querySelector('.bubble')); } el.appendChild(main); chat.appendChild(el); addMsgActions(el, role, text); updateMsgCount(); scrollDown(true); return el; }
function removeTypingIndicator(el) { if (!el) return; var ind = el.querySelector('.typing-indicator'); if (ind) ind.remove(); }
function appendThought(text) { if (!activeAssistEl) return; if (!activeThoughtEl) { activeThoughtEl = document.createElement('div'); activeThoughtEl.className = 'thought'; activeThoughtEl.innerHTML = '<span class="thought-label">思考</span><span class="thought-text"></span>'; activeAssistEl.insertBefore(activeThoughtEl, activeAssistEl.querySelector('.bubble')); } activeThoughtEl.querySelector('.thought-text').textContent += text; scrollDown(); }

var _wasDisconnected = false;
function connect() { var proto = location.protocol === 'https:' ? 'wss' : 'ws'; ws = new WebSocket(proto + '://' + location.host + '/ws'); ws.onopen = function() { setConn('已连接', 'ok'); if (_wasDisconnected) { showToast('已重新连接', 'success'); _wasDisconnected = false; } }; ws.onclose = function() { setConn('断开，重连中…', 'bad'); if (!_wasDisconnected) { showToast('连接已断开，正在重连…', 'warning'); _wasDisconnected = true; } setTimeout(connect, 2000); }; ws.onmessage = function(e) { var m; try { m = JSON.parse(e.data); } catch { return; } if (m.type === 'ready') { setConn('已连接 · ' + m.provider, 'ok'); if (_wasDisconnected) { showToast('已重新连接', 'success'); _wasDisconnected = false; } } else if (m.type === 'token') { if (activeAssistEl) { removeTypingIndicator(activeAssistEl); var bub = activeAssistEl.querySelector('.bubble'); bub.innerHTML += renderMarkdown(m.text); bub.classList.add('streaming'); setTimeout(function() { bub.classList.remove('streaming'); }, 600); enhanceCodeBlocks(bub); chat.scrollTop = chat.scrollHeight; } } else if (m.type === 'thought') { if (activeAssistEl) appendThought(m.text); } else if (m.type === 'activity') appendActivity(m.ev); else if (m.type === 'done') { if (activeAssistEl && m.content) { removeTypingIndicator(activeAssistEl); activeAssistEl.querySelector('.bubble').innerHTML = renderMarkdownFull(m.content); enhanceCodeBlocks(activeAssistEl.querySelector('.bubble')); } scrollDown(true); finishTurn(); } else if (m.type === 'error') { addMsg('system', '错误: ' + m.message); finishTurn(); } else if (m.type === 'busy') addMsg('system', m.message); }; }
function setConn(text, cls) { var c = $('conn'); c.textContent = text; c.className = 'conn ' + (cls || ''); }
var SEND_SVG = "<svg viewBox='0 0 24 24' width='18' height='18' fill='currentColor' aria-hidden='true'><path d='M3.4 20.4l17.45-7.48a1 1 0 0 0 0-1.84L3.4 3.6a.993.993 0 0 0-1.39.91L2 9.12c0 .5.37.93.87.99L17 12 2.87 13.88c-.5.07-.87.5-.87 1l.01 4.61c0 .71.73 1.2 1.39.91z'/></svg>";
function setBusy(b) { busy = b; sendBtn.classList.toggle('stop', b); var si = sendBtn.querySelector('.send-icon'); if (si) { if (b) { si.textContent = '\u25a0'; } else { si.innerHTML = SEND_SVG; } } sendBtn.title = b ? '停止' : '发送'; }
function finishTurn() { activeAssistEl = null; activeActsEl = null; activeThoughtEl = null; setBusy(false); refreshSessions(); refreshTokens(); }

$('exportBtn').onclick = function() { var msgs = chat.querySelectorAll('.msg'); if (!msgs.length) { showToast('没有可导出的消息', 'warning'); return; } var md = '# AGENT HARNESS Chat\n\n> ' + new Date().toLocaleString('zh-CN') + '\n> Session: ' + sessionId + '\n\n---\n\n'; for (var i = 0; i < msgs.length; i++) { var m = msgs[i]; var role = m.classList.contains('user') ? '**User**' : m.classList.contains('assistant') ? '**AI**' : '**System**'; md += '### ' + role + '\n\n' + (m.querySelector('.bubble') ? m.querySelector('.bubble').textContent : '') + '\n\n'; } var blob = new Blob([md], { type: 'text/markdown' }); var url = URL.createObjectURL(blob); var a = document.createElement('a'); a.href = url; a.download = 'chat_' + new Date().toISOString().slice(0, 10) + '.md'; a.click(); URL.revokeObjectURL(url); showToast('导出完成', 'success'); };

function send(content) { if (busy || (!content.trim() && !pendingAttachments.length)) return; var es = $('emptyState'); if (es) es.remove(); setBusy(true); var userEl = addMsg('user', content); renderAttachInBubble(userEl, pendingAttachments); _userScrolledUp = false; activeAssistEl = addMsg('assistant', ''); activeActsEl = null; ws.send(JSON.stringify({ type: 'chat', content: content, sessionId: sessionId, modelId: currentModelId || undefined, attachments: pendingAttachments.map(function(a) { return { name: a.name, path: a.path, size: a.size, mime: a.mime, text: a.text }; }) })); pendingAttachments = []; renderAttachArea(); updateCtxBadge(0); }
function sendStop() { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'stop' })); }
sendBtn.onclick = function() { if (busy) sendStop(); else { var v = input.value; input.value = ''; autosize(); send(v); } };
document.addEventListener('keydown', function(e) { if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'n')) { e.preventDefault(); newChat(); } if (e.key === 'Escape' && busy) { e.preventDefault(); sendStop(); } if (e.key === 'Escape' && !busy) $('modelDropdown').hidden = true; });
input.addEventListener('keydown', function(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); var v = input.value; input.value = ''; autosize(); send(v); } });
input.addEventListener('input', function() { autosize(); updateCtxBadge(estimateTokensJS(input.value)); updateInputTokens(); });
function autosize() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 160) + 'px'; }

var MAX_UPLOAD = 500 * 1024 * 1024;
var TEXT_EXT = new Set(['txt','md','markdown','json','csv','tsv','xml','log','yaml','yml','ini','toml','html','htm','css','js','jsx','ts','tsx','py','java','c','cpp','h','hpp','go','rs','sh','bat','ps1','sql','tex','r','rb','php','vue','gitignore']);
function isTextFile(name) { return TEXT_EXT.has((name.split('.').pop() || '').toLowerCase()); }
function fmtBytes(b) { if (b >= 1048576) return (b / 1048576).toFixed(1) + 'MB'; if (b >= 1024) return (b / 1024).toFixed(0) + 'KB'; return b + 'B'; }
function renderAttachArea() { var area = $('attachArea'); if (!area) return; area.innerHTML = ''; for (var i = 0; i < pendingAttachments.length; i++) { (function(idx) { var a = pendingAttachments[idx]; var chip = document.createElement('span'); chip.className = 'chip'; chip.innerHTML = '<span class="chip-ico">' + (a.kind || 'file') + '</span><span class="chip-name">' + escapeHtml(a.name) + '</span><span class="chip-size">' + fmtBytes(a.size) + '</span><span class="chip-x">X</span>'; chip.querySelector('.chip-x').onclick = function() { pendingAttachments.splice(idx, 1); renderAttachArea(); }; area.appendChild(chip); })(i); } }
function uploadFileWithProgress(file, onProgress, onDone) { var xhr = new XMLHttpRequest(), fd = new FormData(); fd.append('file', file, file.name); fd.append('sessionId', sessionId); xhr.open('POST', '/api/upload'); xhr.upload.onprogress = function(e) { if (e.lengthComputable && onProgress) onProgress(e.loaded, e.total); }; xhr.onload = function() { try { onDone(null, JSON.parse(xhr.responseText)); } catch (err) { onDone(err); } }; xhr.onerror = function() { onDone(new Error('Network error')); }; xhr.send(fd); return xhr; }
async function handleFiles(fileList) { for (var i = 0; i < fileList.length; i++) { (function(file) { if (file.size > MAX_UPLOAD) { showToast('超过500MB: ' + file.name, 'warning'); return; } var text = undefined, tp = Promise.resolve(); if (isTextFile(file.name) && file.size <= 200*1024) { tp = file.text().then(function(t) { text = t.length > 120000 ? t.slice(0, 120000) + '\n...(truncated)' : t; }).catch(function() {}); } var area = $('attachArea'); var prog = document.createElement('div'); prog.className = 'upload-progress'; prog.innerHTML = '<span class="up-name">' + escapeHtml(file.name) + '</span><span class="up-bar"><span class="up-bar-fill" style="width:0%"></span></span><span class="up-pct">0%</span><button class="up-cancel">X</button>'; area.appendChild(prog); var cancelled = false; prog.querySelector('.up-cancel').onclick = function() { cancelled = true; xhr.abort(); prog.remove(); }; var xhr = uploadFileWithProgress(file, function(loaded,total) { var pct = Math.round(loaded/total*100); prog.querySelector('.up-bar-fill').style.width = pct + '%'; prog.querySelector('.up-pct').textContent = pct + '%'; }, function(err,d) { prog.remove(); if (cancelled) return; if (err||!d||!d.ok) { showToast('上传失败: ' + (d&&d.error?d.error:file.name), 'error'); return; } tp.then(function() { pendingAttachments.push({ name:d.name, path:d.path, size:d.size, mime:d.mime, kind:d.kind, text:text }); renderAttachArea(); }); }); })(fileList[i]); } }
$('attachBtn').onclick = function() { $('fileInput').click(); };
$('fileInput').onchange = function(e) { handleFiles(e.target.files); e.target.value = ''; };
['dragenter', 'dragover'].forEach(function(ev) { chat.addEventListener(ev, function(e) { e.preventDefault(); $('dropOverlay').hidden = false; }); });
chat.addEventListener('dragleave', function(e) { if (e.target === chat) $('dropOverlay').hidden = true; });
chat.addEventListener('drop', function(e) { e.preventDefault(); $('dropOverlay').hidden = true; if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) handleFiles(e.dataTransfer.files); });
function renderAttachInBubble(el, list) { if (!list || !list.length) return; var wrap = document.createElement('div'); wrap.className = 'attach-in-msg'; for (var i = 0; i < list.length; i++) { var a = list[i]; var chip = document.createElement('span'); chip.className = 'chip'; chip.innerHTML = '<span class="chip-ico">' + (a.kind||'file') + '</span><span class="chip-name">' + escapeHtml(a.name) + '</span><span class="chip-size">' + fmtBytes(a.size) + '</span>'; wrap.appendChild(chip); } el.querySelector('.bubble').appendChild(wrap); }

function loadModels() { return fetch('/api/models').then(function(r) { return r.json(); }).then(function(d) { modelGroups = d.groups || []; if (!currentModelId && d.activeModelId) currentModelId = d.activeModelId; if (!currentModelId && modelGroups[0] && modelGroups[0].providers && modelGroups[0].providers[0] && modelGroups[0].providers[0].models[0]) currentModelId = modelGroups[0].providers[0].models[0].id; renderModelGroups(''); updateModelTrigger(); var fm = $('footModel'); if (fm) fm.textContent = labelOf(currentModelId) || '—'; }); }
function labelOf(id) { for (var i = 0; i < modelGroups.length; i++) { var g = modelGroups[i]; if (!g.providers) continue; for (var j = 0; j < g.providers.length; j++) { var m = g.providers[j].models.find(function(x) { return x.id === id; }); if (m) return m.label; } } return null; }
// 模型树折叠状态：key = 根id + '::' + provider id；默认折叠，但含当前选中模型的 provider 自动展开
var collapsedProvs = {};
function isProvOpen(gid, pid) {
  if (collapsedProvs[gid + '::' + pid] === false) return false;  // 显式折叠
  // 默认展开：包含当前选中模型的 provider，或处于搜索状态
  if (currentModelId && pid) {
    // 在 provider 内找当前模型
    for (var i = 0; i < modelGroups.length; i++) {
      if (modelGroups[i].id !== gid) continue;
      for (var j = 0; j < modelGroups[i].providers.length; j++) {
        if (modelGroups[i].providers[j].id !== pid) continue;
        for (var k = 0; k < modelGroups[i].providers[j].models.length; k++) {
          if (modelGroups[i].providers[j].models[k].id === currentModelId) return true;
        }
      }
    }
  }
  return collapsedProvs[gid + '::' + pid] === true;
}
function toggleProv(gid, pid, ev) {
  if (ev) ev.stopPropagation();  // 关键：阻止冒泡到 document，避免弹窗被误关
  var key = gid + '::' + pid;
  collapsedProvs[key] = !isProvOpen(gid, pid);
  var f = $('modelSearch'); renderModelGroups(f ? f.value : '');
}
function renderModelGroups(filter) {
  var wrap = $('modelGroups'); wrap.innerHTML = '';
  var f = filter.trim().toLowerCase();
  for (var i = 0; i < modelGroups.length; i++) {
    var g = modelGroups[i]; if (!g.providers) continue;
    var gl = document.createElement('div'); gl.className = 'model-group-label'; gl.textContent = g.label; wrap.appendChild(gl);
    for (var j = 0; j < g.providers.length; j++) {
      var p = g.providers[j];
      var items = p.models.filter(function(m) { return !f || m.label.toLowerCase().includes(f); });
      if (!items.length) continue;
      var open = f ? true : isProvOpen(g.id, p.id);
      // Provider 行：可点击展开/折叠
      var pl = document.createElement('div');
      pl.className = 'model-provider-label model-provider-toggle';
      pl.innerHTML = '<span class="prov-arrow">' + (open ? '▾' : '▸') + '</span><span>' + escapeHtml(p.label) + '</span><span class="prov-count">' + items.length + '</span>';
      pl.onclick = (function(gid, pid) { return function(ev) { toggleProv(gid, pid, ev); }; })(g.id, p.id);
      wrap.appendChild(pl);
      if (open) {
        for (var k = 0; k < items.length; k++) {
          var m = items[k];
          var it = document.createElement('div');
          it.className = 'model-item' + (m.id === currentModelId ? ' selected' : '');
          it.setAttribute('role', 'option');
          it.innerHTML = '<span class="mi-dot"></span><span>' + escapeHtml(m.label) + '</span>';
          it.onclick = (function(id) { return function() { selectModel(id); }; })(m.id);
          wrap.appendChild(it);
        }
      }
    }
  }
}
function selectModel(id) { currentModelId = id; updateModelTrigger(); $('modelDropdown').hidden = true; var lbl = labelOf(id); if (lbl) setConn('已连接 · ' + lbl, 'ok'); var fm = $('footModel'); if (fm) fm.textContent = lbl || '—'; fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ activeModelId: id }) }).catch(function() {}); }
function updateModelTrigger() { $('modelName').textContent = labelOf(currentModelId) || '选择模型…'; }
$('modelTrigger').onclick = function(e) { e.stopPropagation(); var d = $('modelDropdown'); d.hidden = !d.hidden; if (!d.hidden) $('modelSearch').focus(); };
$('modelSearch').oninput = function(e) { renderModelGroups(e.target.value); };
document.addEventListener('click', function(e) {
  if (!document.contains(e.target)) return;  // 元素已被重建移除（如展开 provider 时），不误关弹窗
  if (!$('modelSelect').contains(e.target)) $('modelDropdown').hidden = true;
});
$('modelSettingsLink').onclick = function() { var dd = $('modelDropdown'); if (dd) dd.hidden = true; showAddModelDialog(); };

function newChat() { switchView('chat'); sessionId = 'sess_' + Date.now(); localStorage.setItem('ah_session', sessionId); chat.innerHTML = ''; var es = document.createElement('div'); es.className = 'empty'; es.id = 'emptyState'; es.innerHTML = '<div class="empty-logo"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="3.5" r="1.3" fill="currentColor" stroke="none"/><circle cx="20.5" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="3.5" cy="12" r="1.3" fill="currentColor" stroke="none"/><path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2"/></svg></div><h2>示例用户船长专属工作台</h2><p>调用工具、检索记忆、多智能体协作 —— 你的个人 AI 工作台。</p><div class="empty-hint">直接在下方输入，或点左侧对话/新建对话开始。可拖拽任意文件到此处上传（≤500MB）。</div><div class="prompt-chips"><button class="prompt-chip" data-prompt="帮我总结今天的重点工作">📋 总结今日工作</button><button class="prompt-chip" data-prompt="查询 EXAMPLE_VESSEL 船舶的最新状态">🚢 查询船舶状态</button><button class="prompt-chip" data-prompt="帮我写一篇公众号文章">✍️ 写公众号文章</button><button class="prompt-chip" data-prompt="检索我的记忆库，看看有什么需要注意的">🧠 检索记忆库</button></div>'; chat.appendChild(es); refreshSessions(); currentTokens = 0; updateCtxBadge(0); input.focus(); updateSessionTitle('示例用户船长专属工作台'); updateMsgCount(); showToast('已创建新对话', 'success'); setTimeout(function() { document.querySelectorAll('.prompt-chip').forEach(function(c) { c.onclick = function() { input.value = this.dataset.prompt; autosize(); send(input.value); input.value = ''; autosize(); }; }); }, 100); }
function loadSession(id) { sessionId = id; localStorage.setItem('ah_session', sessionId); fetch('/api/session/' + encodeURIComponent(id)).then(function(r) { return r.json(); }).then(function(s) { if (!s || !s.messages) return; chat.innerHTML = ''; var msgs = s.messages.filter(function(m) { return ['user', 'assistant', 'system'].includes(m.role) && !m.hidden; }); for (var i = 0; i < msgs.length; i++) addMsg(msgs[i].role, msgs[i].content || ''); refreshSessions(); refreshTokens(); updateSessionTitle(s.title || '对话'); updateMsgCount(); }).catch(function() {}); }
function refreshSessions() { if (currentView === 'history') renderHistory(); }

$('newChatBtn').onclick = function() { newChat(); };
var _sideNewChat = $('sideNewChatBtn'); if (_sideNewChat) _sideNewChat.onclick = function() { newChat(); };
var _refreshTop = $('refreshTopBtn'); if (_refreshTop) _refreshTop.onclick = function() { loadModels(); refreshTokens(); showToast('已刷新', 'success'); };
$('teamBtn').onclick = function() { var task = prompt('多智能体任务:'); if (!task) return; addMsg('system', '启动多智能体任务: ' + task); ws.send(JSON.stringify({ type: 'team', task: task, sessionId: sessionId })); };
$('jobBtn').onclick = function() { addMsg('system', '执行每日简报…'); ws.send(JSON.stringify({ type: 'job', name: 'daily_brief', sessionId: sessionId })); };

/* ─── 压缩 (HTTP fallback) ─── */
$('compressBtn').onclick = async function() {
  if (busy) return;
  if (!confirm('将把当前对话的历史压缩为一份摘要（保留最近若干轮），以节省上下文 Token。确认压缩？')) return;
  var btn = $('compressBtn'), orig = btn.textContent;
  btn.disabled = true; btn.textContent = '压缩中…'; showToast('正在压缩上下文…');
  try {
    var r = await fetch('/api/sessions/' + encodeURIComponent(sessionId) + '/compress', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ modelId: currentModelId || undefined }) }).then(function(x) { return x.json(); });
    if (r.ok) { showToast(r.fallback ? '上下文已压缩（本地摘要，模型暂不可用）' : '上下文已压缩'); loadSession(sessionId); }
    else showToast('压缩失败：' + (r.error || ''));
  } catch { showToast('压缩失败：网络错误'); }
  finally { btn.disabled = false; btn.textContent = orig; }
};

/* ─── 设置 ─── */
function openSettings() { switchView('settings'); }

function renderCustomList(list) {
  var wrap = $('customList'); if (!wrap) return; wrap.innerHTML = '';
  for (var i = 0; i < list.length; i++) {
    var c = list[i];
    var row = document.createElement('div'); row.className = 'custom-row';
    row.innerHTML = '<span>' + escapeHtml(c.label || c.model) + ' <span style="color:var(--muted)">(' + (c.type || '') + ')</span></span>';
    var rm = document.createElement('button'); rm.className = 'rm'; rm.textContent = '\u2715'; rm.onclick = function(id) { return function() {
      fetch('/api/custom-model/' + encodeURIComponent(id), { method: 'DELETE' }).then(function() { loadModels(); renderModels(); });
    }; }(c.id);
    row.appendChild(rm); wrap.appendChild(row);
  }
}

async function renderSettings() {
  var body = $('panelBody');
  var ver = 'v3.3.0';
  try { var cfg = await fetch('/api/config').then(function(r) { return r.json(); }); if (cfg && cfg.version) ver = cfg.version; } catch (e) {}

  body.innerHTML =
    '    <div class="card"><div class="card-h">外观主题</div>' +
    '      <div class="field"><div class="seg" id="themeSeg">' +
    '        <button data-v="system">跟随系统</button>' +
    '        <button data-v="light">浅色</button>' +
    '        <button data-v="dark">深色</button>' +
    '      </div></div>' +
    '    </div>' +
    '    <div class="card"><div class="card-h">字体大小</div>' +
    '      <div class="field"><div class="seg" id="fontSeg">' +
    '        <button data-v="13">小</button>' +
    '        <button data-v="14">标准</button>' +
    '        <button data-v="15">大</button>' +
    '        <button data-v="16">特大</button>' +
    '      </div></div>' +
    '    </div>' +
    '    <div class="card"><div class="card-h">语音</div>' +
    '      <div class="set-switches">' +
    '        <label class="switch"><input type="checkbox" id="setVoiceInput" /><span>语音输入</span></label>' +
    '        <label class="switch"><input type="checkbox" id="setVoiceTTS" /><span>语音播报</span></label>' +
    '      </div>' +
    '    </div>' +
    '    <div class="card"><div class="card-h">对话角色称呼</div>' +
    '      <div class="field"><input id="setLabelUser" placeholder="我的称呼（如：船长）" /></div>' +
    '      <div class="field"><input id="setLabelAgent" placeholder="助手称呼（如：小航）" /></div>' +
    '    </div>' +
    '    <div class="card"><div class="card-h">数据管理</div>' +
    '      <div class="field set-actions">' +
    '        <button class="mini-btn" id="expChatBtn">导出对话</button>' +
    '        <button class="mini-btn" id="clearChatBtn">清空当前对话</button>' +
    '        <button class="mini-btn danger" id="resetUiBtn">恢复默认设置</button>' +
    '      </div>' +
    '    </div>' +
    '    <div class="card about-card"><div class="card-h">关于</div>' +
    '      <div class="about-row">AGENT HARNESS <span class="muted">' + escapeHtml(ver) + '</span></div>' +
    '      <div class="about-row muted">本地 AI Agent 控制台 · 以上设置仅保存在本机浏览器</div>' +
    '    </div>';

  // 外观主题
  var tseg = $('themeSeg');
  Array.prototype.forEach.call(tseg.children, function(b) { b.classList.toggle('on', b.dataset.v === _themeMode); });
  Array.prototype.forEach.call(tseg.children, function(b) {
    b.onclick = function() {
      Array.prototype.forEach.call(tseg.children, function(x) { x.classList.toggle('on', x === b); });
      applyThemeMode(b.dataset.v);
    };
  });

  // 字体大小
  var fseg = $('fontSeg');
  Array.prototype.forEach.call(fseg.children, function(b) { b.classList.toggle('on', Number(b.dataset.v) === chatUI.fontSize); });
  Array.prototype.forEach.call(fseg.children, function(b) {
    b.onclick = function() {
      Array.prototype.forEach.call(fseg.children, function(x) { x.classList.toggle('on', x === b); });
      chatUI.fontSize = Number(b.dataset.v); saveUI(); applyUIFont();
    };
  });

  // 语音
  $('setVoiceInput').checked = chatUI.voiceInput;
  $('setVoiceTTS').checked = chatUI.voiceTTS;
  $('setVoiceInput').onchange = function(e) { chatUI.voiceInput = e.target.checked; saveUI(); applyUIVoice(); };
  $('setVoiceTTS').onchange = function(e) { chatUI.voiceTTS = e.target.checked; saveUI(); };

  // 对话角色称呼
  $('setLabelUser').value = chatUI.labelUser || '你';
  $('setLabelAgent').value = chatUI.labelAgent || '助手';
  $('setLabelUser').onchange = function(e) { chatUI.labelUser = e.target.value.trim() || '你'; saveUI(); refreshRoleLabels(); };
  $('setLabelAgent').onchange = function(e) { chatUI.labelAgent = e.target.value.trim() || '助手'; saveUI(); refreshRoleLabels(); };

  // 数据管理
  $('expChatBtn').onclick = function() { if ($('exportBtn')) $('exportBtn').click(); };
  $('clearChatBtn').onclick = function() {
    if (confirm('确定清空当前对话？此操作不可撤销。')) { chat.innerHTML = ''; updateMsgCount(); scrollDown(); showToast('对话已清空', 'success'); }
  };
  $('resetUiBtn').onclick = function() {
    if (confirm('恢复默认设置？将清除本机的主题 / 字体 / 语音 / 称呼 / 头像偏好。')) {
      try { localStorage.removeItem(UI_KEY); localStorage.removeItem('ah_theme'); } catch (e2) {}
      location.reload();
    }
  };
}

function refreshRoleLabels() {
  if (!chat) return;
  chat.querySelectorAll('.msg').forEach(function(m) {
    var w = m.querySelector('.who'); if (!w) return;
    w.textContent = m.classList.contains('user') ? (chatUI.labelUser || '你') : m.classList.contains('assistant') ? (chatUI.labelAgent || '助手') : '系统';
  });
}


/* 模型树：Provider 层级缩进样式 */
var __styleEl = document.createElement('style');
__styleEl.textContent = '.model-provider-toggle{cursor:pointer;user-select:none;transition:background .15s}.model-provider-toggle:hover{background:rgba(127,127,127,.12)}.prov-arrow{display:inline-block;width:14px;color:#9aa5b5}.prov-count{float:right;color:#9aa5b5;font-weight:500}.model-provider-label{font-size:11px;color:#8a94a6;padding:6px 14px 2px 26px;font-weight:600;letter-spacing:.3px}.model-item{padding-left:34px}.grp-sub-label{font-size:12px;color:#8a94a6;padding:6px 12px 2px;font-weight:600}';
document.head.appendChild(__styleEl);

var _activeModelId = '';
function renderDefaultModelList() {
  var wrap = $('defaultModelList'); if (!wrap) return;
  fetch('/api/models').then(function(r) { return r.json(); }).then(function(md) {
    wrap.innerHTML = '';
    var found = false;
    (md.groups || []).forEach(function(g) {
      (g.providers || []).forEach(function(p) {
        p.models.forEach(function(m) {
          var sel = m.id === _activeModelId;
          if (sel) found = true;
          var row = document.createElement('div');
          row.className = 'list-row model-row' + (sel ? ' selected' : '');
          row.innerHTML = '<div class="lr-main"><div class="lr-title">' + escapeHtml(m.label) + '</div><div class="lr-sub">' + escapeHtml(g.label) + ' · ' + escapeHtml(p.label) + '</div></div>' + (sel ? '<span class="badge">默认</span>' : '');
          row.onclick = (function(id) { return function() { _activeModelId = id; renderDefaultModelList(); }; })(m.id);
          wrap.appendChild(row);
        });
      });
    });
    if (!found && _activeModelId) {
      var row = document.createElement('div');
      row.className = 'list-row model-row selected';
      row.innerHTML = '<div class="lr-main"><div class="lr-title">' + escapeHtml(_activeModelId) + '</div><div class="lr-sub">当前激活（未在列表中）</div></div><span class="badge">默认</span>';
      wrap.appendChild(row);
    }
  });
}


/* ─── 主题 / 折叠 ─── */
var _systemDarkMQ = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
function systemPrefersDark() { return _systemDarkMQ ? _systemDarkMQ.matches : false; }
function applyThemeMode(mode) {
  _themeMode = mode || 'system';
  var dark = _themeMode === 'dark' || (_themeMode === 'system' && systemPrefersDark());
  document.body.classList.toggle('dark', dark);
  syncHljsTheme(dark);
  try { localStorage.setItem('ah_theme', _themeMode); } catch {}
}
applyThemeMode(_themeMode);
if (_systemDarkMQ && _systemDarkMQ.addEventListener) _systemDarkMQ.addEventListener('change', function() { if (_themeMode === 'system') applyThemeMode('system'); });
$('themeBtn').onclick = function() { applyThemeMode(document.body.classList.contains('dark') ? 'light' : 'dark'); };
$('collapseBtn').onclick = function() { $('app').classList.add('collapsed'); };
$('showSideBtn').onclick = function() { $('app').classList.remove('collapsed'); };

/* ═══════ 侧栏导航 + 面板系统 ═══════ */
// 彩色线性图标（Lucide 风格，stroke=currentColor，每板块独立品牌色）
var NAV_ICONS = {
  chat:     { c:'#3b82f6', svg:"<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'><path d='M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z'/></svg>" },
  history:  { c:'#8b5cf6', svg:"<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'><path d='M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8'/><path d='M3 3v5h5'/></svg>" },
  memory:   { c:'#f59e0b', svg:"<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'><path d='M12 7v14'/><path d='M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-5a4 4 0 0 1-4 4 4 4 0 0 1-4-4z'/></svg>" },
  tasks:    { c:'#10b981', svg:"<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'><path d='m3 17 2 2 4-4'/><path d='m3 7 2 2 4-4'/><path d='M13 6h8'/><path d='M13 12h8'/><path d='M13 18h8'/></svg>" },
  models:   { c:'#06b6d4', svg:"<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'><rect width='16' height='16' x='4' y='4' rx='2'/><rect width='6' height='6' x='9' y='9' rx='1'/><path d='M15 2v2'/><path d='M15 20v2'/><path d='M2 15h2'/><path d='M2 9h2'/><path d='M20 15h2'/><path d='M20 9h2'/><path d='M9 2v2'/><path d='M9 20v2'/></svg>" },
  skills:   { c:'#f43f5e', svg:"<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'><polygon points='12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2'/></svg>" },
  plugins:  { c:'#6366f1', svg:"<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'><path d='m7.5 4.27 9 5.15'/><path d='M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z'/><path d='m3.3 7 8.7 5 8.7-5'/><path d='M12 22V12'/></svg>" },
  config:   { c:'#fb923c', svg:"<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'><line x1='21' x2='14' y1='4' y2='4'/><line x1='10' x2='3' y1='4' y2='4'/><line x1='21' x2='12' y1='12' y2='12'/><line x1='8' x2='3' y1='12' y2='12'/><line x1='21' x2='16' y1='20' y2='20'/><line x1='12' x2='3' y1='20' y2='20'/><line x1='14' x2='14' y1='2' y2='6'/><line x1='8' x2='8' y1='10' y2='14'/><line x1='16' x2='16' y1='18' y2='22'/></svg>" },
  logs:     { c:'#14b8a6', svg:"<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'><path d='M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z'/><path d='M14 2v4a2 2 0 0 0 2 2h4'/><path d='M16 13H8'/><path d='M16 17H8'/><path d='M10 9H8'/></svg>" },
  metrics:  { c:'#ec4899', svg:"<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'><path d='M3 3v18h18'/><path d='M18 17V9'/><path d='M13 17V5'/><path d='M8 17v-3'/></svg>" },
  health:   { c:'#ef4444', svg:"<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'><path d='M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z'/><path d='M3.22 12H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27'/></svg>" },
  settings: { c:'#64748b', svg:"<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'><path d='M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z'/><circle cx='12' cy='12' r='3'/></svg>" },
  marketplace:{ c:'#22d3ee', svg:"<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'><path d='M3 9l1.6-4.2h14.8L21 9'/><path d='M3 9v10a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V9'/><path d='M3 9h18'/><circle cx='12' cy='13' r='1.4'/></svg>" },
};
var NAV = [
  ['chat', '对话'], ['history', '历史'], ['memory', '记忆'],
  ['tasks', '任务'], ['models', '模型'], ['skills', '技能'],
  ['marketplace', '技能市场'],
  ['plugins', '插件'], ['config', '配置'], ['logs', '日志'],
  ['metrics', '指标'], ['health', '健康检查'], ['settings', '设置']
];
var PANELS = {
  history: { title: '历史对话', render: renderHistory },
  memory: { title: '记忆', render: renderMemory },
  tasks: { title: '任务调度', render: renderTasks },
  models: { title: '模型', render: renderModels },
  skills: { title: '技能', render: renderSkills },
  plugins: { title: '插件', render: renderPlugins },
  config: { title: '配置', render: renderConfig },
  logs: { title: '运行时日志', render: renderLogs },
  metrics: { title: '性能监控', render: renderMetrics },
  health: { title: '健康检查', render: renderHealth },
  settings: { title: '设置', render: renderSettings },
};

function hexToRgba(hex, a) { var h = String(hex).replace('#', ''); if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2]; var r = parseInt(h.substring(0,2),16), g = parseInt(h.substring(2,4),16), b = parseInt(h.substring(4,6),16); return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')'; }
function buildNav() { var nav = $('nav'); nav.innerHTML = ''; for (var i = 0; i < NAV.length; i++) { var v = NAV[i][0], label = NAV[i][1]; var ic = NAV_ICONS[v] || { c: '#9aa5b5', svg: '' }; var b = document.createElement('button'); b.className = 'nav-item' + (v === 'chat' ? ' active' : ''); b.dataset.view = v; b.style.setProperty('--ico', ic.c); b.style.setProperty('--ico-soft', hexToRgba(ic.c, 0.16)); b.innerHTML = '<span class="nav-ico">' + ic.svg + '</span><span class="nav-label">' + label + '</span>'; b.onclick = function() { switchView(this.dataset.view); }; nav.appendChild(b); } }
function switchView(view) {
  if (view === 'marketplace') { window.open('/marketplace?v=' + Date.now(), '_blank'); return; }
  currentView = view;
  document.querySelectorAll('.nav-item').forEach(function(b) { b.classList.toggle('active', b.dataset.view === view); });
  if (view === 'chat') { $('viewChat').hidden = false; $('viewPanel').hidden = true; }
  else { $('viewChat').hidden = true; $('viewPanel').hidden = false; $('panelTitle').textContent = PANELS[view].title; $('panelActions').innerHTML = ''; PANELS[view].render(); }
}

/* ─── 面板: 历史 ─── */
async function renderHistory() {
  var d = await fetch('/api/sessions').then(function(r) { return r.json(); });
  var list = (d.sessions || []).filter(function(s) { return !s.id.startsWith('team_') && !s.id.startsWith('job_'); });
  var body = $('panelBody');
  if (!list.length) { body.innerHTML = '<div class="empty-panel">还没有对话记录</div>'; return; }
  body.innerHTML = '';
  for (var i = 0; i < list.length; i++) {
    var s = list[i];
    var item = document.createElement('div'); item.className = 'list-row';
    item.innerHTML = '<div class="lr-main"><div class="lr-title">' + escapeHtml(s.title || '新对话') + '</div><div class="lr-sub">' + fmtTime(s.updatedAt) + '</div></div>' +
      '<div class="row" style="margin:0"><button class="mini-btn open-session">打开</button><button class="mini-btn ghost rename-session">重命名</button></div>';
    (function(sid, sitem, stitle) {
      sitem.querySelector('.open-session').onclick = function() { switchView('chat'); loadSession(sid); };
      sitem.querySelector('.rename-session').onclick = function() { startRename(sitem, sid, stitle || '新对话'); };
    })(s.id, item, s.title);
    body.appendChild(item);
  }
}
function startRename(item, id, title) {
  var main = item.querySelector('.lr-main');
  var titleEl = main.querySelector('.lr-title');
  var oldTitle = titleEl.textContent;
  titleEl.outerHTML = '<input class="rename-inp" value="' + escapeHtml(oldTitle) + '" />';
  var inputEl = main.querySelector('.rename-inp');
  inputEl.focus(); inputEl.select();
  var done = false;
  var commit = async function() {
    if (done) return; done = true;
    var nt = inputEl.value.trim().slice(0, 80) || title;
    var r = await fetch('/api/sessions/' + encodeURIComponent(id) + '/rename', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: nt }),
    }).then(function(x) { return x.json(); }).catch(function() { return { ok: false }; });
    if (r.ok) renderHistory(); else { showToast('重命名失败', 'error'); renderHistory(); }
  };
  inputEl.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { done = true; renderHistory(); }
  });
  inputEl.addEventListener('blur', commit);
}

/* ─── 面板: 记忆 ─── */
async function renderMemory() {
  var md = await fetch('/api/memory').then(function(r) { return r.json(); }).catch(function() { return { profile: {} }; });
  var notesRes = await fetch('/api/memory/notes').then(function(r) { return r.json(); }).catch(function() { return { notes: [] }; });
  var body = $('panelBody');
  var profile = md.profile || {};
  var notes = notesRes.notes || [];
  var html = '';
  html += '<div class="card"><div class="card-h">用户画像 (profile.json) · 可手动编辑</div>';
  html += '<textarea class="profile-editor" id="profileEditor" spellcheck="false">' + escapeHtml(JSON.stringify(profile, null, 2)) + '</textarea>';
  html += '<div class="editor-actions"><button class="mini-btn" id="saveProfile">保存画像</button><span class="muted" id="profileMsg"></span></div></div>';
  html += '<div class="card"><div class="card-h">长期笔记（可编辑 / 删除，共 ' + notes.length + ' 篇）</div>';
  for (var i = 0; i < notes.length; i++) {
    var n = notes[i];
    html += '<div class="note-item" data-topic="' + escapeHtml(n.topic) + '">';
    html += '<div class="note-item-h"><span class="note-item-title">' + escapeHtml(n.topic) + '</span><button class="mini-btn danger note-del" data-topic="' + escapeHtml(n.topic) + '">删除</button></div>';
    html += '<textarea class="note-editor" data-topic="' + escapeHtml(n.topic) + '" spellcheck="false">' + escapeHtml(n.content || '') + '</textarea>';
    html += '<div class="editor-actions" style="margin-bottom:0"><button class="mini-btn note-save" data-topic="' + escapeHtml(n.topic) + '">保存</button></div>';
    html += '</div>';
  }
  html += '</div>';
  html += '<div class="card"><div class="card-h">新建笔记</div><div class="field"><label>主题（用作文件名，可中英文）</label><input id="newTopic" placeholder="如：用户偏好"/></div><textarea id="newContent" placeholder="笔记内容…"></textarea><div class="editor-actions" style="margin-top:8px;margin-bottom:0"><button class="mini-btn" id="createNote">创建并保存</button></div></div>';
  html += '<div class="card"><div class="card-h">记忆召回</div><div class="row"><input id="recallQ" placeholder="输入查询…"/><button class="mini-btn" id="recallBtn">召回</button></div><div class="recall-out" id="recallOut"></div></div>';
  body.innerHTML = html;

  $('saveProfile').onclick = async function() {
    var raw = $('profileEditor').value; var obj;
    try { obj = JSON.parse(raw); } catch (e) {
      var m = $('profileMsg'); m.textContent = 'JSON 解析失败：' + e.message; m.style.color = 'var(--danger)'; return;
    }
    var r = await fetch('/api/memory/profile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profile: obj }) }).then(function(x) { return x.json(); });
    var m = $('profileMsg');
    if (r.ok) { m.textContent = '已保存'; m.style.color = 'var(--ok)'; }
    else { m.textContent = '保存失败：' + (r.error || ''); m.style.color = 'var(--danger)'; }
  };
  body.querySelectorAll('.note-save').forEach(function(b) { b.onclick = async function() {
    var topic = b.dataset.topic;
    var ta = body.querySelector('.note-editor[data-topic="' + CSS.escape(topic) + '"]');
    var r = await fetch('/api/memory/note/edit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ topic: topic, content: ta.value }) }).then(function(x) { return x.json(); });
    showToast(r.ok ? '笔记已保存' : '保存失败');
  }; });
  body.querySelectorAll('.note-del').forEach(function(b) { b.onclick = async function() {
    if (!confirm('确定删除笔记「' + b.dataset.topic + '」？此操作不可恢复。')) return;
    var r = await fetch('/api/memory/note/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ topic: b.dataset.topic }) }).then(function(x) { return x.json(); });
    if (r.ok) showToast('已删除', 'success'); else showToast('删除失败', 'error');
    renderMemory();
  }; });
  $('createNote').onclick = async function() {
    var topic = $('newTopic').value.trim(); var content = $('newContent').value;
    if (!topic) { showToast('请填写主题', 'warning'); return; }
    var r = await fetch('/api/memory/note/edit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ topic: topic, content: content }) }).then(function(x) { return x.json(); });
    if (r.ok) { $('newTopic').value = ''; $('newContent').value = ''; showToast('已创建', 'success'); renderMemory(); }
    else showToast('创建失败', 'error');
  };
  $('recallBtn').onclick = async function() {
    var q = $('recallQ').value.trim(); if (!q) return;
    var r = await fetch('/api/memory/recall', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q }) }).then(function(x) { return x.json(); });
    $('recallOut').innerHTML = (r.items || []).map(function(t) { return '<div class="recall-item">' + escapeHtml(t) + '</div>'; }).join('') || '无结果';
  };
}

/* ─── 面板: 任务 ─── */
var editingJobName = null;
var WEEK_OPTS = [['MON', '周一'], ['TUE', '周二'], ['WED', '周三'], ['THU', '周四'], ['FRI', '周五'], ['SAT', '周六'], ['SUN', '周日']];
function composeCron(freq, time, week, day) { if (freq === 'weekly') return 'weekly ' + week + ' ' + time; if (freq === 'monthly') return 'monthly ' + day + ' ' + time; return 'daily ' + time; }
function parseCronStr(cron) { var p = String(cron || '').trim().split(/\s+/); var freq = (p[0] || 'daily').toLowerCase(); var time = p[p.length - 1] || '07:00'; var week = 'MON', day = '1'; if (freq === 'weekly') week = p[1] || 'MON'; if (freq === 'monthly') day = p[1] || '1'; return { freq: freq, time: time, week: week, day: day }; }
function weekSelect(id, val) { return '<select id="' + id + '">' + WEEK_OPTS.map(function(w) { return '<option value="' + w[0] + '"' + (w[0] === val ? ' selected' : '') + '>' + w[1] + '</option>'; }).join('') + '</select>'; }
function jobFormHtml(prefix, job) { var c = job ? parseCronStr(job.cron) : { freq: 'daily', time: '07:00', week: 'MON', day: '1' }; return '<div class="job-form"><div class="row"><input id="' + prefix + 'Name" placeholder="任务名（英文唯一，如 daily_brief）" value="' + (job ? escapeHtml(job.name) : '') + '"/></div><div class="row"><select id="' + prefix + 'Freq"><option value="daily"' + (c.freq === 'daily' ? ' selected' : '') + '>每天</option><option value="weekly"' + (c.freq === 'weekly' ? ' selected' : '') + '>每周</option><option value="monthly"' + (c.freq === 'monthly' ? ' selected' : '') + '>每月</option></select><input type="time" id="' + prefix + 'Time" value="' + escapeHtml(c.time) + '" style="flex:0 0 120px"/><span id="' + prefix + 'WeekWrap" style="display:' + (c.freq === 'weekly' ? 'inline-flex' : 'none') + ';flex:0 0 auto">' + weekSelect(prefix + 'Week', c.week) + '</span><input type="number" id="' + prefix + 'Day" min="1" max="31" value="' + escapeHtml(c.day) + '" placeholder="日" style="display:' + (c.freq === 'monthly' ? 'block' : 'none') + ';flex:0 0 90px"/></div><textarea id="' + prefix + 'Prompt" placeholder="任务提示词（交给模型生成的指令）">' + (job ? escapeHtml(job.prompt) : '') + '</textarea></div>'; }
function wireJobForm(prefix) { var freqEl = $(prefix + 'Freq'); freqEl.onchange = function() { var f = freqEl.value; $(prefix + 'WeekWrap').style.display = f === 'weekly' ? 'inline-flex' : 'none'; $(prefix + 'Day').style.display = f === 'monthly' ? 'block' : 'none'; }; return function() { var name = $(prefix + 'Name').value.trim(); var freq = $(prefix + 'Freq').value; var time = $(prefix + 'Time').value || '07:00'; var week = $(prefix + 'Week') ? $(prefix + 'Week').value : 'MON'; var day = $(prefix + 'Day') ? ($(prefix + 'Day').value || '1') : '1'; var prompt = $(prefix + 'Prompt').value.trim(); return { name: name, cron: composeCron(freq, time, week, day), prompt: prompt }; }; }

async function renderTasks() {
  var d = await fetch('/api/jobs').then(function(r) { return r.json(); }).catch(function() { return { jobs: [] }; });
  var jobs = d.jobs || [];
  var body = $('panelBody');
  var html = '<div class="card"><div class="card-h">定时任务' + jobs.length + '个<button class="mini-btn" id="addJobBtn" style="float:right">+ 新建</button></div>';
  html += '<div id="jobFormWrap"></div>';
  for (var i = 0; i < jobs.length; i++) {
    var j = jobs[i];
    var enabled = j.enabled !== false;
    var statusBadge = enabled ? '<span class="tag tag-ok" style="margin-right:4px">运行中</span>' : '<span class="tag tag-bad" style="margin-right:4px">已暂停</span>';
    html += '<div class="list-row"><div class="lr-main"><div class="lr-title">' + statusBadge + escapeHtml(j.name) + '</div><div class="lr-sub">' + escapeHtml(j.cron || '') + ' · ' + (j.prompt ? escapeHtml(j.prompt.slice(0, 80)) : '') + '</div></div><div class="row" style="margin:0">';
    html += '<button class="mini-btn run-job" data-name="' + escapeHtml(j.name) + '" title="立即运行一次">立即运行</button>';
    html += '<button class="mini-btn ' + (enabled ? 'ghost' : '') + ' toggle-job" data-name="' + escapeHtml(j.name) + '" data-enabled="' + (enabled ? '1' : '0') + '" title="' + (enabled ? '暂停' : '恢复') + '">' + (enabled ? '暂停' : '继续') + '</button>';
    html += '<button class="mini-btn edit-job" data-name="' + escapeHtml(j.name) + '">编辑</button><button class="mini-btn ghost del-job" data-name="' + escapeHtml(j.name) + '">删除</button></div></div>';
  }
  html += '</div>';
  body.innerHTML = html;

  $('addJobBtn').onclick = function() {
    var wrap = $('jobFormWrap');
    wrap.innerHTML = jobFormHtml('newJob', null);
    wireJobForm('newJob');
    var save = document.createElement('button'); save.className = 'mini-btn'; save.textContent = '保存';
    save.onclick = async function() {
      var data = wireJobForm('newJob')();
      if (!data.name) { showToast('请填写任务名称', 'warning'); return; }
      var r = await fetch('/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(function(x) { return x.json(); });
      if (r.ok) { showToast('任务已创建', 'success'); renderTasks(); }
      else showToast('创建失败: ' + (r.error || ''), 'error');
    };
    wrap.appendChild(save);
  };

  // 立即运行
  body.querySelectorAll('.run-job').forEach(function(b) { b.onclick = async function() {
    var name = b.dataset.name;
    b.disabled = true; b.textContent = '运行中…';
    try {
      var r = await fetch('/api/jobs/' + encodeURIComponent(name), { method: 'POST' }).then(function(x) { return x.json(); });
      if (r.ok) showToast('已触发: ' + name, 'success');
      else showToast('触发失败: ' + (r.error || r.content || ''), 'error');
    } catch(e) { showToast('触发异常(任务可能已在后台运行)', 'warning'); }
    renderTasks();
  }; });

  // 暂停 / 继续
  body.querySelectorAll('.toggle-job').forEach(function(b) { b.onclick = async function() {
    var name = b.dataset.name;
    var enabled = b.dataset.enabled === '1';
    var action = enabled ? '暂停' : '恢复';
    var r = await fetch('/api/jobs/' + encodeURIComponent(name) + '/edit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !enabled }) }).then(function(x) { return x.json(); });
    if (r.ok) { showToast(action + '成功: ' + name, 'success'); renderTasks(); }
    else showToast(action + '失败: ' + (r.error || ''), 'error');
  }; });

  body.querySelectorAll('.edit-job').forEach(function(b) { b.onclick = function() {
    var name = b.dataset.name;
    var job = jobs.find(function(j) { return j.name === name; });
    if (!job) return;
    var wrap = $('jobFormWrap');
    wrap.innerHTML = jobFormHtml('editJob', job);
    wireJobForm('editJob');
    var save = document.createElement('button'); save.className = 'mini-btn'; save.textContent = '保存修改';
    save.onclick = async function() {
      var data = wireJobForm('editJob')();
      var r = await fetch('/api/jobs/' + encodeURIComponent(name), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(function(x) { return x.json(); });
      if (r.ok) { showToast('已保存', 'success'); renderTasks(); }
      else showToast('保存失败', 'error');
    };
    wrap.appendChild(save);
  }; });
  body.querySelectorAll('.del-job').forEach(function(b) { b.onclick = async function() {
    if (!confirm('确定删除任务「' + b.dataset.name + '」？')) return;
    var r = await fetch('/api/jobs/' + encodeURIComponent(b.dataset.name), { method: 'DELETE' }).then(function(x) { return x.json(); });
    if (r.ok) showToast('已删除', 'success'); else showToast('删除失败', 'error');
    renderTasks();
  }; });
}


/* ─── 编辑自定义模型弹窗 ─── */
function showEditModelDialog(id) {
  var m = null;
  for (var i = 0; i < _customModels.length; i++) {
    if (_customModels[i].id === id) { m = _customModels[i]; break; }
  }
  if (!m) return;
  var overlay = document.createElement('div'); overlay.className = 'modal-overlay';
  var typeMap = { ollama: 'Ollama', local: '本地 (OpenAI 兼容)', cloud: '云端 (需 Key)' };
  overlay.innerHTML = '\
    <div class="modal-card">\
      <div class="modal-header">编辑自定义模型</div>\
      <div class="field"><label>类型</label><select id="editType">' +
        Object.keys(typeMap).map(function(k) { return '<option value="' + k + '"' + (m.type === k ? ' selected' : '') + '>' + typeMap[k] + '</option>'; }).join('') +
      '</select></div>\
      <div class="field"><label>显示名</label><input id="editLabel" value="' + escapeHtml(m.label || '') + '" /></div>\
      <div class="field"><label>模型名</label><input id="editModel" value="' + escapeHtml(m.model || '') + '" /></div>\
      <div class="field"><label>Base URL</label><input id="editBase" value="' + escapeHtml(m.base || '') + '" placeholder="可选" /></div>\
      <div class="field"><label>API Key</label><input id="editKey" type="password" value="' + escapeHtml(m.key || '') + '" placeholder="可选" /></div>\
      <div class="modal-btns">\
        <button class="mini-btn" id="editCancel">取消</button>\
        <button class="mini-btn" id="editSave" style="background:var(--accent);color:#fff">保存</button>\
      </div>\
    </div>';
  document.body.appendChild(overlay);
  overlay.onclick = function(e) { if (e.target === overlay) closeDialog(); };
  overlay.querySelector('#editCancel').onclick = closeDialog;
  overlay.querySelector('#editSave').onclick = async function() {
    var label = overlay.querySelector('#editLabel').value.trim();
    var model = overlay.querySelector('#editModel').value.trim();
    var type = overlay.querySelector('#editType').value;
    if (!model) { showToast('请填写模型名', 'warning'); return; }
    var payload = { label: label || model, type: type, model: model, base: overlay.querySelector('#editBase').value.trim() || undefined, key: overlay.querySelector('#editKey').value.trim() || undefined };
    var r = await fetch('/api/custom-model/' + encodeURIComponent(id), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!r.ok) { showToast('保存失败', 'error'); return; }
    showToast('已更新', 'success'); closeDialog(); renderModels();
  };
  function closeDialog() { overlay.remove(); }
}

/* ─── 新增自定义模型弹窗 ─── */
function showAddModelDialog() {
  var overlay = document.createElement('div'); overlay.className = 'modal-overlay';
  var typeMap = { ollama: 'Ollama', local: '本地 (OpenAI 兼容)', cloud: '云端 (需 Key)' };
  overlay.innerHTML = '\
    <div class="modal-card">\
      <div class="modal-header">添加自定义模型</div>\
      <div class="field"><label>类型</label><select id="addType">' +
        Object.keys(typeMap).map(function(k) { return '<option value="' + k + '">' + typeMap[k] + '</option>'; }).join('') +
      '</select></div>\
      <div class="field"><label>显示名</label><input id="addLabel" placeholder="可选，留空则用模型名" /></div>\
      <div class="field"><label>模型名</label><input id="addModel" placeholder="如 qwen3.5:9b / gpt-4o" /></div>\
      <div class="field"><label>Base URL</label><input id="addBase" placeholder="可选" /></div>\
      <div class="field"><label>API Key</label><input id="addKey" type="password" placeholder="云端模型必填，本地可选" /></div>\
      <div class="modal-btns">\
        <button class="mini-btn" id="addCancel">取消</button>\
        <button class="mini-btn" id="addSave" style="background:var(--accent);color:#fff">保存</button>\
      </div>\
    </div>';
  document.body.appendChild(overlay);
  function closeDialog() { overlay.remove(); }
  overlay.onclick = function(e) { if (e.target === overlay) closeDialog(); };
  overlay.querySelector('#addCancel').onclick = closeDialog;
  overlay.querySelector('#addSave').onclick = async function() {
    var label = overlay.querySelector('#addLabel').value.trim();
    var model = overlay.querySelector('#addModel').value.trim();
    var type = overlay.querySelector('#addType').value;
    if (!model) { showToast('请填写模型名', 'warning'); return; }
    var payload = {
      id: 'custom_' + Date.now(),
      label: label || model,
      type: type,
      model: model,
      base: overlay.querySelector('#addBase').value.trim() || undefined,
      key: overlay.querySelector('#addKey').value.trim() || undefined
    };
    var r = await fetch('/api/custom-model', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!r.ok) { showToast('添加失败', 'error'); return; }
    showToast('已添加自定义模型', 'success'); closeDialog(); renderModels();
  };
}

/* ─── 面板: 模型 ─── */
async function renderModels() {
  var body = $('panelBody');
  body.innerHTML = '<div class="card"><div class="card-h">可用模型 · 点击设为默认</div><div class="model-loading"><div class="spinner"></div><div class="ml-text">正在发现可用模型（首次扫描本地与云端，稍慢）…</div></div></div>';
  var ctrl = new AbortController();
  var to = setTimeout(function() { ctrl.abort(); }, 45000);
  try {
    var md = await fetch('/api/models', { signal: ctrl.signal }).then(function(r) { if (!r.ok) throw new Error('bad'); return r.json(); });
    var cfg = await fetch('/api/config', { signal: ctrl.signal }).then(function(r) { if (!r.ok) throw new Error('bad'); return r.json(); });
  } catch (e) {
    clearTimeout(to);
    body.innerHTML = '<div class="card"><div class="card-h">模型加载较慢 / 超时</div><div class="model-loading"><div class="ml-text">后端正在扫描模型，请稍候再试。</div><button class="mini-btn primary" id="retryModels">重试</button></div></div>';
    var rb = $('retryModels'); if (rb) rb.onclick = renderModels;
    return;
  }
  clearTimeout(to);
  var html = '<div class="card"><div class="card-h">可用模型 · 点击设为默认</div>';
  for (var i = 0; i < (md.groups || []).length; i++) {
    var g = md.groups[i];
    html += '<div class="grp-label">' + escapeHtml(g.label) + '</div>';
    if (!g.providers) continue;
    for (var j = 0; j < g.providers.length; j++) {
      var p = g.providers[j];
      html += '<div class="grp-sub-label">' + escapeHtml(p.label) + '</div>';
      for (var k = 0; k < p.models.length; k++) {
        var m = p.models[k], sel = m.id === md.activeModelId;
        html += '<div class="list-row model-row' + (sel ? ' selected' : '') + '" data-id="' + escapeHtml(m.id) + '"><div class="lr-main"><div class="lr-title">' + escapeHtml(m.label) + '</div></div>' + (sel ? '<span class="badge">默认</span>' : '') + '</div>';
      }
    }
  }
  html += '</div>';
  var customs = cfg.customModels || []; _customModels = customs;
  html += '<div class="card"><div class="card-h">自定义模型 (' + customs.length + ')</div>';
  for (var i = 0; i < customs.length; i++) {
    var c = customs[i];
    html += '<div class="list-row"><div class="lr-main"><div class="lr-title">' + escapeHtml(c.label || c.model) + '</div><div class="lr-sub">' + (c.type || '') + ' · ' + escapeHtml(c.model || '') + '</div></div><span class="lr-acts"><button class="mini-btn warn edit-custom" data-id="' + escapeHtml(c.id) + '">编辑</button><button class="mini-btn danger rm-custom" data-id="' + escapeHtml(c.id) + '">删除</button></span></div>';
  }
  html += '<button class="mini-btn primary" id="addCustomLink">+ 添加自定义模型</button></div>';
  body.innerHTML = html;
  body.querySelectorAll('.model-row').forEach(function(r) { r.onclick = async function() {
    var id = r.dataset.id;
    await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ activeModelId: id }) });
    currentModelId = id; updateModelTrigger(); $('footModel').textContent = labelOf(id) || '—';
    var lbl = labelOf(id); if (lbl) setConn('已连接 · ' + lbl, 'ok');
    showToast('已设为默认模型', 'success'); renderModels();
  }; });
  body.querySelectorAll('.rm-custom').forEach(function(b) { b.onclick = async function() {
    var rid = b.dataset.id;
    var r = await fetch('/api/custom-model/' + encodeURIComponent(rid), { method: 'DELETE' });
    if (!r.ok) { showToast('删除失败', 'error'); return; }
    showToast('已删除', 'success'); renderModels();
  }; });
  body.querySelectorAll('.edit-custom').forEach(function(b) { b.onclick = function(e) { e.stopPropagation(); showEditModelDialog(b.dataset.id); }; });
  $('addCustomLink').onclick = showAddModelDialog;
}

/* ─── 面板: 技能 ─── */
async function renderSkills() {
  var list = await fetch('/api/skills').then(function(r) { return r.json(); }).catch(function() { return []; });
  var body = $('panelBody');
  var html = '';
  for (var i = 0; i < list.length; i++) {
    var s = list[i];
    html += '<div class="card"><div class="card-h">' + escapeHtml(s.name) + (s.trigger ? ' <span class="tag">' + escapeHtml(s.trigger) + '</span>' : '') + '</div><div class="muted">' + escapeHtml(s.description || '') + '</div></div>';
  }
  html += '<div class="card"><div class="card-h">添加技能</div>' +
    '<div class="field"><label>名称</label><input id="skName" placeholder="例如：PDF 摘要"/></div>' +
    '<div class="field"><label>描述</label><input id="skDesc" placeholder="这个技能做什么"/></div>' +
    '<div class="field"><label>触发词（可选）</label><input id="skTrigger" placeholder="例如：pdf 摘要"/></div>' +
    '<div class="field"><label>步骤说明（SKILL.md 正文）</label><textarea id="skBody" placeholder="分步骤描述技能的执行方式…"></textarea></div>' +
    '<button class="mini-btn" id="addSkillBtn">创建技能</button>' +
    '<div class="muted" style="margin-top:8px">技能写入 server/src/skills/builtin/&lt;名称&gt;/SKILL.md，保存后立即在系统提示中生效。</div></div>';
  body.innerHTML = html;
  $('addSkillBtn').onclick = async function() {
    var name = $('skName').value.trim();
    if (!name) { showToast('请填写技能名称', 'warning'); return; }
    var r = await fetch('/api/skills', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name, description: $('skDesc').value.trim(), trigger: $('skTrigger').value.trim() || undefined, body: $('skBody').value }) }).then(function(x) { return x.json(); });
    if (r.ok) { showToast('技能已添加', 'success'); renderSkills(); }
    else showToast('添加失败：' + (r.error || ''), 'error');
  };
}

/* ─── 面板: 插件 ─── */
async function renderPlugins() {
  var d = await fetch('/api/plugins').then(function(r) { return r.json(); }).catch(function() { return { tools: [], custom: [] }; });
  var body = $('panelBody');
  var html = '<div class="card"><div class="card-h">已注册工具（' + (d.tools || []).length + '）</div>';
  for (var i = 0; i < (d.tools || []).length; i++) {
    var t = d.tools[i];
    html += '<div class="list-row"><div class="lr-main"><div class="lr-title">' + escapeHtml(t.name) + (t.custom ? ' <span class="tag">自定义</span>' : '') + '</div><div class="lr-sub">' + escapeHtml(t.description || '') + '</div></div></div>';
  }
  html += '</div>';
  if ((d.custom || []).length) {
    html += '<div class="card"><div class="card-h">自定义插件（' + d.custom.length + '）</div>';
    for (var i = 0; i < d.custom.length; i++) {
      var c = d.custom[i];
      html += '<div class="list-row"><div class="lr-main"><div class="lr-title">' + escapeHtml(c.name) + '</div><div class="lr-sub">' + escapeHtml(c.command || '') + '</div></div><button class="mini-btn rm-plugin" data-id="' + escapeHtml(c.id) + '">删除</button></div>';
    }
    html += '</div>';
  }
  html += '<div class="card"><div class="card-h">添加插件（自定义工具）</div><div class="muted">插件是一个命令行工具，通过 JSON 输入/输出来扩展助手能力。</div>' +
    '<div class="field"><label>名称</label><input id="plName" placeholder="如: weather"/></div>' +
    '<div class="field"><label>描述</label><input id="plDesc" placeholder="查询天气"/></div>' +
    '<div class="field"><label>命令</label><input id="plCmd" placeholder="如: node tools/weather.js"/></div>' +
    '<button class="mini-btn" id="addPluginBtn">添加插件</button></div>';
  body.innerHTML = html;
  body.querySelectorAll('.rm-plugin').forEach(function(b) { b.onclick = async function() {
    await fetch('/api/plugins/' + encodeURIComponent(b.dataset.id), { method: 'DELETE' });
    showToast('已删除', 'success'); renderPlugins();
  }; });
  $('addPluginBtn').onclick = async function() {
    var name = $('plName').value.trim(); var desc = $('plDesc').value.trim(); var cmd = $('plCmd').value.trim();
    if (!name || !cmd) { showToast('请填写名称和命令', 'warning'); return; }
    var r = await fetch('/api/plugins', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name, description: desc, command: cmd }) }).then(function(x) { return x.json(); });
    if (r.ok) { showToast('插件已添加', 'success'); renderPlugins(); }
    else showToast('添加失败: ' + (r.error || ''), 'error');
  };
}

/* ─── 面板: 配置 ─── */
async function renderConfig() {
  var c = await fetch('/api/config').then(function(r) { return r.json(); });
  var body = $('panelBody');
  body.innerHTML = '<div class="card"><div class="card-h">当前运行配置</div><pre class="code">' + escapeHtml(JSON.stringify(c, null, 2)) + '</pre><button class="mini-btn" id="openCfgBtn">打开设置修改</button></div>';
  $('openCfgBtn').onclick = openSettings;
}

/* ─── 面板: 日志 ─── */
async function renderLogs() {
  var d = await fetch('/api/logs').then(function(r) { return r.json(); }).catch(function() { return { count: 0, logs: [] }; });
  var body = $('panelBody');
  var html = '<div class="card"><div class="card-h">运行时日志（共 ' + d.count + ' 条，显示最近）</div><div class="logs">';
  var logs = (d.logs || []).slice().reverse();
  for (var i = 0; i < logs.length; i++) {
    var l = logs[i];
    html += '<div class="log-line log-' + escapeHtml(l.level || 'info') + '"><span class="log-t">' + fmtTime(l.t) + '</span>' + escapeHtml(l.msg) + '</div>';
  }
  html += '</div><button class="mini-btn" id="refreshLogs">刷新</button></div>';
  body.innerHTML = html;
  $('refreshLogs').onclick = renderLogs;
}

/* ─── 面板: 指标 ─── */
async function renderMetrics() {
  var m = await fetch('/api/metrics').then(function(r) { return r.json(); }).catch(function() { return { uptime: 0, node: '?', platform: '?', wsConnections: 0, memory: { rss: 0, heapUsed: 0, heapTotal: 0 }, config: { provider: '?', activeModelId: '-' } }; });
  function mb(b) { return (b / 1048576).toFixed(1) + ' MB'; }
  function stat(k, v) { return '<div class="stat"><div class="stat-k">' + escapeHtml(k) + '</div><div class="stat-v">' + escapeHtml(String(v)) + '</div></div>'; }
  var body = $('panelBody');
  var html = '<div class="grid2">';
  html += stat('运行时长', fmtUptime(m.uptime));
  html += stat('Node 版本', m.node);
  html += stat('平台', m.platform);
  html += stat('WebSocket 连接', m.wsConnections);
  html += stat('RSS 内存', mb(m.memory.rss));
  html += stat('堆已用 / 总量', mb(m.memory.heapUsed) + ' / ' + mb(m.memory.heapTotal));
  html += stat('Provider', m.config.provider);
  html += stat('当前模型', m.config.activeModelId || '—');
  html += '</div><button class="mini-btn" id="refreshMetrics">刷新</button>';
  body.innerHTML = html;
  $('refreshMetrics').onclick = renderMetrics;
}

/* ─── 面板: 健康检查（心跳廉价版自检告警展示） ─── */
async function renderHealth() {
  var d = await fetch('/api/health/alerts?limit=300').then(function(r) { return r.json(); }).catch(function() { return { count: 0, total: 0, alerts: [] }; });
  var alerts = d.alerts || [];
  var okCount = 0, alertCount = 0;
  for (var i = 0; i < alerts.length; i++) { if (alerts[i].ok) okCount++; else alertCount++; }
  var body = $('panelBody');
  var html = '<div class="card"><div class="card-h">心跳自检告警'
    + ' <span class="badge" style="background:var(--ok)">正常 ' + okCount + '</span>'
    + ' <span class="badge" style="background:var(--danger)">异常 ' + alertCount + '</span>'
    + ' <span style="color:var(--muted);font-weight:400">（共 ' + (d.total || 0) + ' 条，最近优先）</span></div>';
  if (!alerts.length) {
    html += '<div class="empty-panel">暂无告警记录<br><span style="color:var(--muted)">心跳每 30 分钟自检一次，异常会在此显示</span></div>';
  } else {
    for (var j = 0; j < alerts.length; j++) {
      var a = alerts[j];
      var badge = a.ok
        ? '<span class="badge" style="background:var(--ok)">OK</span>'
        : '<span class="badge" style="background:var(--danger)">ALERT</span>';
      html += '<div class="list-row"><div class="lr-main">'
        + '<div class="lr-title">' + badge + ' ' + escapeHtml(a.check || 'check') + '</div>'
        + '<div class="lr-sub">' + escapeHtml(a.ts || '') + '</div></div>'
        + '<div class="lr-sub" style="text-align:right;max-width:55%;overflow-wrap:anywhere">' + escapeHtml(a.detail || '') + '</div></div>';
    }
  }
  html += '</div><button class="mini-btn ghost" id="refreshHealth">刷新</button>';
  body.innerHTML = html;
  $('refreshHealth').onclick = renderHealth;
}

/* ═══════ 启动 ═══════ */
buildNav();
switchView('chat');
loadModels();
connect();
refreshTokens();

/* ════════════════════════════════════════════════════════════
   2026-08-13 增强：头像 / 编辑·删除截断 / 语音输入·播报 / 对话设置
   （不触碰上方既有逻辑；UI 设置 localStorage 持久化）
   ════════════════════════════════════════════════════════════ */
var UI_DEFAULTS = {
  fontSize: 14,
  voiceInput: true,
  voiceTTS: true,
  labelUser: '你',
  labelAgent: '助手',
  avatarUser: { id: 'wheel', color: '#0d9488' },
  avatarAgent: { id: 'core', color: '#7c3aed' }
};
var UI_KEY = 'ah_chat_ui';
function loadUI() {
  try {
    var p = JSON.parse(localStorage.getItem(UI_KEY) || '{}');
    return {
      fontSize: p.fontSize || UI_DEFAULTS.fontSize,
      voiceInput: p.voiceInput !== false,
      voiceTTS: p.voiceTTS !== false,
      labelUser: p.labelUser || UI_DEFAULTS.labelUser,
      labelAgent: p.labelAgent || UI_DEFAULTS.labelAgent,
      avatarUser: Object.assign({}, UI_DEFAULTS.avatarUser, p.avatarUser || {}),
      avatarAgent: Object.assign({}, UI_DEFAULTS.avatarAgent, p.avatarAgent || {})
    };
  } catch { return Object.assign({}, UI_DEFAULTS, { avatarUser: Object.assign({}, UI_DEFAULTS.avatarUser), avatarAgent: Object.assign({}, UI_DEFAULTS.avatarAgent) }); }
}
var chatUI = loadUI();
function saveUI() { try { localStorage.setItem(UI_KEY, JSON.stringify(chatUI)); } catch {} }
/* ── 头像设计库（内联 SVG，Lucide 风格，零依赖、离线可用）── */
var AV = {
  user: [
    { id:'wheel', label:'舵轮', c1:'#14b8a6', c2:'#0f766e', ring:'rgba(20,184,166,.42)',
      svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"/><circle cx="12" cy="12" r="8" opacity=".5"/><path d="M12 4v4M12 16v4M4 12h4M16 12h4M6.5 6.5l2.8 2.8M17.5 6.5l-2.8 2.8M6.5 17.5l2.8-2.8M17.5 17.5l-2.8-2.8"/></svg>' },
    { id:'anchor', label:'锚', c1:'#38bdf8', c2:'#0369a1', ring:'rgba(56,189,248,.42)',
      svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="4.5" r="1.8"/><path d="M12 6.3V20"/><path d="M5 12.5a7 7 0 0 0 14 0"/><path d="M2.5 10.5c1.8 1 3 2 3 3.5M21.5 10.5c-1.8 1-3 2-3 3.5"/></svg>' },
    { id:'lighthouse', label:'灯塔', c1:'#fb923c', c2:'#c2410c', ring:'rgba(251,146,60,.42)',
      svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21h6"/><path d="M9.5 21V9l2.5-5 2.5 5v12"/><path d="M9.3 13h5.4"/><path d="M9.1 16.5h5.8"/><path d="M12 4v2"/></svg>' },
    { id:'compass', label:'罗盘', c1:'#34d399', c2:'#047857', ring:'rgba(52,211,153,.42)',
      svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 5l2.2 6.5L12 19l-2.2-7.5z" fill="currentColor" opacity=".9"/></svg>' },
    { id:'wave', label:'海浪', c1:'#22d3ee', c2:'#0e7490', ring:'rgba(34,211,238,.42)',
      svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/><path d="M3 14c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/><path d="M3 19c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/></svg>' },
    { id:'ship', label:'帆船', c1:'#f59e0b', c2:'#b45309', ring:'rgba(245,158,11,.42)',
      svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14l2-7h12l2 7"/><path d="M12 7V3"/><path d="M12 3l4 3-4 3z" fill="currentColor" opacity=".85"/><path d="M3 17c2 2 4 2 6 0s4-2 6 0 4 2 6 0"/></svg>' }
  ],
  agent: [
    { id:'core', label:'核心', c1:'#8b5cf6', c2:'#6d28d9', ring:'rgba(139,92,246,.45)',
      svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3" fill="currentColor" opacity=".9"/><circle cx="5" cy="6" r="2"/><circle cx="19" cy="6" r="2"/><circle cx="5" cy="18" r="2"/><circle cx="19" cy="18" r="2"/><path d="M6.5 7l3.5 3.5M17.5 7l-3.5 3.5M6.5 17l3.5-3.5M17.5 17l-3.5-3.5"/></svg>' },
    { id:'bot', label:'机器人', c1:'#60a5fa', c2:'#2563eb', ring:'rgba(96,165,250,.45)',
      svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 8V5"/><circle cx="12" cy="4" r="1.3" fill="currentColor"/><circle cx="9.5" cy="13.5" r="1.4" fill="currentColor" opacity=".85"/><circle cx="14.5" cy="13.5" r="1.4" fill="currentColor" opacity=".85"/><path d="M9 17h6"/></svg>' },
    { id:'chip', label:'芯片', c1:'#2dd4bf', c2:'#0d9488', ring:'rgba(45,212,191,.45)',
      svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="7" width="10" height="10" rx="2"/><rect x="10" y="10" width="4" height="4" rx="1" fill="currentColor" opacity=".8"/><path d="M10 4v3M14 4v3M10 17v3M14 17v3M4 10h3M4 14h3M17 10h3M17 14h3"/></svg>' },
    { id:'spark', label:'灵感', c1:'#f472b6', c2:'#be185d', ring:'rgba(244,114,182,.45)',
      svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" fill="currentColor" opacity=".9"/><path d="M18 15.5l.7 1.9.2.6"/><circle cx="6" cy="17.5" r=".9" fill="currentColor"/></svg>' },
    { id:'rocket', label:'火箭', c1:'#fb7185', c2:'#e11d48', ring:'rgba(251,113,133,.45)',
      svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c3 2 4.5 5 4.5 9l-1.5 3h-6l-1.5-3C7.5 8 9 5 12 3z"/><circle cx="12" cy="10" r="1.6" fill="currentColor" opacity=".85"/><path d="M8.5 15l-2 3 3-1M15.5 15l2 3-3-1"/><path d="M12 18v3"/></svg>' },
    { id:'orbit', label:'原子', c1:'#a78bfa', c2:'#7c3aed', ring:'rgba(167,139,250,.45)',
      svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="2" fill="currentColor" opacity=".9"/><ellipse cx="12" cy="12" rx="9" ry="3.5"/><ellipse cx="12" cy="12" rx="9" ry="3.5" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="9" ry="3.5" transform="rotate(120 12 12)"/></svg>' }
  ]
};
function avatarKeyOf(role) { return role === 'user' ? 'avatarUser' : 'avatarAgent'; }
function avatarDefOf(role) {
  var cu = chatUI[avatarKeyOf(role)];
  if (!cu || !cu.id) return null;
  var list = (role === 'user' ? AV.user : AV.agent) || [];
  for (var i = 0; i < list.length; i++) if (list[i].id === cu.id) return list[i];
  return null;
}
function renderAvatarInto(el, role) {
  var cu = chatUI[avatarKeyOf(role)];
  var def = avatarDefOf(role);
  el.style.color = '#fff';
  if (def) {
    el.style.background = 'linear-gradient(135deg,' + def.c1 + ',' + def.c2 + ')';
    el.style.boxShadow = '0 2px 8px ' + def.ring + ', 0 0 0 2px var(--bg)';
    el.textContent = '';
    el.innerHTML = def.svg;
  } else {
    el.style.background = cu && cu.color ? cu.color : '#64748b';
    el.style.boxShadow = '0 2px 8px rgba(0,0,0,.25), 0 0 0 2px var(--bg)';
    el.textContent = cu && cu.emoji ? cu.emoji : '●';
  }
}
function refreshAvatars() {
  document.querySelectorAll('.msg-avatar').forEach(function(av) {
    var msg = av.closest('.msg');
    var role = msg && msg.classList.contains('user') ? 'user' : 'assistant';
    renderAvatarInto(av, role);
  });
}
function applyUIFont() { chat.style.fontSize = chatUI.fontSize + 'px'; }
function applyUIVoice() {
  var v = $('voiceBtn'); if (!v) return;
  var ok = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  v.hidden = !chatUI.voiceInput || !ok;
}

/* ── 编辑 / 删除：截断后续对话 ── */
function msgIndexOf(el) { return Array.prototype.indexOf.call(chat.children, el); }
function truncateFrom(el) {
  var idx = msgIndexOf(el); if (idx < 0) return;
  var kids = chat.children;
  for (var i = kids.length - 1; i >= idx; i--) kids[i].remove(); updateMsgCount();
}
function deleteFrom(el) { truncateFrom(el); }
function editAndResend(el, text) {
  if (!text) return;
  var idx = msgIndexOf(el); if (idx < 0) return;
  truncateFrom(el);               // 移除本条及后续（截断）
  var es = $('emptyState'); if (es) es.remove();
  if (!busy) send(text);          // 以编辑后的文本作为新用户消息重发
}

/* ── 语音播报（TTS）── */
var _speakingEl = null;
function toggleSpeak(el, btn, text) {
  if (!('speechSynthesis' in window)) { showToast('浏览器不支持语音播报', 'warning'); return; }
  if (_speakingEl === el) { window.speechSynthesis.cancel(); _speakingEl = null; btn.textContent = '朗读'; btn.classList.remove('on'); return; }
  window.speechSynthesis.cancel();
  var u = new SpeechSynthesisUtterance(String(text || '').slice(0, 600));
  u.lang = 'zh-CN'; u.rate = 1;
  u.onend = u.onerror = function() { _speakingEl = null; btn.textContent = '朗读'; btn.classList.remove('on'); };
  window.speechSynthesis.speak(u);
  _speakingEl = el; btn.textContent = '停止'; btn.classList.add('on');
}

/* ── 语音输入（Web Speech API）── */
var _rec = null, _listening = false;
function initVoiceInput() {
  var btn = $('voiceBtn'); if (!btn) return;
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return;
  btn.hidden = !chatUI.voiceInput;
  btn.onclick = function() {
    if (_listening) { try { _rec && _rec.stop(); } catch {} _listening = false; btn.classList.remove('on'); return; }
    var rec = new SR();
    rec.lang = 'zh-CN'; rec.interimResults = false;
    rec.onresult = function(e) {
      var t = e.results && e.results[0] && e.results[0][0] ? e.results[0][0].transcript : '';
      if (t) { input.value = (input.value ? input.value + ' ' : '') + t; autosize(); updateCtxBadge(estimateTokensJS(input.value)); updateInputTokens(); }
    };
    rec.onend = rec.onerror = function() { _listening = false; btn.classList.remove('on'); };
    try { rec.start(); _rec = rec; _listening = true; btn.classList.add('on'); } catch {}
  };
}

/* ── 对话设置弹层 ── */
function renderAvatarPick(id, key, list) {
  var wrap = $(id); if (!wrap) return; wrap.innerHTML = '';
  list.forEach(function(def) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'av-chip' + (chatUI[key].id === def.id ? ' on' : '');
    b.style.background = 'linear-gradient(135deg,' + def.c1 + ',' + def.c2 + ')';
    b.title = def.label;
    b.setAttribute('aria-label', def.label);
    b.innerHTML = def.svg;
    b.onclick = function() {
      chatUI[key].id = def.id; chatUI[key].color = def.c2; saveUI();
      renderAvatarPick(id, key, list); refreshAvatars();
    };
    wrap.appendChild(b);
  });
}
function openChatSettings() {
  var m = $('chatSettingsModal'); if (!m) return; m.hidden = false;
  var seg = $('fontSizeSeg');
  Array.prototype.forEach.call(seg.children, function(b) { b.classList.toggle('on', Number(b.dataset.v) === chatUI.fontSize); });
  $('setVoiceInput').checked = chatUI.voiceInput;
  $('setVoiceTTS').checked = chatUI.voiceTTS;
  $('setLabelUser').value = chatUI.labelUser || '你';
  $('setLabelAgent').value = chatUI.labelAgent || '助手';
  renderAvatarPick('avatarUserPick', 'avatarUser', AV.user);
  renderAvatarPick('avatarAgentPick', 'avatarAgent', AV.agent);
}
function closeChatSettings() { var m = $('chatSettingsModal'); if (m) m.hidden = true; }
function bindChatSettings() {
  var b = $('chatSettingsBtn'); if (b) b.onclick = openChatSettings;
  var c = $('chatSettingsClose'); if (c) c.onclick = closeChatSettings;
  var d = $('chatSettingsDone'); if (d) d.onclick = closeChatSettings;
  var m = $('chatSettingsModal'); if (m) m.addEventListener('click', function(e) { if (e.target === m) closeChatSettings(); });
  var seg = $('fontSizeSeg');
  if (seg) seg.addEventListener('click', function(e) {
    var btn = e.target.closest ? e.target.closest('button') : null; if (!btn || !btn.dataset.v) return;
    chatUI.fontSize = Number(btn.dataset.v); saveUI(); applyUIFont();
    Array.prototype.forEach.call(this.children, function(x) { x.classList.toggle('on', x === btn); });
  });
  var vi = $('setVoiceInput'); if (vi) vi.onchange = function(e) { chatUI.voiceInput = e.target.checked; saveUI(); applyUIVoice(); };
  var vt = $('setVoiceTTS'); if (vt) vt.onchange = function(e) { chatUI.voiceTTS = e.target.checked; saveUI(); };
  var lu = $('setLabelUser'); if (lu) lu.onchange = function(e) { chatUI.labelUser = e.target.value.trim() || '你'; saveUI(); applyMsgLabels(); };
  var la = $('setLabelAgent'); if (la) la.onchange = function(e) { chatUI.labelAgent = e.target.value.trim() || '助手'; saveUI(); applyMsgLabels(); };
  var cc = $('clearChatBtn'); if (cc) cc.onclick = function() { if (confirm('确定清空当前对话？')) { newChat(); closeChatSettings(); } };
  document.addEventListener('keydown', function(e) { if (e.key === 'Escape' && m && !m.hidden) closeChatSettings(); });
}


/* ── 称呼自定义：刷新已有消息的身份标注 ── */
function applyMsgLabels() {
  document.querySelectorAll('.msg').forEach(function(m) {
    var who = m.querySelector('.who'); if (!who) return;
    if (m.classList.contains('user')) who.textContent = chatUI.labelUser || '你';
    else if (m.classList.contains('assistant')) who.textContent = chatUI.labelAgent || '助手';
  });
}

/* ── 2026-08-13 增强初始化 ── */
applyUIFont();
applyUIVoice();
initVoiceInput();
bindChatSettings();

/* ── 2026-08-14 视觉增强：面板卡片入场动画 + 磁性微交互 ── */
(function () {
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // 1) 面板卡片滚动淡入（IntersectionObserver）
  if (!reduce && 'IntersectionObserver' in window) {
    document.body.classList.add('reveal-on');
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('in-view'); io.unobserve(e.target); }
      });
    }, { root: document.getElementById('panelBody') || null, threshold: 0 });
    function observeCards(root) {
      root.querySelectorAll('.card:not(.in-view)').forEach(function (c) { io.observe(c); });
    }
    var pb = document.getElementById('panelBody');
    if (pb) {
      observeCards(pb);
      new MutationObserver(function (muts) {
        muts.forEach(function (m) {
          m.addedNodes.forEach(function (n) {
            if (n.nodeType === 1) { if (n.classList && n.classList.contains('card')) io.observe(n); else observeCards(n); }
          });
        });
      }).observe(pb, { childList: true, subtree: true });
    }
  }

  // 2) 磁性微交互：按钮轻微吸附光标
  if (!reduce) {
    function magnetic(el, s) {
      el.addEventListener('mousemove', function (ev) {
        var r = el.getBoundingClientRect();
        var x = (ev.clientX - r.left - r.width / 2) * s;
        var y = (ev.clientY - r.top - r.height / 2) * s;
        el.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(1.04)';
      });
      el.addEventListener('mouseleave', function () { el.style.transform = ''; });
    }
    function bindAll() {
      document.querySelectorAll('.icon-btn:not([data-mag]), .send-btn:not([data-mag])').forEach(function (el) {
        el.setAttribute('data-mag', '1'); magnetic(el, 0.18);
      });
    }
    bindAll();
    new MutationObserver(bindAll).observe(document.body, { childList: true, subtree: true });
  }
})();
