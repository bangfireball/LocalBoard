const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../src/store');

function makeStore() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'workboard-'));
  return new Store(path.join(directory, 'board.json'));
}

test('creates, updates, moves, filters, and deletes a card', () => {
  const store = makeStore();
  const card = store.createCard({ title: 'Privacy API', columnId: 'col_ready', priority: 'high', tags: ['moodle', 'api'] });
  assert.equal(card.columnId, 'col_ready');
  assert.equal(store.listCards({ priority: 'high' }).length, 1);
  assert.equal(store.listCards({ q: 'privacy' })[0].id, card.id);

  store.updateCard(card.id, { estimate: 3, checklist: [{ text: 'Tests', done: true }] });
  assert.equal(store.getCard(card.id).estimate, 3);
  assert.equal(store.getCard(card.id).checklist[0].done, true);

  store.moveCard(card.id, 'col_progress', 0);
  assert.equal(store.getCard(card.id).columnId, 'col_progress');

  store.deleteCard(card.id);
  assert.throws(() => store.getCard(card.id), /not found/);
});

test('columns can be created and removed while preserving cards', () => {
  const store = makeStore();
  const column = store.createColumn({ name: 'Blocked', wipLimit: 2 });
  const card = store.createCard({ title: 'Waiting', columnId: column.id });
  store.deleteColumn(column.id, 'col_backlog');
  assert.equal(store.getCard(card.id).columnId, 'col_backlog');
});

test('rejects cards without titles and deletion of the last column', () => {
  const store = makeStore();
  assert.throws(() => store.createCard({}), /title is required/);
  for (const column of [...store.state.columns].slice(1)) store.deleteColumn(column.id, 'col_backlog');
  assert.throws(() => store.deleteColumn('col_backlog'), /only column/);
});
