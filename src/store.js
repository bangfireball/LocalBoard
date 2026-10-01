const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const now = () => new Date().toISOString();
const makeId = (prefix) => `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
const httpError = (message, status = 400) => Object.assign(new Error(message), { status });
const labelColors = ['#4bce97', '#f5cd47', '#fea362', '#f87168', '#9f8fef', '#579dff'];
const recurrences = ['none', 'daily', 'weekly', 'monthly', 'yearly'];
const colorPattern = /^#[0-9a-fA-F]{6}$/;
const trelloColors = { green: '#4bce97', yellow: '#f5cd47', orange: '#fea362', red: '#f87168', purple: '#9f8fef', blue: '#579dff', sky: '#6cc3e0', lime: '#94c748', pink: '#e774bb', black: '#626f86' };
const defaultLabels = () => labelColors.map((color, position) => ({ id: makeId('label'), name: '', color, position }));
const clone = (value) => structuredClone(value);
const requireColor = (value) => { const color = String(value); if (!colorPattern.test(color)) throw httpError('color must be a six-digit hex value'); return color; };
const validDate = (value) => { if (!value) return ''; const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : date.toISOString(); };

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
    if (!this.state || typeof this.state !== 'object' || Array.isArray(this.state) || !Number.isInteger(this.state.version) || ![2, 3, 4, 5].includes(this.state.version)) {
      throw new Error(`Unsupported data store version: ${this.state?.version ?? 'missing'} (supported: 2-5)`);
    }
    if (this.state.version === 2) this.migrateV2();
    if (this.state.version === 3) this.migrateV3();
    if (this.state.version === 4) this.migrateV4();
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
    const background = Object.hasOwn(input, 'background') ? requireColor(input.background) : '#0c66e4';
    const timestamp = now(); const board = { id: makeId('board'), name: input.name.trim(), background, labels: defaultLabels(), createdAt: timestamp, updatedAt: timestamp };
    this.state.boards.push(board); ['To do', 'Doing', 'Done'].forEach((name, position) => this.state.lists.push({ id: makeId('list'), boardId: board.id, name, position, archived: false }));
    this.log(board.id, null, 'board.created', `Created board “${board.name}”`); this.save(); return board;
  }
  updateBoard(boardId, input) {
    const board = this.getBoard(boardId); const before = board.name;
    const name = Object.hasOwn(input, 'name') ? String(input.name || '').trim() : board.name;
    if (!name) throw httpError('name is required');
    const background = Object.hasOwn(input, 'background') ? requireColor(input.background) : board.background;
    board.name = name; board.background = background;
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

  importTrelloBoard(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw httpError('Trello import must be a JSON object');
    const string = (value, field, maximum, required = false) => {
      if (typeof value !== 'string' || (required && !value.trim())) throw httpError(`${field} must be ${required ? 'a non-empty ' : ''}string`);
      if (value.length > maximum) throw httpError(`${field} is too long`);
      return value.trim();
    };
    const array = (value, field, maximum, required = false) => {
      if (value === undefined && !required) return [];
      if (!Array.isArray(value)) throw httpError(`${field} must be an array`);
      if (value.length > maximum) throw httpError(`${field} has too many items`);
      return value;
    };
    const sourceLists = array(input.lists, 'lists', 500, true);
    const sourceCards = array(input.cards, 'cards', 10000, true);
    if (!sourceLists.length) throw httpError('Trello import must contain at least one list');
    const sourceLabels = array(input.labels, 'labels', 1000);
    const sourceMembers = array(input.members, 'members', 5000);
    const sourceChecklists = array(input.checklists, 'checklists', 5000);
    const sourceActions = array(input.actions, 'actions', 50000);
    const timestamp = now();
    const board = { id: makeId('board'), name: string(input.name, 'name', 80, true), background: '#0c66e4', labels: [], createdAt: timestamp, updatedAt: timestamp };

    const sourceId = (value, field) => string(value, `${field} id`, 200, true);
    const uniqueById = (items, field) => {
      const result = new Map();
      items.forEach((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) throw httpError(`${field} entries must be objects`);
        const id = sourceId(item.id, field);
        if (result.has(id)) throw httpError(`duplicate ${field} id: ${id}`);
        result.set(id, item);
      });
      return result;
    };
    const sourceListById = uniqueById(sourceLists, 'list');
    const sourceCardById = uniqueById(sourceCards, 'card');
    const memberById = uniqueById(sourceMembers, 'member');
    const checklistById = uniqueById(sourceChecklists, 'checklist');
    const ordered = (items) => items.map((item, index) => ({ item, index })).sort((a, b) => {
      const left = Number(a.item.pos); const right = Number(b.item.pos);
      return (Number.isFinite(left) ? left : a.index) - (Number.isFinite(right) ? right : b.index);
    }).map(({ item }) => item);

    const listIdMap = new Map();
    const lists = ordered(sourceLists).map((item, position) => {
      const id = makeId('list'); listIdMap.set(sourceId(item.id, 'list'), id);
      return { id, boardId: board.id, name: string(item.name, 'list name', 80, true), position, archived: Boolean(item.closed) };
    });

    const labelDefinitions = new Map();
    const addLabelDefinition = (item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw httpError('label entries must be objects');
      const id = sourceId(item.id, 'label');
      if (!labelDefinitions.has(id)) labelDefinitions.set(id, item);
    };
    sourceLabels.forEach(addLabelDefinition);
    sourceCards.forEach((card) => array(card.labels, 'card labels', 100).forEach(addLabelDefinition));
    const labelIdMap = new Map();
    [...labelDefinitions].forEach(([sourceId, item], position) => {
      const colorValue = typeof item.color === 'string' ? item.color : '';
      const color = colorPattern.test(colorValue) ? colorValue : (trelloColors[colorValue.toLowerCase()] || '#626f86');
      const label = { id: makeId('label'), name: typeof item.name === 'string' ? string(item.name, 'label name', 60) : '', color, position };
      board.labels.push(label); labelIdMap.set(sourceId, label.id);
    });

    const rootChecklistByCard = new Map();
    sourceChecklists.forEach((item) => {
      if (item.idCard !== undefined) {
        const cardId = sourceId(item.idCard, 'checklist card');
        if (!sourceCardById.has(cardId)) throw httpError(`checklist references unknown card: ${cardId}`);
        const entries = rootChecklistByCard.get(cardId) || []; entries.push(item); rootChecklistByCard.set(cardId, entries);
      }
    });
    const memberName = (id) => {
      const member = memberById.get(id); if (!member) throw httpError(`card references unknown member: ${id}`);
      return [member.fullName, member.username, member.id].find((value) => typeof value === 'string' && value.trim())?.trim() || 'Unknown';
    };
    const cardIdMap = new Map();
    const cards = [];
    ordered(sourceCards).forEach((item) => {
      const sourceListId = sourceId(item.idList, 'card list');
      if (!sourceListById.has(sourceListId)) throw httpError(`card references unknown list: ${sourceListId}`);
      const referencedLabels = [...array(item.idLabels, 'card label ids', 100), ...array(item.labels, 'card labels', 100).map((label) => label.id)];
      const labels = [...new Set(referencedLabels.map((id) => sourceId(id, 'card label')).map((id) => {
        if (!labelIdMap.has(id)) throw httpError(`card references unknown label: ${id}`); return labelIdMap.get(id);
      }))];
      const memberIds = array(item.idMembers, 'card member ids', 100).map((id) => sourceId(id, 'card member'));
      const canonicalCardId = sourceId(item.id, 'card');
      let checklists = [...(rootChecklistByCard.get(canonicalCardId) || [])];
      array(item.idChecklists, 'card checklist ids', 500).forEach((idValue) => {
        const id = sourceId(idValue, 'card checklist'); const checklist = checklistById.get(id);
        if (!checklist) throw httpError(`card references unknown checklist: ${id}`);
        if (!checklists.includes(checklist)) checklists.push(checklist);
      });
      array(item.checklists, 'card checklists', 500).forEach((checklist) => checklists.push(checklist));
      const usePrefix = checklists.length > 1;
      const checklist = checklists.flatMap((group) => {
        if (!group || typeof group !== 'object' || Array.isArray(group)) throw httpError('checklist entries must be objects');
        const groupName = typeof group.name === 'string' ? string(group.name, 'checklist name', 160) : '';
        const checkItems = array(group.checkItems, 'checklist items', 1000);
        checkItems.forEach((checkItem) => { if (!checkItem || typeof checkItem !== 'object' || Array.isArray(checkItem)) throw httpError('checklist items must be objects'); });
        return ordered(checkItems).map((checkItem) => {
          const itemName = string(checkItem.name, 'checklist item name', 500, true);
          return { id: makeId('item'), text: usePrefix && groupName ? `${groupName}: ${itemName}` : itemName, done: checkItem.state === 'complete' };
        });
      });
      let dueAt = '';
      if (item.due) { dueAt = validDate(item.due); if (!dueAt) throw httpError('card due date is invalid'); }
      const activityDate = validDate(item.dateLastActivity);
      const id = makeId('card'); cardIdMap.set(canonicalCardId, id);
      cards.push({ id, listId: listIdMap.get(sourceListId), title: string(item.name, 'card name', 160, true), description: typeof item.desc === 'string' ? string(item.desc, 'card description', 100000) : '', labels, dueAt, dueComplete: Boolean(item.dueComplete), reminderMinutes: null, recurrence: 'none', assignee: memberIds.map(memberName).join(', '), checklist, attachments: [], position: cards.filter((card) => card.listId === listIdMap.get(sourceListId)).length, archived: Boolean(item.closed), createdAt: timestamp, updatedAt: activityDate || timestamp });
    });

    const comments = [];
    sourceActions.forEach((action) => {
      if (!action || typeof action !== 'object' || Array.isArray(action)) throw httpError('action entries must be objects');
      if (action.type !== 'commentCard') return;
      const sourceCardId = action.data?.card?.id;
      if (typeof sourceCardId !== 'string') return;
      const canonicalCardId = sourceId(sourceCardId, 'comment card');
      if (!cardIdMap.has(canonicalCardId)) return;
      const text = string(action.data?.text, 'comment text', 100000, true);
      const createdAt = validDate(action.date); if (!createdAt) throw httpError('comment timestamp is invalid');
      const creator = action.memberCreator || {};
      const author = [creator.fullName, creator.username, creator.id].find((value) => typeof value === 'string' && value.trim())?.trim() || 'Unknown';
      comments.push({ id: makeId('comment'), cardId: cardIdMap.get(canonicalCardId), text, author: author.slice(0, 160), createdAt, updatedAt: createdAt });
    });

    const previous = this.state;
    this.state = clone(previous);
    this.state.boards.push(board); this.state.lists.push(...lists); this.state.cards.push(...cards); this.state.comments.push(...comments);
    this.state.activity.unshift({ id: makeId('activity'), boardId: board.id, cardId: null, action: 'board.imported', detail: `Imported Trello board “${board.name}”`, createdAt: timestamp });
    this.state.activity = this.state.activity.slice(0, 5000);
    try { this.save(); } catch (error) { this.state = previous; throw error; }
    return board;
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
    const card = this.getCard(cardId); const boardId = this.listFor(card.listId).boardId; const candidate = clone(card); const changes = [];
    for (const key of ['title', 'description', 'dueAt', 'assignee']) if (Object.hasOwn(input, key) && String(input[key] ?? '') !== candidate[key]) { candidate[key] = String(input[key] ?? ''); changes.push(key); }
    if (Object.hasOwn(input, 'labels')) { candidate.labels = this.cleanLabels(input.labels, boardId); changes.push('labels'); }
    if (Object.hasOwn(input, 'checklist')) { candidate.checklist = this.cleanChecklist(input.checklist); changes.push('checklist'); }
    if (Object.hasOwn(input, 'reminderMinutes')) {
      if (input.reminderMinutes === null || input.reminderMinutes === '') candidate.reminderMinutes = null;
      else { const reminder = Number(input.reminderMinutes); if (!Number.isFinite(reminder)) throw httpError('reminder must be a number'); candidate.reminderMinutes = Math.max(0, reminder); }
      changes.push('reminder');
    }
    if (Object.hasOwn(input, 'recurrence')) { candidate.recurrence = this.cleanRecurrence(input.recurrence); changes.push('recurrence'); }
    if (Object.hasOwn(input, 'dueComplete') && Boolean(input.dueComplete) !== candidate.dueComplete) { candidate.dueComplete = Boolean(input.dueComplete); changes.push(candidate.dueComplete ? 'due date completed' : 'due date reopened'); }
    if (!candidate.title.trim()) throw httpError('title is required');
    candidate.title = candidate.title.trim(); candidate.updatedAt = now();
    const previous = this.state;
    this.state = clone(previous);
    const updated = this.getCard(cardId); Object.assign(updated, candidate); this.touchBoard(boardId);
    if (changes.length) this.log(boardId, updated.id, changes.includes('due date completed') ? 'due.completed' : 'card.updated', `Updated ${changes.join(', ')} on “${updated.title}”`);
    try { this.save(); } catch (error) { this.state = previous; throw error; }
    return updated;
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

  createLabel(boardId, input) { const board = this.getBoard(boardId); const color = Object.hasOwn(input, 'color') ? requireColor(input.color) : '#4bce97'; const label = { id: makeId('label'), name: String(input.name || '').trim(), color, position: board.labels.length }; board.labels.push(label); this.touchBoard(boardId); this.save(); return label; }
  updateLabel(boardId, labelId, input) { const board = this.getBoard(boardId); const label = board.labels.find((item) => item.id === labelId); if (!label) throw httpError('label not found', 404); const color = Object.hasOwn(input, 'color') ? requireColor(input.color) : label.color; if (Object.hasOwn(input, 'name')) label.name = String(input.name || '').trim(); label.color = color; this.touchBoard(boardId); this.save(); return label; }
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
