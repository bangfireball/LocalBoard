const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const now = () => new Date().toISOString();
const id = (prefix) => `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;

function initialState() {
  const createdAt = now();
  return {
    version: 1,
    board: { id: 'board_main', name: 'Moodle Plugin Workboard', description: 'Plan, build and ship custom Moodle plugins.', createdAt, updatedAt: createdAt },
    columns: [
      { id: 'col_backlog', name: 'Backlog', color: '#64748b', position: 0, wipLimit: null },
      { id: 'col_ready', name: 'Ready', color: '#8b5cf6', position: 1, wipLimit: 5 },
      { id: 'col_progress', name: 'In progress', color: '#f59e0b', position: 2, wipLimit: 3 },
      { id: 'col_review', name: 'Review / QA', color: '#06b6d4', position: 3, wipLimit: 3 },
      { id: 'col_done', name: 'Done', color: '#22c55e', position: 4, wipLimit: null }
    ],
    cards: [
      {
        id: 'card_welcome', columnId: 'col_backlog', title: 'Welcome — create your first work item',
        description: 'Use **New task** or press `N`. Drag cards between columns and use filters to focus your work.',
        priority: 'medium', type: 'feature', tags: ['example', 'moodle'], assignee: '', dueDate: '', estimate: 2,
        moodleVersion: '4.5', pluginName: 'local_example', trackerUrl: '', checklist: [
          { id: id('check'), text: 'Explore the board', done: false },
          { id: id('check'), text: 'Create a task', done: false }
        ], position: 0, archived: false, createdAt, updatedAt: createdAt
      }
    ],
    activity: [{ id: id('event'), action: 'board.created', cardId: null, detail: 'Workboard created', createdAt }]
  };
}

class Store {
  constructor(file) {
    this.file = file;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (!fs.existsSync(file)) this.write(initialState());
    this.state = this.read();
  }

  read() {
    try { return JSON.parse(fs.readFileSync(this.file, 'utf8')); }
    catch (error) { throw new Error(`Unable to read data store: ${error.message}`); }
  }

  write(state = this.state) {
    const temp = `${this.file}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`);
    fs.renameSync(temp, this.file);
  }

  save() { this.state.board.updatedAt = now(); this.write(); }
  event(action, cardId, detail) {
    this.state.activity.unshift({ id: id('event'), action, cardId, detail, createdAt: now() });
    this.state.activity = this.state.activity.slice(0, 500);
  }

  listCards(query = {}) {
    let cards = this.state.cards.filter((card) => query.archived === 'true' ? card.archived : !card.archived);
    if (query.columnId) cards = cards.filter((card) => card.columnId === query.columnId);
    if (query.priority) cards = cards.filter((card) => card.priority === query.priority);
    if (query.type) cards = cards.filter((card) => card.type === query.type);
    if (query.tag) cards = cards.filter((card) => card.tags.includes(query.tag));
    if (query.q) {
      const q = query.q.toLowerCase();
      cards = cards.filter((card) => [card.title, card.description, card.pluginName, card.assignee, ...card.tags].join(' ').toLowerCase().includes(q));
    }
    return cards.sort((a, b) => a.position - b.position);
  }

  createCard(input) {
    const column = this.state.columns.find((item) => item.id === input.columnId) || this.state.columns[0];
    if (!input.title?.trim()) throw Object.assign(new Error('title is required'), { status: 400 });
    const createdAt = now();
    const card = {
      id: id('card'), columnId: column.id, title: input.title.trim(), description: input.description || '',
      priority: ['low', 'medium', 'high', 'urgent'].includes(input.priority) ? input.priority : 'medium',
      type: ['feature', 'bug', 'maintenance', 'research', 'release'].includes(input.type) ? input.type : 'feature',
      tags: Array.isArray(input.tags) ? [...new Set(input.tags.map(String).map((tag) => tag.trim()).filter(Boolean))] : [],
      assignee: input.assignee || '', dueDate: input.dueDate || '', estimate: Number(input.estimate) || 0,
      moodleVersion: input.moodleVersion || '', pluginName: input.pluginName || '', trackerUrl: input.trackerUrl || '',
      checklist: Array.isArray(input.checklist) ? input.checklist.map((item) => ({ id: item.id || id('check'), text: String(item.text || ''), done: Boolean(item.done) })).filter((item) => item.text) : [],
      position: this.state.cards.filter((item) => item.columnId === column.id && !item.archived).length,
      archived: false, createdAt, updatedAt: createdAt
    };
    this.state.cards.push(card);
    this.event('card.created', card.id, `Created “${card.title}”`);
    this.save();
    return card;
  }

  getCard(cardId) {
    const card = this.state.cards.find((item) => item.id === cardId);
    if (!card) throw Object.assign(new Error('card not found'), { status: 404 });
    return card;
  }

  updateCard(cardId, input) {
    const card = this.getCard(cardId);
    const allowed = ['title', 'description', 'priority', 'type', 'tags', 'assignee', 'dueDate', 'estimate', 'moodleVersion', 'pluginName', 'trackerUrl', 'checklist', 'archived'];
    for (const key of allowed) if (Object.hasOwn(input, key)) card[key] = input[key];
    if (!String(card.title || '').trim()) throw Object.assign(new Error('title is required'), { status: 400 });
    card.title = card.title.trim();
    card.tags = Array.isArray(card.tags) ? [...new Set(card.tags.map(String).map((tag) => tag.trim()).filter(Boolean))] : [];
    card.checklist = Array.isArray(card.checklist) ? card.checklist.map((item) => ({ id: item.id || id('check'), text: String(item.text || ''), done: Boolean(item.done) })).filter((item) => item.text) : [];
    card.updatedAt = now();
    this.event(card.archived ? 'card.archived' : 'card.updated', card.id, `Updated “${card.title}”`);
    this.save();
    return card;
  }

  moveCard(cardId, columnId, position) {
    const card = this.getCard(cardId);
    if (!this.state.columns.some((item) => item.id === columnId)) throw Object.assign(new Error('column not found'), { status: 404 });
    const oldColumn = card.columnId;
    const siblings = this.state.cards.filter((item) => item.columnId === columnId && item.id !== card.id && !item.archived).sort((a, b) => a.position - b.position);
    const target = Math.max(0, Math.min(Number.isFinite(Number(position)) ? Number(position) : siblings.length, siblings.length));
    siblings.splice(target, 0, card);
    card.columnId = columnId;
    siblings.forEach((item, index) => { item.position = index; });
    this.state.cards.filter((item) => item.columnId === oldColumn && item.id !== card.id && !item.archived).sort((a, b) => a.position - b.position).forEach((item, index) => { item.position = index; });
    card.updatedAt = now();
    this.event('card.moved', card.id, `Moved “${card.title}”`);
    this.save();
    return card;
  }

  deleteCard(cardId) {
    const card = this.getCard(cardId);
    this.state.cards = this.state.cards.filter((item) => item.id !== cardId);
    this.event('card.deleted', cardId, `Deleted “${card.title}”`);
    this.save();
  }

  createColumn(input) {
    if (!input.name?.trim()) throw Object.assign(new Error('name is required'), { status: 400 });
    const column = { id: id('col'), name: input.name.trim(), color: input.color || '#64748b', position: this.state.columns.length, wipLimit: input.wipLimit ? Number(input.wipLimit) : null };
    this.state.columns.push(column); this.event('column.created', null, `Created column “${column.name}”`); this.save(); return column;
  }

  updateColumn(columnId, input) {
    const column = this.state.columns.find((item) => item.id === columnId);
    if (!column) throw Object.assign(new Error('column not found'), { status: 404 });
    for (const key of ['name', 'color', 'wipLimit']) if (Object.hasOwn(input, key)) column[key] = input[key];
    if (Array.isArray(input.order)) input.order.forEach((id, index) => { const found = this.state.columns.find((item) => item.id === id); if (found) found.position = index; });
    this.event('column.updated', null, `Updated column “${column.name}”`); this.save(); return column;
  }

  deleteColumn(columnId, moveTo) {
    if (this.state.columns.length === 1) throw Object.assign(new Error('cannot delete the only column'), { status: 400 });
    const column = this.state.columns.find((item) => item.id === columnId);
    if (!column) throw Object.assign(new Error('column not found'), { status: 404 });
    const target = this.state.columns.find((item) => item.id === moveTo && item.id !== columnId) || this.state.columns.find((item) => item.id !== columnId);
    this.state.cards.filter((item) => item.columnId === columnId).forEach((item) => { item.columnId = target.id; });
    this.state.columns = this.state.columns.filter((item) => item.id !== columnId);
    this.state.columns.sort((a, b) => a.position - b.position).forEach((item, index) => { item.position = index; });
    this.event('column.deleted', null, `Deleted column “${column.name}”`); this.save();
  }
}

module.exports = { Store, initialState };
