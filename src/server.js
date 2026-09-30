const express = require('express');
const path = require('node:path');
const { Store } = require('./store');

const app = express();
const port = Number(process.env.PORT) || 3000;
const dataFile = process.env.DATA_FILE || path.join(process.cwd(), 'data', 'board.json');
const store = new Store(dataFile);

app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

function authenticate(req, res, next) {
  const expected = process.env.KANBAN_API_KEY;
  if (!expected) return next();
  const supplied = req.get('x-api-key') || req.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (supplied !== expected) return res.status(401).json({ error: 'unauthorized', message: 'Supply a valid X-API-Key or Bearer token.' });
  next();
}

app.get('/health', (_req, res) => res.json({ status: 'ok', version: '1.0.0', time: new Date().toISOString() }));
app.use('/api/v1', authenticate);

app.get('/api/v1/state', (req, res) => res.json({ board: store.state.board, columns: [...store.state.columns].sort((a, b) => a.position - b.position), cards: store.listCards(req.query) }));
app.get('/api/v1/board', (_req, res) => res.json(store.state.board));
app.patch('/api/v1/board', (req, res) => {
  for (const key of ['name', 'description']) if (Object.hasOwn(req.body, key)) store.state.board[key] = req.body[key];
  store.event('board.updated', null, 'Board settings updated'); store.save(); res.json(store.state.board);
});
app.get('/api/v1/cards', (req, res) => res.json({ items: store.listCards(req.query), total: store.listCards(req.query).length }));
app.post('/api/v1/cards', (req, res) => res.status(201).json(store.createCard(req.body)));
app.get('/api/v1/cards/:id', (req, res) => res.json(store.getCard(req.params.id)));
app.patch('/api/v1/cards/:id', (req, res) => res.json(store.updateCard(req.params.id, req.body)));
app.delete('/api/v1/cards/:id', (req, res) => { store.deleteCard(req.params.id); res.status(204).end(); });
app.post('/api/v1/cards/:id/move', (req, res) => res.json(store.moveCard(req.params.id, req.body.columnId, req.body.position)));
app.get('/api/v1/columns', (_req, res) => res.json([...store.state.columns].sort((a, b) => a.position - b.position)));
app.post('/api/v1/columns', (req, res) => res.status(201).json(store.createColumn(req.body)));
app.patch('/api/v1/columns/:id', (req, res) => res.json(store.updateColumn(req.params.id, req.body)));
app.delete('/api/v1/columns/:id', (req, res) => { store.deleteColumn(req.params.id, req.query.moveTo); res.status(204).end(); });
app.get('/api/v1/activity', (req, res) => res.json({ items: store.state.activity.slice(0, Math.min(Number(req.query.limit) || 50, 500)) }));
app.get('/api/v1/export', (_req, res) => { res.setHeader('Content-Disposition', 'attachment; filename="workboard-export.json"'); res.json(store.state); });
app.get('/api/v1/stats', (_req, res) => {
  const active = store.state.cards.filter((card) => !card.archived);
  const overdue = active.filter((card) => card.dueDate && card.dueDate < new Date().toISOString().slice(0, 10) && card.columnId !== 'col_done').length;
  res.json({ active: active.length, archived: store.state.cards.length - active.length, overdue, estimates: active.reduce((sum, card) => sum + (Number(card.estimate) || 0), 0), byColumn: Object.fromEntries(store.state.columns.map((column) => [column.id, active.filter((card) => card.columnId === column.id).length])) });
});

app.get('/api/openapi.json', (_req, res) => res.sendFile(path.join(process.cwd(), 'openapi.json')));
app.use(express.static(path.join(process.cwd(), 'public'), { extensions: ['html'] }));
app.use((error, req, res, _next) => {
  console.error(`${req.method} ${req.path}:`, error.message);
  res.status(error.status || 500).json({ error: error.status === 404 ? 'not_found' : error.status === 400 ? 'bad_request' : 'internal_error', message: error.message });
});

if (require.main === module) app.listen(port, '0.0.0.0', () => console.log(`Moodle Workboard listening on http://0.0.0.0:${port}`));
module.exports = app;
