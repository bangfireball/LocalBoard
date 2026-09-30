const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const now = () => new Date().toISOString();
const makeId = (prefix) => `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
const httpError = (message, status = 400) => Object.assign(new Error(message), { status });
const labelColors = ['#4bce97', '#f5cd47', '#fea362', '#f87168', '#9f8fef', '#579dff'];
const recurrences = ['none', 'daily', 'weekly', 'monthly', 'yearly'];
const defaultLabels = () => labelColors.map((color, position) => ({ id: makeId('label'), name: '', color, position }));

function initialState() {
  const timestamp = now();
  return {
    version: 5,
    boards: [{ id: 'board_main', name: 'My Work Board', background: '#0c66e4', labels: defaultLabels(), createdAt: timestamp, updatedAt: timestamp }],
    lists: [
      { id: 'list_todo', boardId: 'board_main', name: 'To do', position: 0, archived: false },
      { id: 'list_doing', boardId: 'board_main', name: 'Doing', position: 1, archived: false },
      { id: 'list_done', boardId: 'board_main', name: 'Done', position: 2, archived: false }
    ],
    cards: [{
      id: 'card_welcome', listId: 'list_todo', title: 'Welcome to LocalBoard 👋', description: 'Drag this card between lists, or click it to add details.', labels: [],
      dueAt: '', dueComplete: false, reminderMinutes: null, recurrence: 'none', assignee: '', checklist: [{ id: makeId('item'), text: 'Create your first card', done: false }],
      attachments: [], position: 0, archived: false, createdAt: timestamp, updatedAt: timestamp
    }],
    comments: [],
    activity: [{ id: makeId('activity'), boardId: 'board_main', cardId: null, action: 'board.created', detail: 'Board created', createdAt: timestamp }]
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
    if (this.state.version === 4) this.migrateV4();
    if (this.state.version !== 5) { this.state = initialState(); this.write(); }
  }

  read() { try { return JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch (error) { throw new Error(`Unable to read data store: ${error.message}`); } }
  write(state = this.state) { const temporary = `${this.file}.tmp`; fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`); fs.renameSync(temporary, this.file); }
  save() { this.write(); }
  migrateV2() {
    const board = this.state.board || initialState().boards[0];
    this.state = { version: 3, boards: [board], lists: (this.state.lists || []).map((list) => ({ ...list, boardId: board.id })), cards: this.state.cards || [] };
  }
  migrateV3() {
    this.state.boards.forEach((board) => {
      const cards = this.cardsForBoard(board.id);
      const names = [...new Set(cards.flatMap((card) => card.labels || []).filter(Boolean))];
      board.labels = defaultLabels();
      const named = names.map((name, index) => ({ id: makeId('label'), name, color: labelColors[index % labelColors.length], position: board.labels.length + index }));
      board.labels.push(...named);
      cards.forEach((card) => { card.labels = (card.labels || []).map((name) => named.find((label) => label.name === name)?.id).filter(Boolean); });
    });
    this.state.version = 4;
  }
  migrateV4() {
    this.state.lists.forEach((list) => { list.archived = Boolean(list.archived); });
    this.state.cards.forEach((card) => {
      card.dueAt = card.dueAt || (card.dueDate ? `${card.dueDate}T17:00:00` : ''); delete card.dueDate;
      card.dueComplete = Boolean(card.dueComplete); card.reminderMinutes = card.reminderMinutes ?? null; card.recurrence = card.recurrence || 'none'; card.assignee = card.assignee || '';
      card.archived = Boolean(card.archived);
      card.attachments = (card.attachments || card.photos || []).map((item) => ({ ...item, kind: item.kind || 'file' })); delete card.photos;
    });
    this.state.comments ||= []; this.state.activity ||= [];
    this.state.version = 5; this.write();
  }

  getBoard(boardId) { const board = this.state.boards.find((item) => item.id === boardId); if (!board) throw httpError('board not found', 404); return board; }
  listFor(listId) { const list = this.state.lists.find((item) => item.id === listId); if (!list) throw httpError('list not found', 404); return list; }
  getCard(cardId) { const card = this.state.cards.find((item) => item.id === cardId); if (!card) throw httpError('card not found', 404); return card; }
  cardsForBoard(boardId) { const ids = new Set(this.state.lists.filter((list) => list.boardId === boardId).map((list) => list.id)); return this.state.cards.filter((card) => ids.has(card.listId)); }
  boardForCard(card) { return this.getBoard(this.listFor(card.listId).boardId); }
  touchBoard(boardId) { this.getBoard(boardId).updatedAt = now(); }
  log(boardId, cardId, action, detail) {
    this.state.activity.unshift({ id: makeId('activity'), boardId, cardId: cardId || null, action, detail, createdAt: now() });
    this.state.activity = this.state.activity.slice(0, 5000);
  }

  boardState(boardId) {
    const board = this.getBoard(boardId || this.state.boards[0]?.id);
    const lists = this.state.lists.filter((list) => list.boardId === board.id && !list.archived).sort((a, b) => a.position - b.position);
    const listIds = new Set(lists.map((list) => list.id));
    return { board, lists, cards: this.state.cards.filter((card) => listIds.has(card.listId) && !card.archived).sort((a, b) => a.position - b.position) };
  }
  archiveState(boardId) {
    const board = this.getBoard(boardId); const allLists = this.state.lists.filter((list) => list.boardId === board.id);
    const ids = new Set(allLists.map((list) => list.id));
    return { lists: allLists.filter((list) => list.archived), cards: this.state.cards.filter((card) => ids.has(card.listId) && (card.archived || this.listFor(card.listId).archived)) };
  }
  createBoard(input) {
    if (!input.name?.trim()) throw httpError('name is required');
    const timestamp = now(); const board = { id: makeId('board'), name: input.name.trim(), background: input.background || '#0c66e4', labels: defaultLabels(), createdAt: timestamp, updatedAt: timestamp };
    this.state.boards.push(board); ['To do', 'Doing', 'Done'].forEach((name, position) => this.state.lists.push({ id: makeId('list'), boardId: board.id, name, position, archived: false }));
    this.log(board.id, null, 'board.created', `Created board “${board.name}”`); this.save(); return board;
  }
  updateBoard(boardId, input) {
    const board = this.getBoard(boardId); const before = board.name;
    if (Object.hasOwn(input, 'name')) { if (!input.name?.trim()) throw httpError('name is required'); board.name = input.name.trim(); }
    if (Object.hasOwn(input, 'background')) board.background = String(input.background);
    this.touchBoard(boardId); this.log(boardId, null, 'board.updated', before === board.name ? 'Changed board settings' : `Renamed board to “${board.name}”`); this.save(); return board;
  }
  deleteBoard(boardId) {
    this.getBoard(boardId); if (this.state.boards.length === 1) throw httpError('cannot delete the only board');
    const listIds = new Set(this.state.lists.filter((list) => list.boardId === boardId).map((list) => list.id));
    const removedCards = this.state.cards.filter((card) => listIds.has(card.listId)); const removedAttachments = removedCards.flatMap((card) => card.attachments || []).filter((item) => item.kind === 'file');
    const cardIds = new Set(removedCards.map((card) => card.id));
    this.state.comments = this.state.comments.filter((comment) => !cardIds.has(comment.cardId)); this.state.cards = this.state.cards.filter((card) => !listIds.has(card.listId));
    this.state.lists = this.state.lists.filter((list) => list.boardId !== boardId); this.state.boards = this.state.boards.filter((board) => board.id !== boardId); this.state.activity = this.state.activity.filter((item) => item.boardId !== boardId);
    this.save(); return removedAttachments;
  }

  listCards(query = {}) {
    let cards = [...this.state.cards];
    if (query.boardId) cards = this.cardsForBoard(query.boardId);
    if (query.listId) cards = cards.filter((card) => card.listId === query.listId);
    if (query.archived === 'true') cards = cards.filter((card) => card.archived); else if (query.archived !== 'all') cards = cards.filter((card) => !card.archived);
    if (query.label) cards = cards.filter((card) => card.labels.includes(query.label));
    if (query.q) { const q = String(query.q).toLowerCase(); cards = cards.filter((card) => { const names = card.labels.map((id) => this.boardForCard(card).labels.find((label) => label.id === id)?.name || ''); return [card.title, card.description, card.assignee, ...names].join(' ').toLowerCase().includes(q); }); }
    return cards.sort((a, b) => a.position - b.position);
  }
  createCard(input) {
    if (!input.title?.trim()) throw httpError('title is required');
    const list = this.listFor(input.listId); if (list.archived) throw httpError('cannot add a card to an archived list');
    const timestamp = now();
    const card = { id: makeId('card'), listId: list.id, title: input.title.trim(), description: String(input.description || ''), labels: this.cleanLabels(input.labels, list.boardId), dueAt: String(input.dueAt || ''), dueComplete: false, reminderMinutes: input.reminderMinutes ?? null, recurrence: this.cleanRecurrence(input.recurrence), assignee: String(input.assignee || ''), checklist: this.cleanChecklist(input.checklist), attachments: [], position: this.state.cards.filter((item) => item.listId === list.id && !item.archived).length, archived: false, createdAt: timestamp, updatedAt: timestamp };
    this.state.cards.push(card); this.touchBoard(list.boardId); this.log(list.boardId, card.id, 'card.created', `Created “${card.title}”`); this.save(); return card;
  }
  updateCard(cardId, input) {
    const card = this.getCard(cardId); const boardId = this.listFor(card.listId).boardId; const changes = [];
    for (const key of ['title', 'description', 'dueAt', 'assignee']) if (Object.hasOwn(input, key) && String(input[key] ?? '') !== card[key]) { card[key] = String(input[key] ?? ''); changes.push(key); }
    if (Object.hasOwn(input, 'labels')) { card.labels = this.cleanLabels(input.labels, boardId); changes.push('labels'); }
    if (Object.hasOwn(input, 'checklist')) { card.checklist = this.cleanChecklist(input.checklist); changes.push('checklist'); }
    if (Object.hasOwn(input, 'reminderMinutes')) { card.reminderMinutes = input.reminderMinutes === null || input.reminderMinutes === '' ? null : Math.max(0, Number(input.reminderMinutes)); changes.push('reminder'); }
    if (Object.hasOwn(input, 'recurrence')) { card.recurrence = this.cleanRecurrence(input.recurrence); changes.push('recurrence'); }
    if (Object.hasOwn(input, 'dueComplete') && Boolean(input.dueComplete) !== card.dueComplete) { card.dueComplete = Boolean(input.dueComplete); changes.push(card.dueComplete ? 'due date completed' : 'due date reopened'); }
    if (!card.title.trim()) throw httpError('title is required');
    card.title = card.title.trim(); card.updatedAt = now(); this.touchBoard(boardId);
    if (changes.length) this.log(boardId, card.id, changes.includes('due date completed') ? 'due.completed' : 'card.updated', `Updated ${changes.join(', ')} on “${card.title}”`);
    this.save(); return card;
  }
  completeDue(cardId) {
    const card = this.getCard(cardId); const boardId = this.listFor(card.listId).boardId;
    if (!card.dueAt) throw httpError('card has no due date');
    if (card.recurrence !== 'none') { const previous = card.dueAt; card.dueAt = this.nextDue(card.dueAt, card.recurrence); card.dueComplete = false; this.log(boardId, card.id, 'due.recurring', `Completed occurrence due ${previous}; next due ${card.dueAt}`); }
    else { card.dueComplete = true; this.log(boardId, card.id, 'due.completed', `Completed due date on “${card.title}”`); }
    card.updatedAt = now(); this.touchBoard(boardId); this.save(); return card;
  }
  moveCard(cardId, listId, position) {
    const card = this.getCard(cardId); const targetList = this.listFor(listId); const oldList = this.listFor(card.listId);
    if (targetList.boardId !== oldList.boardId) throw httpError('cards cannot move between boards'); if (targetList.archived) throw httpError('cannot move to an archived list');
    const oldListId = card.listId; const destination = this.state.cards.filter((item) => item.listId === listId && item.id !== cardId && !item.archived).sort((a, b) => a.position - b.position);
    const target = Math.max(0, Math.min(Number.isFinite(Number(position)) ? Number(position) : destination.length, destination.length));
    card.listId = listId; destination.splice(target, 0, card); destination.forEach((item, index) => { item.position = index; }); if (oldListId !== listId) this.reindex(oldListId);
    card.updatedAt = now(); this.touchBoard(targetList.boardId); this.log(targetList.boardId, card.id, 'card.moved', `Moved “${card.title}” from ${oldList.name} to ${targetList.name}`); this.save(); return card;
  }
  archiveCard(cardId, archived = true) {
    const card = this.getCard(cardId); const list = this.listFor(card.listId); card.archived = Boolean(archived); if (!archived && list.archived) list.archived = false; card.updatedAt = now(); this.reindex(card.listId); this.touchBoard(list.boardId); this.log(list.boardId, card.id, archived ? 'card.archived' : 'card.restored', `${archived ? 'Archived' : 'Restored'} “${card.title}”`); this.save(); return card;
  }
  deleteCard(cardId) {
    const card = this.getCard(cardId); const list = this.listFor(card.listId); this.state.cards = this.state.cards.filter((item) => item.id !== cardId); this.state.comments = this.state.comments.filter((item) => item.cardId !== cardId); this.reindex(card.listId); this.touchBoard(list.boardId); this.log(list.boardId, cardId, 'card.deleted', `Permanently deleted “${card.title}”`); this.save(); return card;
  }

  createList(input) {
    if (!input.name?.trim()) throw httpError('name is required'); const board = this.getBoard(input.boardId);
    const list = { id: makeId('list'), boardId: board.id, name: input.name.trim(), position: this.state.lists.filter((item) => item.boardId === board.id && !item.archived).length, archived: false };
    this.state.lists.push(list); this.touchBoard(board.id); this.log(board.id, null, 'list.created', `Created list “${list.name}”`); this.save(); return list;
  }
  updateList(listId, input) { const list = this.listFor(listId); if (Object.hasOwn(input, 'name')) { if (!input.name?.trim()) throw httpError('name is required'); list.name = input.name.trim(); } this.touchBoard(list.boardId); this.log(list.boardId, null, 'list.updated', `Updated list “${list.name}”`); this.save(); return list; }
  archiveList(listId, archived = true) { const list = this.listFor(listId); list.archived = Boolean(archived); this.touchBoard(list.boardId); this.log(list.boardId, null, archived ? 'list.archived' : 'list.restored', `${archived ? 'Archived' : 'Restored'} list “${list.name}”`); this.save(); return list; }
  deleteList(listId) { const list = this.listFor(listId); if (this.state.cards.some((card) => card.listId === listId)) throw httpError('move or delete this list’s cards first'); this.state.lists = this.state.lists.filter((item) => item.id !== listId); this.reindexLists(list.boardId); this.touchBoard(list.boardId); this.log(list.boardId, null, 'list.deleted', `Permanently deleted list “${list.name}”`); this.save(); }

  createLabel(boardId, input) { const board = this.getBoard(boardId); const label = { id: makeId('label'), name: String(input.name || '').trim(), color: String(input.color || '#4bce97'), position: board.labels.length }; board.labels.push(label); this.touchBoard(boardId); this.save(); return label; }
  updateLabel(boardId, labelId, input) { const board = this.getBoard(boardId); const label = board.labels.find((item) => item.id === labelId); if (!label) throw httpError('label not found', 404); if (Object.hasOwn(input, 'name')) label.name = String(input.name || '').trim(); if (Object.hasOwn(input, 'color')) label.color = String(input.color); this.touchBoard(boardId); this.save(); return label; }
  deleteLabel(boardId, labelId) { const board = this.getBoard(boardId); if (!board.labels.some((item) => item.id === labelId)) throw httpError('label not found', 404); board.labels = board.labels.filter((item) => item.id !== labelId); this.cardsForBoard(boardId).forEach((card) => { card.labels = card.labels.filter((id) => id !== labelId); }); this.touchBoard(boardId); this.save(); }

  addAttachment(cardId, attachment) {
    const card = this.getCard(cardId); const boardId = this.listFor(card.listId).boardId;
    const item = { id: makeId('attachment'), kind: attachment.kind || 'file', name: String(attachment.name || 'Attachment'), url: attachment.url, mime: attachment.mime || '', size: Number(attachment.size) || 0, createdAt: now() };
    card.attachments.push(item); card.updatedAt = now(); this.touchBoard(boardId); this.log(boardId, card.id, 'attachment.added', `Added attachment “${item.name}”`); this.save(); return item;
  }
  removeAttachment(cardId, attachmentId) { const card = this.getCard(cardId); const item = card.attachments.find((entry) => entry.id === attachmentId); if (!item) throw httpError('attachment not found', 404); card.attachments = card.attachments.filter((entry) => entry.id !== attachmentId); const boardId = this.listFor(card.listId).boardId; card.updatedAt = now(); this.touchBoard(boardId); this.log(boardId, card.id, 'attachment.removed', `Removed attachment “${item.name}”`); this.save(); return item; }

  listComments(cardId) { this.getCard(cardId); return this.state.comments.filter((item) => item.cardId === cardId).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)); }
  createComment(cardId, input) { const card = this.getCard(cardId); if (!input.text?.trim()) throw httpError('comment text is required'); const comment = { id: makeId('comment'), cardId, text: input.text.trim(), author: String(input.author || 'You').trim() || 'You', createdAt: now(), updatedAt: now() }; this.state.comments.push(comment); const boardId = this.listFor(card.listId).boardId; this.touchBoard(boardId); this.log(boardId, card.id, 'comment.created', `${comment.author} commented on “${card.title}”`); this.save(); return comment; }
  updateComment(cardId, commentId, input) { this.getCard(cardId); const comment = this.state.comments.find((item) => item.id === commentId && item.cardId === cardId); if (!comment) throw httpError('comment not found', 404); if (!input.text?.trim()) throw httpError('comment text is required'); comment.text = input.text.trim(); comment.updatedAt = now(); const boardId = this.listFor(this.getCard(cardId).listId).boardId; this.log(boardId, cardId, 'comment.updated', `Edited a comment by ${comment.author}`); this.save(); return comment; }
  deleteComment(cardId, commentId) { const card = this.getCard(cardId); const comment = this.state.comments.find((item) => item.id === commentId && item.cardId === cardId); if (!comment) throw httpError('comment not found', 404); this.state.comments = this.state.comments.filter((item) => item.id !== commentId); const boardId = this.listFor(card.listId).boardId; this.log(boardId, cardId, 'comment.deleted', `Deleted a comment by ${comment.author}`); this.save(); }
  listActivity(query = {}) { let items = this.state.activity; if (query.boardId) items = items.filter((item) => item.boardId === query.boardId); if (query.cardId) items = items.filter((item) => item.cardId === query.cardId); return items.slice(0, Math.min(Number(query.limit) || 100, 500)); }

  cleanLabels(labels, boardId) { const valid = new Set(this.getBoard(boardId).labels.map((label) => label.id)); return Array.isArray(labels) ? [...new Set(labels.map(String).filter((id) => valid.has(id)))].slice(0, 20) : []; }
  cleanChecklist(items) { return Array.isArray(items) ? items.map((item) => ({ id: item.id || makeId('item'), text: String(item.text || '').trim(), done: Boolean(item.done) })).filter((item) => item.text) : []; }
  cleanRecurrence(value) { return recurrences.includes(value) ? value : 'none'; }
  nextDue(value, recurrence) { const date = new Date(value); if (Number.isNaN(date.getTime())) throw httpError('invalid due date'); if (recurrence === 'daily') date.setDate(date.getDate() + 1); if (recurrence === 'weekly') date.setDate(date.getDate() + 7); if (recurrence === 'monthly') date.setMonth(date.getMonth() + 1); if (recurrence === 'yearly') date.setFullYear(date.getFullYear() + 1); const pad = (number) => String(number).padStart(2, '0'); return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`; }
  reindex(listId) { this.state.cards.filter((item) => item.listId === listId && !item.archived).sort((a, b) => a.position - b.position).forEach((item, index) => { item.position = index; }); }
  reindexLists(boardId) { this.state.lists.filter((item) => item.boardId === boardId && !item.archived).sort((a, b) => a.position - b.position).forEach((item, index) => { item.position = index; }); }
}

module.exports = { Store, initialState };
