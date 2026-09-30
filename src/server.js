const express = require('express');
const path = require('node:path');
const { Store } = require('./store');

const app = express();
const port = Number(process.env.PORT) || 3000;
const root = path.resolve(__dirname, '..');
const store = new Store(process.env.DATA_FILE || path.join(root, 'data', 'board.json'));

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use((_req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Referrer-Policy', 'same-origin'); next(); });
function authenticate(req, res, next) {
  const expected = process.env.KANBAN_API_KEY;
  if (!expected) return next();
  const supplied = req.get('x-api-key') || req.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (supplied !== expected) return res.status(401).json({ error: 'unauthorized', message: 'Supply a valid API key.' });
  next();
}

app.get('/health', (_req, res) => res.json({ status: 'ok', version: '3.0.0', time: new Date().toISOString() }));
app.use('/api/v1', authenticate);
app.get('/api/v1/state', (req, res) => res.json(store.boardState(req.query.boardId)));
app.get('/api/v1/boards', (_req, res) => res.json([...store.state.boards].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))));
app.post('/api/v1/boards', (req, res) => res.status(201).json(store.createBoard(req.body)));
app.get('/api/v1/boards/:id', (req, res) => res.json(store.getBoard(req.params.id)));
app.patch('/api/v1/boards/:id', (req, res) => res.json(store.updateBoard(req.params.id, req.body)));
app.delete('/api/v1/boards/:id', (req, res) => { store.deleteBoard(req.params.id); res.status(204).end(); });
app.get('/api/v1/lists', (req, res) => res.json(store.boardState(req.query.boardId).lists));
app.post('/api/v1/lists', (req, res) => res.status(201).json(store.createList(req.body)));
app.patch('/api/v1/lists/:id', (req, res) => res.json(store.updateList(req.params.id, req.body)));
app.delete('/api/v1/lists/:id', (req, res) => { store.deleteList(req.params.id); res.status(204).end(); });
app.get('/api/v1/cards', (req, res) => { const items = store.listCards(req.query); res.json({ items, total: items.length }); });
app.post('/api/v1/cards', (req, res) => res.status(201).json(store.createCard(req.body)));
app.get('/api/v1/cards/:id', (req, res) => res.json(store.getCard(req.params.id)));
app.patch('/api/v1/cards/:id', (req, res) => res.json(store.updateCard(req.params.id, req.body)));
app.delete('/api/v1/cards/:id', (req, res) => { store.deleteCard(req.params.id); res.status(204).end(); });
app.post('/api/v1/cards/:id/move', (req, res) => res.json(store.moveCard(req.params.id, req.body.listId, req.body.position)));
app.get('/api/v1/export', (_req, res) => { res.setHeader('Content-Disposition', 'attachment; filename="boards-export.json"'); res.json(store.state); });
app.get('/api/openapi.json', (_req, res) => res.sendFile(path.join(root, 'openapi.json')));
app.use(express.static(path.join(root, 'public'), { extensions: ['html'] }));
app.use((error, req, res, _next) => { console.error(`${req.method} ${req.path}:`, error.message); res.status(error.status || 500).json({ error: error.status === 404 ? 'not_found' : error.status === 400 ? 'bad_request' : 'internal_error', message: error.message }); });

if (require.main === module) app.listen(port, '0.0.0.0', () => console.log(`Board listening on http://0.0.0.0:${port}`));
module.exports = app;
