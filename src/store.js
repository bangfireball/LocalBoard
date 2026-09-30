const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const now = () => new Date().toISOString();
const makeId = (prefix) => `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
const httpError = (message, status = 400) => Object.assign(new Error(message), { status });
const labelColors = ['#4bce97', '#f5cd47', '#fea362', '#f87168', '#9f8fef', '#579dff'];
function defaultLabels() { return labelColors.map((color, index) => ({ id: makeId('label'), name: '', color, position: index })); }

function initialState() {
  const timestamp = now();
  return {
    version: 4,
    boards: [{ id: 'board_main', name: 'My Work Board', background: '#0c66e4', labels: defaultLabels(), createdAt: timestamp, updatedAt: timestamp }],
    lists: [
      { id: 'list_todo', boardId: 'board_main', name: 'To do', position: 0 },
      { id: 'list_doing', boardId: 'board_main', name: 'Doing', position: 1 },
      { id: 'list_done', boardId: 'board_main', name: 'Done', position: 2 }
    ],
    cards: [{ id: 'card_welcome', listId: 'list_todo', title: 'Welcome to your new board 👋', description: 'Drag this card between lists, or click it to add details.', labels: [], dueDate: '', checklist: [{ id: makeId('item'), text: 'Create your first card', done: false }], photos: [], position: 0, createdAt: timestamp, updatedAt: timestamp }]
  };
}

class Store {
  constructor(file) {
    this.file = file;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (!fs.existsSync(file)) this.write(initialState());
    this.state = this.read();
    if (this.state.version === 2) this.migrateV2();
    if (this.state.version === 3) this.migrateV3();
    if (this.state.version !== 4) { this.state = initialState(); this.write(); }
    let changed = false;
    this.state.cards.forEach((card) => { if (!Array.isArray(card.photos)) { card.photos = []; changed = true; } });
    if (changed) this.write();
  }

  read() {
    try { return JSON.parse(fs.readFileSync(this.file, 'utf8')); }
    catch (error) { throw new Error(`Unable to read data store: ${error.message}`); }
  }
  write(state = this.state) { const temporary = `${this.file}.tmp`; fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`); fs.renameSync(temporary, this.file); }
  save() { this.write(); }
  migrateV2() {
    const board = this.state.board || initialState().boards[0];
    this.state = { version: 3, boards: [board], lists: (this.state.lists || []).map((list) => ({ ...list, boardId: board.id })), cards: this.state.cards || [] };
  }
  migrateV3() {
    this.state.boards.forEach((board) => {
      const listIds = new Set(this.state.lists.filter((list) => list.boardId === board.id).map((list) => list.id));
      const cards = this.state.cards.filter((card) => listIds.has(card.listId));
      const names = [...new Set(cards.flatMap((card) => card.labels || []).filter(Boolean))];
      board.labels = defaultLabels();
      const named = names.map((name, index) => ({ id: makeId('label'), name, color: labelColors[index % labelColors.length], position: board.labels.length + index }));
      board.labels.push(...named);
      cards.forEach((card) => { card.labels = (card.labels || []).map((name) => named.find((label) => label.name === name)?.id).filter(Boolean); });
    });
    this.state.version = 4; this.write();
  }

  getBoard(boardId) {
    const board = this.state.boards.find((item) => item.id === boardId);
    if (!board) throw httpError('board not found', 404);
    return board;
  }
  boardState(boardId) {
    const board = this.getBoard(boardId || this.state.boards[0]?.id);
    const lists = this.state.lists.filter((list) => list.boardId === board.id).sort((a, b) => a.position - b.position);
    const listIds = new Set(lists.map((list) => list.id));
    return { board, lists, cards: this.state.cards.filter((card) => listIds.has(card.listId)).sort((a, b) => a.position - b.position) };
  }
  createBoard(input) {
    if (!input.name?.trim()) throw httpError('name is required');
    const timestamp = now();
    const board = { id: makeId('board'), name: input.name.trim(), background: input.background || '#0c66e4', labels: defaultLabels(), createdAt: timestamp, updatedAt: timestamp };
    this.state.boards.push(board);
    ['To do', 'Doing', 'Done'].forEach((name, position) => this.state.lists.push({ id: makeId('list'), boardId: board.id, name, position }));
    this.save(); return board;
  }
  updateBoard(boardId, input) {
    const board = this.getBoard(boardId);
    if (Object.hasOwn(input, 'name')) { if (!input.name?.trim()) throw httpError('name is required'); board.name = input.name.trim(); }
    if (Object.hasOwn(input, 'background')) board.background = String(input.background);
    board.updatedAt = now(); this.save(); return board;
  }
  deleteBoard(boardId) {
    this.getBoard(boardId);
    if (this.state.boards.length === 1) throw httpError('cannot delete the only board');
    const listIds = new Set(this.state.lists.filter((list) => list.boardId === boardId).map((list) => list.id));
    const removedPhotos = this.state.cards.filter((card) => listIds.has(card.listId)).flatMap((card) => card.photos || []);
    this.state.cards = this.state.cards.filter((card) => !listIds.has(card.listId));
    this.state.lists = this.state.lists.filter((list) => list.boardId !== boardId);
    this.state.boards = this.state.boards.filter((board) => board.id !== boardId);
    this.save(); return removedPhotos;
  }

  listCards(query = {}) {
    let cards = [...this.state.cards];
    if (query.boardId) { const ids = new Set(this.state.lists.filter((list) => list.boardId === query.boardId).map((list) => list.id)); cards = cards.filter((card) => ids.has(card.listId)); }
    if (query.listId) cards = cards.filter((card) => card.listId === query.listId);
    if (query.label) cards = cards.filter((card) => card.labels.includes(query.label));
    if (query.q) { const q = String(query.q).toLowerCase(); cards = cards.filter((card) => { const board = this.boardForCard(card); const names = card.labels.map((id) => board.labels.find((label) => label.id === id)?.name || ''); return [card.title, card.description, ...names].join(' ').toLowerCase().includes(q); }); }
    return cards.sort((a, b) => a.position - b.position);
  }
  getCard(cardId) { const card = this.state.cards.find((item) => item.id === cardId); if (!card) throw httpError('card not found', 404); return card; }
  createCard(input) {
    if (!input.title?.trim()) throw httpError('title is required');
    const list = this.state.lists.find((item) => item.id === input.listId);
    if (!list) throw httpError('valid listId is required');
    const timestamp = now();
    const card = { id: makeId('card'), listId: list.id, title: input.title.trim(), description: String(input.description || ''), labels: this.cleanLabels(input.labels, list.boardId), dueDate: String(input.dueDate || ''), checklist: this.cleanChecklist(input.checklist), photos: [], position: this.state.cards.filter((item) => item.listId === list.id).length, createdAt: timestamp, updatedAt: timestamp };
    this.state.cards.push(card); this.touchBoard(list.boardId); this.save(); return card;
  }
  updateCard(cardId, input) {
    const card = this.getCard(cardId);
    for (const key of ['title', 'description', 'dueDate']) if (Object.hasOwn(input, key)) card[key] = String(input[key] ?? '');
    if (Object.hasOwn(input, 'labels')) card.labels = this.cleanLabels(input.labels, this.listFor(card.listId).boardId);
    if (Object.hasOwn(input, 'checklist')) card.checklist = this.cleanChecklist(input.checklist);
    if (!card.title.trim()) throw httpError('title is required');
    card.title = card.title.trim(); card.updatedAt = now(); this.touchBoard(this.listFor(card.listId).boardId); this.save(); return card;
  }
  moveCard(cardId, listId, position) {
    const card = this.getCard(cardId); const targetList = this.listFor(listId); const oldList = this.listFor(card.listId);
    if (targetList.boardId !== oldList.boardId) throw httpError('cards cannot move between boards');
    const oldListId = card.listId;
    const destination = this.state.cards.filter((item) => item.listId === listId && item.id !== cardId).sort((a, b) => a.position - b.position);
    const target = Math.max(0, Math.min(Number.isFinite(Number(position)) ? Number(position) : destination.length, destination.length));
    card.listId = listId; destination.splice(target, 0, card); destination.forEach((item, index) => { item.position = index; });
    if (oldListId !== listId) this.reindex(oldListId);
    card.updatedAt = now(); this.touchBoard(targetList.boardId); this.save(); return card;
  }
  deleteCard(cardId) { const card = this.getCard(cardId); const list = this.listFor(card.listId); this.state.cards = this.state.cards.filter((item) => item.id !== cardId); this.reindex(card.listId); this.touchBoard(list.boardId); this.save(); return card; }
  addPhoto(cardId, photo) {
    const card = this.getCard(cardId);
    const item = { id: makeId('photo'), name: String(photo.name || 'photo'), url: photo.url, mime: photo.mime, size: photo.size, createdAt: now() };
    card.photos.push(item); card.updatedAt = now(); this.touchBoard(this.listFor(card.listId).boardId); this.save(); return item;
  }
  removePhoto(cardId, photoId) {
    const card = this.getCard(cardId); const photo = card.photos.find((item) => item.id === photoId);
    if (!photo) throw httpError('photo not found', 404);
    card.photos = card.photos.filter((item) => item.id !== photoId); card.updatedAt = now(); this.touchBoard(this.listFor(card.listId).boardId); this.save(); return photo;
  }

  createList(input) {
    if (!input.name?.trim()) throw httpError('name is required');
    const board = this.getBoard(input.boardId);
    const list = { id: makeId('list'), boardId: board.id, name: input.name.trim(), position: this.state.lists.filter((item) => item.boardId === board.id).length };
    this.state.lists.push(list); this.touchBoard(board.id); this.save(); return list;
  }
  updateList(listId, input) {
    const list = this.listFor(listId);
    if (Object.hasOwn(input, 'name')) { if (!input.name?.trim()) throw httpError('name is required'); list.name = input.name.trim(); }
    this.touchBoard(list.boardId); this.save(); return list;
  }
  deleteList(listId) {
    const list = this.listFor(listId);
    if (this.state.cards.some((card) => card.listId === listId)) throw httpError('move or delete this list’s cards first');
    this.state.lists = this.state.lists.filter((item) => item.id !== listId); this.reindexLists(list.boardId); this.touchBoard(list.boardId); this.save();
  }

  createLabel(boardId, input) {
    const board = this.getBoard(boardId); const color = String(input.color || '#4bce97');
    const label = { id: makeId('label'), name: String(input.name || '').trim(), color, position: board.labels.length };
    board.labels.push(label); this.touchBoard(boardId); this.save(); return label;
  }
  updateLabel(boardId, labelId, input) {
    const board = this.getBoard(boardId); const label = board.labels.find((item) => item.id === labelId);
    if (!label) throw httpError('label not found', 404);
    if (Object.hasOwn(input, 'name')) label.name = String(input.name || '').trim();
    if (Object.hasOwn(input, 'color')) label.color = String(input.color);
    this.touchBoard(boardId); this.save(); return label;
  }
  deleteLabel(boardId, labelId) {
    const board = this.getBoard(boardId); if (!board.labels.some((item) => item.id === labelId)) throw httpError('label not found', 404);
    board.labels = board.labels.filter((item) => item.id !== labelId);
    const listIds = new Set(this.state.lists.filter((list) => list.boardId === boardId).map((list) => list.id));
    this.state.cards.filter((card) => listIds.has(card.listId)).forEach((card) => { card.labels = card.labels.filter((id) => id !== labelId); });
    this.touchBoard(boardId); this.save();
  }
  listFor(listId) { const list = this.state.lists.find((item) => item.id === listId); if (!list) throw httpError('list not found', 404); return list; }
  boardForCard(card) { return this.getBoard(this.listFor(card.listId).boardId); }
  touchBoard(boardId) { const board = this.getBoard(boardId); board.updatedAt = now(); }
  cleanLabels(labels, boardId) { const valid = new Set(this.getBoard(boardId).labels.map((label) => label.id)); return Array.isArray(labels) ? [...new Set(labels.map(String).filter((id) => valid.has(id)))].slice(0, 20) : []; }
  cleanChecklist(items) { return Array.isArray(items) ? items.map((item) => ({ id: item.id || makeId('item'), text: String(item.text || '').trim(), done: Boolean(item.done) })).filter((item) => item.text) : []; }
  reindex(listId) { this.state.cards.filter((item) => item.listId === listId).sort((a, b) => a.position - b.position).forEach((item, index) => { item.position = index; }); }
  reindexLists(boardId) { this.state.lists.filter((item) => item.boardId === boardId).sort((a, b) => a.position - b.position).forEach((item, index) => { item.position = index; }); }
}

module.exports = { Store, initialState };
