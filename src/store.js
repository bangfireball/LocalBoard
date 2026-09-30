const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const now = () => new Date().toISOString();
const makeId = (prefix) => `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;

function initialState() {
  const timestamp = now();
  return {
    version: 2,
    board: { id: 'board_main', name: 'My Work Board', background: '#0c66e4', createdAt: timestamp, updatedAt: timestamp },
    lists: [
      { id: 'list_todo', name: 'To do', position: 0 },
      { id: 'list_doing', name: 'Doing', position: 1 },
      { id: 'list_done', name: 'Done', position: 2 }
    ],
    cards: [
      {
        id: 'card_welcome', listId: 'list_todo', title: 'Welcome to your new board 👋',
        description: 'Drag this card between lists, or click it to add details.', labels: ['Getting started'],
        dueDate: '', checklist: [{ id: makeId('item'), text: 'Create your first card', done: false }],
        position: 0, createdAt: timestamp, updatedAt: timestamp
      }
    ]
  };
}

function httpError(message, status = 400) { return Object.assign(new Error(message), { status }); }

class Store {
  constructor(file) {
    this.file = file;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (!fs.existsSync(file)) this.write(initialState());
    this.state = this.read();
    if (this.state.version !== 2) { this.state = initialState(); this.write(); }
  }

  read() {
    try { return JSON.parse(fs.readFileSync(this.file, 'utf8')); }
    catch (error) { throw new Error(`Unable to read data store: ${error.message}`); }
  }

  write(state = this.state) {
    const temporary = `${this.file}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`);
    fs.renameSync(temporary, this.file);
  }

  save() { this.state.board.updatedAt = now(); this.write(); }
  listCards(query = {}) {
    let cards = [...this.state.cards];
    if (query.listId) cards = cards.filter((card) => card.listId === query.listId);
    if (query.label) cards = cards.filter((card) => card.labels.includes(query.label));
    if (query.q) {
      const q = String(query.q).toLowerCase();
      cards = cards.filter((card) => [card.title, card.description, ...card.labels].join(' ').toLowerCase().includes(q));
    }
    return cards.sort((a, b) => a.position - b.position);
  }

  getCard(cardId) {
    const card = this.state.cards.find((item) => item.id === cardId);
    if (!card) throw httpError('card not found', 404);
    return card;
  }

  createCard(input) {
    if (!input.title?.trim()) throw httpError('title is required');
    const list = this.state.lists.find((item) => item.id === input.listId) || this.state.lists[0];
    if (!list) throw httpError('create a list before adding a card');
    const timestamp = now();
    const card = {
      id: makeId('card'), listId: list.id, title: input.title.trim(), description: String(input.description || ''),
      labels: this.cleanLabels(input.labels), dueDate: String(input.dueDate || ''), checklist: this.cleanChecklist(input.checklist),
      position: this.state.cards.filter((item) => item.listId === list.id).length, createdAt: timestamp, updatedAt: timestamp
    };
    this.state.cards.push(card); this.save(); return card;
  }

  updateCard(cardId, input) {
    const card = this.getCard(cardId);
    for (const key of ['title', 'description', 'dueDate']) if (Object.hasOwn(input, key)) card[key] = String(input[key] ?? '');
    if (Object.hasOwn(input, 'labels')) card.labels = this.cleanLabels(input.labels);
    if (Object.hasOwn(input, 'checklist')) card.checklist = this.cleanChecklist(input.checklist);
    if (!card.title.trim()) throw httpError('title is required');
    card.title = card.title.trim(); card.updatedAt = now(); this.save(); return card;
  }

  moveCard(cardId, listId, position) {
    const card = this.getCard(cardId);
    if (!this.state.lists.some((list) => list.id === listId)) throw httpError('list not found', 404);
    const oldListId = card.listId;
    const destination = this.state.cards.filter((item) => item.listId === listId && item.id !== cardId).sort((a, b) => a.position - b.position);
    const target = Math.max(0, Math.min(Number.isFinite(Number(position)) ? Number(position) : destination.length, destination.length));
    card.listId = listId; destination.splice(target, 0, card); destination.forEach((item, index) => { item.position = index; });
    if (oldListId !== listId) this.reindex(oldListId);
    card.updatedAt = now(); this.save(); return card;
  }

  deleteCard(cardId) {
    const card = this.getCard(cardId); this.state.cards = this.state.cards.filter((item) => item.id !== cardId); this.reindex(card.listId); this.save();
  }

  createList(input) {
    if (!input.name?.trim()) throw httpError('name is required');
    const list = { id: makeId('list'), name: input.name.trim(), position: this.state.lists.length };
    this.state.lists.push(list); this.save(); return list;
  }

  updateList(listId, input) {
    const list = this.state.lists.find((item) => item.id === listId);
    if (!list) throw httpError('list not found', 404);
    if (Object.hasOwn(input, 'name')) { if (!input.name?.trim()) throw httpError('name is required'); list.name = input.name.trim(); }
    if (Array.isArray(input.order)) input.order.forEach((id, index) => { const found = this.state.lists.find((item) => item.id === id); if (found) found.position = index; });
    this.save(); return list;
  }

  deleteList(listId) {
    const list = this.state.lists.find((item) => item.id === listId);
    if (!list) throw httpError('list not found', 404);
    if (this.state.cards.some((card) => card.listId === listId)) throw httpError('move or delete this list’s cards first');
    this.state.lists = this.state.lists.filter((item) => item.id !== listId); this.state.lists.forEach((item, index) => { item.position = index; }); this.save();
  }

  cleanLabels(labels) { return Array.isArray(labels) ? [...new Set(labels.map(String).map((label) => label.trim()).filter(Boolean))].slice(0, 10) : []; }
  cleanChecklist(items) { return Array.isArray(items) ? items.map((item) => ({ id: item.id || makeId('item'), text: String(item.text || '').trim(), done: Boolean(item.done) })).filter((item) => item.text) : []; }
  reindex(listId) { this.state.cards.filter((item) => item.listId === listId).sort((a, b) => a.position - b.position).forEach((item, index) => { item.position = index; }); }
}

module.exports = { Store, initialState };
