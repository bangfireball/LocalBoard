const express = require('express');
const path = require('node:path');
const { Store } = require('./store');

const app = express();
const port = Number(process.env.PORT) || 3000;
const root = path.resolve(__dirname, '..');
const store = new Store(process.env.DATA_FILE || path.join(root, 'data', 'board.json'));

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

function authenticate(req, res, next) {
  const expected = process.env.KANBAN_API_KEY;
  if (!expected) return next();
  const supplied = req.get('x-api-key') || req.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (supplied !== expected) return res.status(401).json({ error: 'unauthorized', message: 'Supply a valid API key.' });
  next();
}

app.get('/health', (_req, res) => res.json({ status: 'ok', version: '2.0.0', time: new Date().toISOString() }));
app.use('/api/v1', authenticate);
app.get('/api/v1/state', (req, res) => res.json({ board: store.state.board, lists: [...store.state.lists].sort((a, b) => a.position - b.position), cards: store.listCards(req.query) }));
app.get('/api/v1/board', (_req, res) => res.json(store.state.board));
app.patch('/api/v1/board', (req, res) => {
  if (Object.hasOwn(req.body, 'name')) { if (!req.body.name?.trim()) return res.status(400).json({ error: 'bad_request', message: 'name is required' }); store.state.board.name = req.body.name.trim(); }
  if (Object.hasOwn(req.body, 'background')) store.state.board.background = String(req.body.background);
  store.save(); res.json(store.state.board);
});
app.get('/api/v1/lists', (_req, res) => res.json([...store.state.lists].sort((a, b) => a.position - b.position)));
app.post('/api/v1/lists', (req, res) => res.status(201).json(store.createList(req.body)));
app.patch('/api/v1/lists/:id', (req, res) => res.json(store.updateList(req.params.id, req.body)));
app.delete('/api/v1/lists/:id', (req, res) => { store.deleteList(req.params.id); res.status(204).end(); });
app.get('/api/v1/cards', (req, res) => { const items = store.listCards(req.query); res.json({ items, total: items.length }); });
app.post('/api/v1/cards', (req, res) => res.status(201).json(store.createCard(req.body)));
app.get('/api/v1/cards/:id', (req, res) => res.json(store.getCard(req.params.id)));
app.patch('/api/v1/cards/:id', (req, res) => res.json(store.updateCard(req.params.id, req.body)));
app.delete('/api/v1/cards/:id', (req, res) => { store.deleteCard(req.params.id); res.status(204).end(); });
app.post('/api/v1/cards/:id/move', (req, res) => res.json(store.moveCard(req.params.id, req.body.listId, req.body.position)));
app.get('/api/v1/export', (_req, res) => { res.setHeader('Content-Disposition', 'attachment; filename="board-export.json"'); res.json(store.state); });
app.get('/api/openapi.json', (_req, res) => res.sendFile(path.join(root, 'openapi.json')));
app.use(express.static(path.join(root, 'public'), { extensions: ['html'] }));
app.use((error, req, res, _next) => {
  console.error(`${req.method} ${req.path}:`, error.message);
  res.status(error.status || 500).json({ error: error.status === 404 ? 'not_found' : error.status === 400 ? 'bad_request' : 'internal_error', message: error.message });
});

if (require.main === module) app.listen(port, '0.0.0.0', () => console.log(`Board listening on http://0.0.0.0:${port}`));
module.exports = app;
