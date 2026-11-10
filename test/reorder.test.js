const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../src/store');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'localboard-reorder-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return path.join(directory, 'board.json');
}
const orderedCards = (store, listId) => store.listCards({ listId }).map((card) => card.id);
const orderedLists = (store) => store.boardState('board_main').lists.map((list) => list.id);

test('card moves use final indices, append, reindex both columns, and persist', (t) => {
  const file = fixture(t), store = new Store(file);
  const a = store.createCard({ title: 'A', listId: 'list_doing' });
  const b = store.createCard({ title: 'B', listId: 'list_doing' });
  const c = store.createCard({ title: 'C', listId: 'list_doing' });
  store.moveCard(a.id, undefined, 2);
  assert.deepEqual(orderedCards(store, 'list_doing'), [b.id, c.id, a.id]);
  store.moveCard(a.id, undefined, 0);
  assert.deepEqual(orderedCards(store, 'list_doing'), [a.id, b.id, c.id]);
  store.moveCard(a.id, undefined);
  store.moveCard(b.id, 'list_done', 999);
  assert.deepEqual(orderedCards(store, 'list_doing'), [c.id, a.id]);
  assert.deepEqual(store.listCards({ listId: 'list_doing' }).map((card) => card.position), [0, 1]);
  assert.equal(store.getCard(b.id).position, 0);
  assert.deepEqual(orderedCards(new Store(file), 'list_doing'), [c.id, a.id]);
});

test('columns reorder within their board, exclude archived lists, and persist', (t) => {
  const file = fixture(t), store = new Store(file);
  const other = store.createBoard({ name: 'Other' });
  const beforeOther = structuredClone(store.boardState(other.id));
  store.moveList('list_done', 0);
  assert.deepEqual(orderedLists(store), ['list_done', 'list_todo', 'list_doing']);
  store.moveList('list_done', 1);
  assert.deepEqual(orderedLists(store), ['list_todo', 'list_done', 'list_doing']);
  store.moveList('list_todo');
  assert.deepEqual(orderedLists(store), ['list_done', 'list_doing', 'list_todo']);
  store.archiveList('list_doing');
  store.moveList('list_done', 999);
  assert.deepEqual(orderedLists(store), ['list_todo', 'list_done']);
  assert.deepEqual(store.boardState('board_main').lists.map((list) => list.position), [0, 1]);
  assert.deepEqual(store.boardState(other.id), beforeOther);
  assert.deepEqual(orderedLists(new Store(file)), ['list_todo', 'list_done']);
  assert.ok(store.listActivity({ boardId: 'board_main' }).some((event) => event.action === 'list.moved'));
});

test('invalid moves do not mutate state', (t) => {
  const store = new Store(fixture(t));
  const card = store.createCard({ title: 'A', listId: 'list_doing' });
  const board = store.createBoard({ name: 'Other' });
  for (const position of [-1, 1.5, '1', null, true, {}, Number.MAX_SAFE_INTEGER + 1]) {
    const before = structuredClone(store.state);
    assert.throws(() => store.moveCard(card.id, undefined, position), /position/);
    assert.throws(() => store.moveList('list_done', position), /position/);
    assert.deepEqual(store.state, before);
  }
  assert.throws(() => store.moveCard(card.id, store.boardState(board.id).lists[0].id, 0), /between boards/);
  store.archiveList('list_done');
  assert.throws(() => store.moveList('list_done', 0), /archived/);
  assert.throws(() => store.moveCard(card.id, 'list_done', 0), /archived/);
  store.archiveCard(card.id);
  assert.throws(() => store.moveCard(card.id, undefined, 0), /archived/);
  assert.throws(() => store.moveList('missing', 0), /not found/);
});

test('HTTP move endpoints reorder cards and columns and return validation errors', async (t) => {
  process.env.DATA_FILE = fixture(t);
  process.env.KANBAN_API_KEY = 'reorder-test-key';
  const app = require('../src/server');
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  async function request(url, method = 'GET', body) {
    return fetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'X-API-Key': 'reorder-test-key' }, body: body === undefined ? undefined : JSON.stringify(body) });
  }
  assert.equal((await fetch(base + '/lists/list_done/move', { method: 'POST' })).status, 401);
  const card = await (await request('/cards', 'POST', { title: 'Test', listId: 'list_doing' })).json();
  assert.equal((await request(`/cards/${card.id}/move`, 'POST', { position: 0 })).status, 200);
  assert.equal((await request('/lists/list_done/move', 'POST', { position: 0 })).status, 200);
  assert.equal((await (await request('/lists?boardId=board_main')).json())[0].id, 'list_done');
  assert.equal((await request('/lists/list_done/move', 'POST', { position: -1 })).status, 400);
  assert.equal((await request(`/cards/${card.id}/move`, 'POST', { position: '0' })).status, 400);
  assert.equal((await request('/lists/missing/move', 'POST', {})).status, 404);
});
