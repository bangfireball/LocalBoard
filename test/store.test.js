const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../src/store');

function makeStore() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'board-'));
  return new Store(path.join(directory, 'board.json'));
}

test('creates, edits, searches, moves, and deletes cards', () => {
  const store = makeStore();
  const card = store.createCard({ title: 'Review pull request', listId: 'list_todo', labels: ['work'] });
  assert.equal(card.listId, 'list_todo');
  assert.equal(store.listCards({ q: 'pull' })[0].id, card.id);
  assert.equal(store.listCards({ label: 'work' }).length, 1);

  store.updateCard(card.id, { description: 'Check the tests', checklist: [{ text: 'Read diff', done: true }] });
  assert.equal(store.getCard(card.id).checklist[0].done, true);
  store.moveCard(card.id, 'list_doing', 0);
  assert.equal(store.getCard(card.id).listId, 'list_doing');
  store.deleteCard(card.id);
  assert.throws(() => store.getCard(card.id), /not found/);
});

test('creates, renames, and removes an empty list', () => {
  const store = makeStore();
  const list = store.createList({ name: 'Waiting', boardId: 'board_main' });
  store.updateList(list.id, { name: 'Blocked' });
  assert.equal(store.state.lists.find((item) => item.id === list.id).name, 'Blocked');
  store.deleteList(list.id);
  assert.equal(store.state.lists.some((item) => item.id === list.id), false);
});

test('will not delete a list containing cards', () => {
  const store = makeStore();
  assert.throws(() => store.deleteList('list_todo'), /move or delete/);
});

test('creates independent boards with their own lists and cards', () => {
  const store = makeStore();
  const board = store.createBoard({ name: 'Client work', background: '#0e7a5f' });
  const view = store.boardState(board.id);
  assert.equal(view.lists.length, 3);
  assert.equal(view.cards.length, 0);
  const card = store.createCard({ title: 'New task', listId: view.lists[0].id });
  assert.equal(store.boardState(board.id).cards[0].id, card.id);
  assert.equal(store.boardState('board_main').cards.some((item) => item.id === card.id), false);
});
