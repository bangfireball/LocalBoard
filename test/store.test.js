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
