const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../src/store');

function makeStore() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'localboard-'));
  return new Store(path.join(directory, 'board.json'));
}

test('creates, edits, searches, moves, and deletes cards', () => {
  const store = makeStore();
  const label = store.createLabel('board_main', { name: 'Work', color: '#4bce97' });
  const card = store.createCard({ title: 'Review pull request', listId: 'list_todo', labels: [label.id] });
  assert.equal(store.listCards({ q: 'pull' })[0].id, card.id);
  assert.equal(store.listCards({ label: label.id }).length, 1);
  store.updateCard(card.id, { description: 'Check tests', assignee: 'Riley', checklist: [{ text: 'Read diff', done: true }] });
  store.moveCard(card.id, 'list_doing', 0);
  assert.equal(store.getCard(card.id).listId, 'list_doing');
  store.deleteCard(card.id);
  assert.throws(() => store.getCard(card.id), /not found/);
});

test('archives and restores cards and lists without losing data', () => {
  const store = makeStore();
  const card = store.createCard({ title: 'Keep history', listId: 'list_todo' });
  store.archiveCard(card.id, true);
  assert.equal(store.boardState('board_main').cards.some((item) => item.id === card.id), false);
  assert.equal(store.archiveState('board_main').cards.some((item) => item.id === card.id), true);
  store.archiveCard(card.id, false);
  assert.equal(store.boardState('board_main').cards.some((item) => item.id === card.id), true);
  store.archiveList('list_doing', true);
  assert.equal(store.boardState('board_main').lists.some((item) => item.id === 'list_doing'), false);
  store.archiveList('list_doing', false);
  assert.equal(store.boardState('board_main').lists.some((item) => item.id === 'list_doing'), true);
});

test('supports completed and recurring due dates', () => {
  const store = makeStore();
  const card = store.createCard({ title: 'Release', listId: 'list_todo', dueAt: '2027-01-10T09:00', recurrence: 'weekly', reminderMinutes: 60 });
  store.completeDue(card.id);
  assert.equal(store.getCard(card.id).dueAt, '2027-01-17T09:00');
  assert.equal(store.getCard(card.id).dueComplete, false);
  store.updateCard(card.id, { recurrence: 'none' });
  store.completeDue(card.id);
  assert.equal(store.getCard(card.id).dueComplete, true);
});

test('creates independent boards with board-specific labels', () => {
  const store = makeStore();
  const board = store.createBoard({ name: 'Client work', background: '#0e7a5f' });
  const view = store.boardState(board.id);
  const label = store.createLabel(board.id, { name: 'Urgent', color: '#f87168' });
  const card = store.createCard({ title: 'New task', listId: view.lists[0].id, labels: [label.id] });
  assert.equal(store.boardState(board.id).cards[0].id, card.id);
  assert.equal(store.boardState('board_main').cards.some((item) => item.id === card.id), false);
  store.deleteLabel(board.id, label.id);
  assert.deepEqual(store.getCard(card.id).labels, []);
});

test('adds file and link attachments and removes metadata', () => {
  const store = makeStore();
  const card = store.createCard({ title: 'Specs', listId: 'list_todo' });
  const file = store.addAttachment(card.id, { kind: 'file', name: 'spec.pdf', url: '/uploads/random.pdf', mime: 'application/pdf', size: 1234 });
  const link = store.addAttachment(card.id, { kind: 'link', name: 'Issue', url: 'https://example.com/issue' });
  assert.equal(store.getCard(card.id).attachments.length, 2);
  assert.equal(store.removeAttachment(card.id, file.id).name, 'spec.pdf');
  assert.equal(store.removeAttachment(card.id, link.id).kind, 'link');
});

test('stores comments and durable card activity', () => {
  const store = makeStore();
  const card = store.createCard({ title: 'Discuss', listId: 'list_todo' });
  const comment = store.createComment(card.id, { text: 'Looks good', author: 'Alex' });
  assert.equal(store.listComments(card.id)[0].author, 'Alex');
  store.updateComment(card.id, comment.id, { text: 'Ship it' });
  assert.match(store.listComments(card.id)[0].text, /Ship/);
  assert.ok(store.listActivity({ cardId: card.id }).some((item) => item.action === 'comment.created'));
  store.deleteComment(card.id, comment.id);
  assert.equal(store.listComments(card.id).length, 0);
});

test('rejects unsupported store versions without rewriting the file', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'localboard-version-'));
  const file = path.join(directory, 'board.json');
  const original = '{"version":99,"future":true}\n';
  fs.writeFileSync(file, original);
  assert.throws(() => new Store(file), /Unsupported data store version: 99/);
  assert.equal(fs.readFileSync(file, 'utf8'), original);
  assert.equal(fs.existsSync(`${file}.tmp`), false);
});

test('validates board and label colors as six-digit hex values', () => {
  const store = makeStore();
  assert.equal(store.createBoard({ name: 'Valid', background: '#Aa12fF' }).background, '#Aa12fF');
  assert.throws(() => store.createBoard({ name: 'Unsafe', background: 'red" onmouseover="x' }), /six-digit hex/);
  assert.throws(() => store.updateBoard('board_main', { name: 'Changed', background: '#fff' }), /six-digit hex/);
  assert.equal(store.getBoard('board_main').name, 'My Work Board');
  assert.throws(() => store.createLabel('board_main', { name: 'Unsafe', color: 'rgb(0,0,0)' }), /six-digit hex/);
  const label = store.createLabel('board_main', { name: 'Safe', color: '#123456' });
  assert.throws(() => store.updateLabel('board_main', label.id, { name: 'Changed', color: '#12345g' }), /six-digit hex/);
  assert.equal(label.name, 'Safe');
});

test('rejected card updates leave memory and disk unchanged', () => {
  const store = makeStore();
  const card = store.createCard({ title: 'Atomic', listId: 'list_todo', description: 'Before' });
  const beforeCard = structuredClone(card);
  const beforeFile = fs.readFileSync(store.file, 'utf8');
  assert.throws(() => store.updateCard(card.id, { description: 'After', title: '   ' }), /title is required/);
  assert.deepEqual(store.getCard(card.id), beforeCard);
  assert.equal(fs.readFileSync(store.file, 'utf8'), beforeFile);
  assert.throws(() => store.updateCard(card.id, { description: 'After', reminderMinutes: 'not-a-number' }), /reminder must be a number/);
  assert.deepEqual(store.getCard(card.id), beforeCard);
});

test('card updates restore all in-memory state when persistence fails', () => {
  const store = makeStore();
  const card = store.createCard({ title: 'Atomic save', listId: 'list_todo', description: 'Before' });
  const beforeState = structuredClone(store.state);
  store.save = () => { throw new Error('disk unavailable'); };
  assert.throws(() => store.updateCard(card.id, { description: 'After' }), /disk unavailable/);
  assert.deepEqual(store.state, beforeState);
  assert.equal(card.description, 'Before');
});

test('imports Trello lists, cards, metadata, checklists, and comment provenance', () => {
  const store = makeStore();
  const commentDate = '2024-04-05T06:07:08.000Z';
  const board = store.importTrelloBoard({
    name: 'Imported project',
    lists: [{ id: 'list-b', name: 'Done', pos: 20, closed: true }, { id: 'list-a', name: 'Backlog', pos: 10 }],
    labels: [{ id: 'label-1', name: 'Important', color: 'red' }],
    members: [{ id: 'member-1', fullName: 'Ada Lovelace', username: 'ada' }],
    checklists: [{ id: 'check-1', idCard: 'card-1', name: 'Launch', checkItems: [{ name: 'Test', state: 'complete', pos: 1 }, { name: 'Ship', state: 'incomplete', pos: 2 }] }],
    cards: [{ id: 'card-1', idList: 'list-a', name: 'Release', desc: 'Release notes', pos: 5, idLabels: ['label-1'], idMembers: ['member-1'], idChecklists: ['check-1'], due: '2025-02-03T10:00:00.000Z', dueComplete: true, attachments: [{ url: 'https://example.com/file' }] }],
    actions: [{ id: 'action-1', type: 'commentCard', date: commentDate, data: { card: { id: 'card-1' }, text: 'Ready to go' }, memberCreator: { fullName: 'Grace Hopper', username: 'grace' } }]
  });
  const importedLists = store.state.lists.filter((list) => list.boardId === board.id).sort((a, b) => a.position - b.position);
  const card = store.state.cards.find((item) => item.listId === importedLists[0].id);
  const comment = store.listComments(card.id)[0];
  assert.deepEqual(importedLists.map((list) => [list.name, list.archived]), [['Backlog', false], ['Done', true]]);
  assert.equal(card.description, 'Release notes');
  assert.equal(card.dueComplete, true);
  assert.equal(card.assignee, 'Ada Lovelace');
  assert.deepEqual(card.checklist.map((item) => [item.text, item.done]), [['Test', true], ['Ship', false]]);
  assert.deepEqual(card.attachments, []);
  assert.equal(board.labels.find((label) => card.labels.includes(label.id)).color, '#f87168');
  assert.equal(comment.author, 'Grace Hopper');
  assert.equal(comment.createdAt, commentDate);
  assert.equal(comment.updatedAt, commentDate);
  assert.ok(store.listActivity({ boardId: board.id }).some((item) => item.action === 'board.imported'));
});

test('normalizes Trello source IDs without creating orphaned records', () => {
  const store = makeStore();
  const board = store.importTrelloBoard({
    name: 'Whitespace IDs',
    lists: [{ id: ' list-1 ', name: 'List' }],
    cards: [{ id: ' card-1 ', idList: 'list-1', name: 'Card', idChecklists: [' check-1 '] }],
    checklists: [{ id: 'check-1', idCard: 'card-1', name: 'Tasks', checkItems: [{ name: 'Mapped', state: 'complete' }] }],
    actions: [{ type: 'commentCard', date: '2024-01-02T03:04:05.000Z', data: { card: { id: ' card-1 ' }, text: 'Mapped comment' } }]
  });
  const lists = store.state.lists.filter((list) => list.boardId === board.id);
  const cards = store.state.cards.filter((card) => lists.some((list) => list.id === card.listId));
  assert.equal(lists.length, 1);
  assert.equal(cards.length, 1);
  assert.deepEqual(cards[0].checklist.map((item) => item.text), ['Mapped']);
  assert.equal(store.listComments(cards[0].id)[0].text, 'Mapped comment');
});

test('rejects malformed Trello checklist items with a controlled validation error', () => {
  const store = makeStore();
  const beforeState = structuredClone(store.state);
  assert.throws(() => store.importTrelloBoard({
    name: 'Broken checklist',
    lists: [{ id: 'list-1', name: 'List' }],
    cards: [{ id: 'card-1', idList: 'list-1', name: 'Card', checklists: [{ name: 'Tasks', checkItems: [null] }] }]
  }), (error) => error.status === 400 && /checklist items must be objects/.test(error.message));
  assert.deepEqual(store.state, beforeState);
});

test('invalid Trello imports are atomic', () => {
  const store = makeStore();
  const beforeState = structuredClone(store.state);
  const beforeFile = fs.readFileSync(store.file, 'utf8');
  assert.throws(() => store.importTrelloBoard({ name: 'Broken', lists: [{ id: 'list-1', name: 'List' }], cards: [{ id: 'card-1', idList: 'missing', name: 'Lost card' }] }), /unknown list/);
  assert.deepEqual(store.state, beforeState);
  assert.equal(fs.readFileSync(store.file, 'utf8'), beforeFile);
});
