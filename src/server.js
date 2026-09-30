const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const multer = require('multer');
const { Store } = require('./store');

const app = express();
const port = Number(process.env.PORT) || 3000;
const root = path.resolve(__dirname, '..');
const dataFile = process.env.DATA_FILE || path.join(root, 'data', 'board.json');
const uploadDirectory = path.join(path.dirname(dataFile), 'uploads');
fs.mkdirSync(uploadDirectory, { recursive: true });
const store = new Store(dataFile);
const extensions = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp' };
const upload = multer({
  storage: multer.diskStorage({ destination: uploadDirectory, filename: (_req, file, done) => done(null, `${crypto.randomUUID()}${extensions[file.mimetype] || ''}`) }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, done) => extensions[file.mimetype] ? done(null, true) : done(Object.assign(new Error('Only JPEG, PNG, GIF, and WebP photos are allowed.'), { status: 400 }))
});
const removeUploadedFile = (url) => { if (url) fs.rm(path.join(uploadDirectory, path.basename(url)), { force: true }, () => {}); };

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

app.get('/health', (_req, res) => res.json({ status: 'ok', version: '3.1.0', time: new Date().toISOString() }));
app.use('/uploads', express.static(uploadDirectory, { immutable: true, maxAge: '30d' }));
app.use('/api/v1', authenticate);
app.get('/api/v1/state', (req, res) => res.json(store.boardState(req.query.boardId)));
app.get('/api/v1/boards', (_req, res) => res.json([...store.state.boards].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))));
app.post('/api/v1/boards', (req, res) => res.status(201).json(store.createBoard(req.body)));
app.get('/api/v1/boards/:id', (req, res) => res.json(store.getBoard(req.params.id)));
app.patch('/api/v1/boards/:id', (req, res) => res.json(store.updateBoard(req.params.id, req.body)));
app.delete('/api/v1/boards/:id', (req, res) => { store.deleteBoard(req.params.id).forEach((photo) => removeUploadedFile(photo.url)); res.status(204).end(); });
app.get('/api/v1/lists', (req, res) => res.json(store.boardState(req.query.boardId).lists));
app.post('/api/v1/lists', (req, res) => res.status(201).json(store.createList(req.body)));
app.patch('/api/v1/lists/:id', (req, res) => res.json(store.updateList(req.params.id, req.body)));
app.delete('/api/v1/lists/:id', (req, res) => { store.deleteList(req.params.id); res.status(204).end(); });
app.get('/api/v1/cards', (req, res) => { const items = store.listCards(req.query); res.json({ items, total: items.length }); });
app.post('/api/v1/cards', (req, res) => res.status(201).json(store.createCard(req.body)));
app.get('/api/v1/cards/:id', (req, res) => res.json(store.getCard(req.params.id)));
app.patch('/api/v1/cards/:id', (req, res) => res.json(store.updateCard(req.params.id, req.body)));
app.delete('/api/v1/cards/:id', (req, res) => { const card = store.deleteCard(req.params.id); card.photos.forEach((photo) => removeUploadedFile(photo.url)); res.status(204).end(); });
app.post('/api/v1/cards/:id/move', (req, res) => res.json(store.moveCard(req.params.id, req.body.listId, req.body.position)));
app.post('/api/v1/cards/:id/photos', upload.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'bad_request', message: 'photo is required' });
  try { res.status(201).json(store.addPhoto(req.params.id, { name: req.file.originalname, url: `/uploads/${req.file.filename}`, mime: req.file.mimetype, size: req.file.size })); }
  catch (error) { removeUploadedFile(req.file.filename); throw error; }
});
app.delete('/api/v1/cards/:cardId/photos/:photoId', (req, res) => { const photo = store.removePhoto(req.params.cardId, req.params.photoId); removeUploadedFile(photo.url); res.status(204).end(); });
app.get('/api/v1/export', (_req, res) => { res.setHeader('Content-Disposition', 'attachment; filename="boards-export.json"'); res.json(store.state); });
app.get('/api/openapi.json', (_req, res) => res.sendFile(path.join(root, 'openapi.json')));
app.use(express.static(path.join(root, 'public'), { extensions: ['html'] }));
app.use((error, req, res, _next) => { console.error(`${req.method} ${req.path}:`, error.message); res.status(error.status || 500).json({ error: error.status === 404 ? 'not_found' : error.status === 400 ? 'bad_request' : 'internal_error', message: error.message }); });

if (require.main === module) app.listen(port, '0.0.0.0', () => console.log(`Board listening on http://0.0.0.0:${port}`));
module.exports = app;
