const state = { board: null, columns: [], cards: [], query: { q: '', priority: '', type: '' } };
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);

async function api(path, options = {}, canPrompt = true) {
  const apiKey = sessionStorage.getItem('workboard-api-key');
  const response = await fetch(`/api/v1${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...(apiKey ? { 'X-API-Key': apiKey } : {}), ...options.headers } });
  if (response.status === 401 && canPrompt) {
    const supplied = prompt('This Workboard requires an API key:');
    if (supplied) { sessionStorage.setItem('workboard-api-key', supplied); return api(path, options, false); }
  }
  if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.message || `Request failed (${response.status})`); }
  return response.status === 204 ? null : response.json();
}

function toast(message, error = false) {
  const el = $('#toast'); el.textContent = message; el.style.background = error ? '#b42332' : '#172033'; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 2400);
}

async function load() {
  try {
    const [data, stats] = await Promise.all([api('/state'), api('/stats')]);
    Object.assign(state, data);
    $('#board-name').textContent = state.board.name;
    renderBoard(); renderStats(stats); populateColumns();
  } catch (error) { toast(error.message, true); }
}

function filteredCards() {
  const q = state.query.q.toLowerCase();
  return state.cards.filter((card) => (!state.query.priority || card.priority === state.query.priority) && (!state.query.type || card.type === state.query.type) && (!q || [card.title, card.description, card.pluginName, card.assignee, ...card.tags].join(' ').toLowerCase().includes(q)));
}
function dateLabel(date) {
  if (!date) return '';
  const days = Math.ceil((new Date(`${date}T23:59:59`) - new Date()) / 86400000);
  return days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? 'Due today' : `Due ${new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}
function cardHtml(card) {
  const done = card.checklist.filter((item) => item.done).length;
  const percent = card.checklist.length ? done / card.checklist.length * 100 : 0;
  const overdue = card.dueDate && card.dueDate < new Date().toISOString().slice(0, 10) && card.columnId !== 'col_done';
  return `<article class="card" draggable="true" data-id="${card.id}" tabindex="0">
    <div class="card-top"><span class="badge ${card.type}">${escapeHtml(card.type)}</span><span class="priority ${card.priority}">${card.priority === 'urgent' ? '◆ ' : ''}${escapeHtml(card.priority)}</span></div>
    <h3>${escapeHtml(card.title)}</h3>${card.description ? `<p class="card-desc">${escapeHtml(card.description)}</p>` : ''}
    ${card.tags.length ? `<div class="tags">${card.tags.slice(0, 4).map((tag) => `<span class="tag">#${escapeHtml(tag)}</span>`).join('')}</div>` : ''}
    ${card.checklist.length ? `<div class="progress"><i style="width:${percent}%"></i></div>` : ''}
    <div class="card-meta">${card.pluginName ? `<span class="plugin">${escapeHtml(card.pluginName)}</span>` : '<span class="plugin">—</span>'}${card.checklist.length ? `<span>✓ ${done}/${card.checklist.length}</span>` : ''}${card.estimate ? `<span>${card.estimate}h</span>` : ''}${card.dueDate ? `<span class="${overdue ? 'overdue' : ''}">${dateLabel(card.dueDate)}</span>` : ''}</div>
  </article>`;
}
function renderBoard() {
  const cards = filteredCards();
  $('#board').innerHTML = [...state.columns].sort((a, b) => a.position - b.position).map((column) => {
    const list = cards.filter((card) => card.columnId === column.id).sort((a, b) => a.position - b.position);
    const exceeded = column.wipLimit && list.length > column.wipLimit;
    return `<section class="column"><div class="column-head"><i class="column-dot" style="background:${column.color}"></i><span class="column-title">${escapeHtml(column.name)}</span><span class="count">${list.length}</span>${column.wipLimit ? `<span class="wip ${exceeded ? 'exceeded' : ''}">WIP ${list.length}/${column.wipLimit}</span>` : ''}</div><div class="card-list" data-column="${column.id}">${list.length ? list.map(cardHtml).join('') : '<div class="empty">Drop tasks here</div>'}</div></section>`;
  }).join('');
  bindDrag();
  $$('.card').forEach((card) => { card.addEventListener('click', () => openCard(card.dataset.id)); card.addEventListener('keydown', (e) => { if (e.key === 'Enter') openCard(card.dataset.id); }); });
}
function renderStats(stats) { $('#metric-active').textContent = stats.active; $('#metric-progress').textContent = stats.byColumn.col_progress ?? state.cards.filter((c) => state.columns.find((x) => x.id === c.columnId)?.name.toLowerCase().includes('progress')).length; $('#metric-overdue').textContent = stats.overdue; $('#metric-hours').textContent = stats.estimates; }
function populateColumns() { $('#column-select').innerHTML = state.columns.sort((a,b) => a.position-b.position).map((column) => `<option value="${column.id}">${escapeHtml(column.name)}</option>`).join(''); }
function bindDrag() {
  $$('.card').forEach((card) => { card.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', card.dataset.id); card.classList.add('dragging'); }); card.addEventListener('dragend', () => card.classList.remove('dragging')); });
  $$('.card-list').forEach((list) => {
    list.addEventListener('dragover', (e) => { e.preventDefault(); list.classList.add('drag-over'); }); list.addEventListener('dragleave', () => list.classList.remove('drag-over'));
    list.addEventListener('drop', async (e) => { e.preventDefault(); list.classList.remove('drag-over'); try { await api(`/cards/${e.dataTransfer.getData('text/plain')}/move`, { method: 'POST', body: JSON.stringify({ columnId: list.dataset.column, position: 999 }) }); await load(); toast('Task moved'); } catch (error) { toast(error.message, true); } });
  });
}
function openCard(cardId = null) {
  const card = cardId ? state.cards.find((item) => item.id === cardId) : null;
  const form = $('#card-form'); form.reset(); form.elements.id.value = card?.id || ''; $('#dialog-kicker').textContent = card ? card.pluginName || 'WORK ITEM' : 'NEW WORK ITEM'; $('#dialog-title').textContent = card ? 'Edit task' : 'Create task'; $('#delete-card').classList.toggle('hidden', !card);
  if (card) for (const key of ['title','description','columnId','type','priority','estimate','pluginName','moodleVersion','assignee','dueDate','trackerUrl']) if (form.elements[key]) form.elements[key].value = card[key] ?? '';
  form.elements.tags.value = card?.tags.join(', ') || '';
  form.elements.checklist.value = card?.checklist.map((item) => `${item.done ? '[x] ' : ''}${item.text}`).join('\n') || '';
  $('#card-dialog').showModal(); setTimeout(() => form.elements.title.focus(), 50);
}
function formCard(form) {
  const data = Object.fromEntries(new FormData(form));
  data.tags = data.tags.split(',').map((tag) => tag.trim()).filter(Boolean); data.estimate = Number(data.estimate) || 0;
  data.checklist = data.checklist.split('\n').map((line) => ({ text: line.replace(/^\[x\]\s*/i, '').trim(), done: /^\[x\]/i.test(line) })).filter((item) => item.text);
  return data;
}
async function renderActivity() { const data = await api('/activity?limit=100'); $('#activity-list').innerHTML = data.items.map((item) => `<div class="activity-item"><span class="activity-icon">${item.action.includes('moved') ? '→' : item.action.includes('deleted') ? '×' : '✓'}</span><p>${escapeHtml(item.detail)}</p><time>${new Date(item.createdAt).toLocaleString()}</time></div>`).join('') || '<p>No activity yet.</p>'; }

$('#new-card').addEventListener('click', () => openCard());
$('#card-form').addEventListener('submit', async (e) => { e.preventDefault(); const data = formCard(e.currentTarget); const cardId = data.id; delete data.id; try { if (cardId) { const original = state.cards.find((card) => card.id === cardId); await api(`/cards/${cardId}`, { method: 'PATCH', body: JSON.stringify(data) }); if (original.columnId !== data.columnId) await api(`/cards/${cardId}/move`, { method: 'POST', body: JSON.stringify({ columnId: data.columnId, position: 999 }) }); } else await api('/cards', { method: 'POST', body: JSON.stringify(data) }); $('#card-dialog').close(); await load(); toast(cardId ? 'Task updated' : 'Task created'); } catch (error) { toast(error.message, true); } });
$('#delete-card').addEventListener('click', async () => { const id = $('#card-form').elements.id.value; if (!confirm('Permanently delete this task?')) return; try { await api(`/cards/${id}`, { method:'DELETE' }); $('#card-dialog').close(); await load(); toast('Task deleted'); } catch (error) { toast(error.message, true); } });
$$('[data-close]').forEach((button) => button.addEventListener('click', () => $('#card-dialog').close()));
$('#add-column').addEventListener('click', () => $('#column-dialog').showModal()); $$('[data-close-column]').forEach((button) => button.addEventListener('click', () => $('#column-dialog').close()));
$('#column-form').addEventListener('submit', async (e) => { e.preventDefault(); const data = Object.fromEntries(new FormData(e.currentTarget)); data.wipLimit = data.wipLimit ? Number(data.wipLimit) : null; try { await api('/columns', { method:'POST', body:JSON.stringify(data) }); $('#column-dialog').close(); e.currentTarget.reset(); await load(); toast('Column added'); } catch(error) { toast(error.message,true); } });
$('#search').addEventListener('input', (e) => { state.query.q = e.target.value; renderBoard(); }); $('#priority-filter').addEventListener('change', (e) => { state.query.priority = e.target.value; renderBoard(); }); $('#type-filter').addEventListener('change', (e) => { state.query.type = e.target.value; renderBoard(); });
$('#clear-filters').addEventListener('click', () => { state.query = { q:'',priority:'',type:'' }; $('#search').value=''; $('#priority-filter').value=''; $('#type-filter').value=''; renderBoard(); });
$$('.nav-item').forEach((button) => button.addEventListener('click', async () => { $$('.nav-item').forEach((x) => x.classList.remove('active')); button.classList.add('active'); const activity = button.dataset.view === 'activity'; $('#board').classList.toggle('hidden', activity); $('#board-toolbar').classList.toggle('hidden', activity); $('#activity-view').classList.toggle('hidden', !activity); if (activity) await renderActivity(); }));
$('#theme-toggle').addEventListener('click', () => { const dark = document.documentElement.dataset.theme === 'dark'; document.documentElement.dataset.theme = dark ? '' : 'dark'; localStorage.setItem('theme', dark ? 'light' : 'dark'); });
document.addEventListener('keydown', (e) => { if (e.key.toLowerCase() === 'n' && !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName) && !$('dialog[open]')) openCard(); if (e.key === 'Escape') $$('dialog[open]').forEach((dialog) => dialog.close()); });
if (localStorage.getItem('theme') === 'dark' || (!localStorage.getItem('theme') && matchMedia('(prefers-color-scheme:dark)').matches)) document.documentElement.dataset.theme = 'dark';
load();
