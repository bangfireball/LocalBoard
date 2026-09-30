const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const multer = require('multer');
const { Store } = require('./store');

const app = express();
const port = Number(process.env.PORT) || 3001;
const host = process.env.HOST || '0.0.0.0';
const root = path.resolve(__dirname, '..');
const dataFile = process.env.DATA_FILE || path.join(root, 'data', 'board.json');
const uploadDirectory = path.join(path.dirname(dataFile), 'uploads');
fs.mkdirSync(uploadDirectory, { recursive: true });
const store = new Store(dataFile);
const upload = multer({
  storage: multer.diskStorage({ destination: uploadDirectory, filename: (_req, file, done) => { const extension = path.extname(file.originalname).replace(/[^.a-z0-9]/gi, '').slice(0, 12); done(null, `${crypto.randomUUID()}${extension}`); } }),
  limits: { fileSize: 25 * 1024 * 1024 }
});
const imageTypes = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const removeUploadedFile = (url) => { if (url?.startsWith('/uploads/')) fs.rm(path.join(uploadDirectory, path.basename(url)), { force: true }, () => {}); };

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

app.get('/health', (_req, res) => res.json({ status: 'ok', version: '5.0.0', time: new Date().toISOString() }));
app.use('/uploads', express.static(uploadDirectory, { immutable: true, maxAge: '30d' }));
app.use('/api/v1', authenticate);
app.get('/api/v1/state', (req, res) => res.json(store.boardState(req.query.boardId)));
app.get('/api/v1/archive', (req, res) => res.json(store.archiveState(req.query.boardId)));
app.get('/api/v1/boards', (_req, res) => res.json([...store.state.boards].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))));
app.post('/api/v1/boards', (req, res) => res.status(201).json(store.createBoard(req.body)));
app.get('/api/v1/boards/:id', (req, res) => res.json(store.getBoard(req.params.id)));
app.patch('/api/v1/boards/:id', (req, res) => res.json(store.updateBoard(req.params.id, req.body)));
app.delete('/api/v1/boards/:id', (req, res) => { store.deleteBoard(req.params.id).forEach((item) => removeUploadedFile(item.url)); res.status(204).end(); });
app.post('/api/v1/boards/:id/labels', (req, res) => res.status(201).json(store.createLabel(req.params.id, req.body)));
app.patch('/api/v1/boards/:id/labels/:labelId', (req, res) => res.json(store.updateLabel(req.params.id, req.params.labelId, req.body)));
app.delete('/api/v1/boards/:id/labels/:labelId', (req, res) => { store.deleteLabel(req.params.id, req.params.labelId); res.status(204).end(); });
app.get('/api/v1/lists', (req, res) => res.json(store.boardState(req.query.boardId).lists));
app.post('/api/v1/lists', (req, res) => res.status(201).json(store.createList(req.body)));
app.patch('/api/v1/lists/:id', (req, res) => res.json(store.updateList(req.params.id, req.body)));
app.post('/api/v1/lists/:id/archive', (req, res) => res.json(store.archiveList(req.params.id, true)));
app.post('/api/v1/lists/:id/restore', (req, res) => res.json(store.archiveList(req.params.id, false)));
app.delete('/api/v1/lists/:id', (req, res) => { store.deleteList(req.params.id); res.status(204).end(); });
app.get('/api/v1/cards', (req, res) => { const items = store.listCards(req.query); res.json({ items, total: items.length }); });
app.post('/api/v1/cards', (req, res) => res.status(201).json(store.createCard(req.body)));
app.get('/api/v1/cards/:id', (req, res) => res.json(store.getCard(req.params.id)));
app.patch('/api/v1/cards/:id', (req, res) => res.json(store.updateCard(req.params.id, req.body)));
app.delete('/api/v1/cards/:id', (req, res) => { const card = store.deleteCard(req.params.id); card.attachments.filter((item) => item.kind === 'file').forEach((item) => removeUploadedFile(item.url)); res.status(204).end(); });
app.post('/api/v1/cards/:id/move', (req, res) => res.json(store.moveCard(req.params.id, req.body.listId, req.body.position)));
app.post('/api/v1/cards/:id/archive', (req, res) => res.json(store.archiveCard(req.params.id, true)));
app.post('/api/v1/cards/:id/restore', (req, res) => res.json(store.archiveCard(req.params.id, false)));
app.post('/api/v1/cards/:id/complete-due', (req, res) => res.json(store.completeDue(req.params.id)));
app.post('/api/v1/cards/:id/attachments', upload.single('file'), (req, res) => {
  try {
    if (req.file) return res.status(201).json(store.addAttachment(req.params.id, { kind: 'file', name: req.file.originalname, url: `/uploads/${req.file.filename}`, mime: req.file.mimetype, size: req.file.size }));
    if (!req.body.url || !/^https?:\/\//i.test(req.body.url)) return res.status(400).json({ error: 'bad_request', message: 'Upload a file or provide an http(s) URL.' });
    res.status(201).json(store.addAttachment(req.params.id, { kind: 'link', name: req.body.name || req.body.url, url: req.body.url, mime: 'text/uri-list', size: 0 }));
  } catch (error) { if (req.file) removeUploadedFile(`/uploads/${req.file.filename}`); throw error; }
});
app.get('/api/v1/cards/:cardId/attachments/:attachmentId/download', (req, res) => {
  const item = store.getCard(req.params.cardId).attachments.find((entry) => entry.id === req.params.attachmentId);
  if (!item) return res.status(404).json({ error: 'not_found', message: 'attachment not found' });
  if (item.kind === 'link') return res.redirect(item.url);
  res.download(path.join(uploadDirectory, path.basename(item.url)), item.name);
});
app.delete('/api/v1/cards/:cardId/attachments/:attachmentId', (req, res) => { const item = store.removeAttachment(req.params.cardId, req.params.attachmentId); if (item.kind === 'file') removeUploadedFile(item.url); res.status(204).end(); });
// Backward-compatible photo endpoints.
app.post('/api/v1/cards/:id/photos', upload.single('photo'), (req, res) => { if (!req.file || !imageTypes.has(req.file.mimetype)) { if (req.file) removeUploadedFile(`/uploads/${req.file.filename}`); return res.status(400).json({ error: 'bad_request', message: 'A JPEG, PNG, GIF, or WebP photo is required.' }); } res.status(201).json(store.addAttachment(req.params.id, { kind: 'file', name: req.file.originalname, url: `/uploads/${req.file.filename}`, mime: req.file.mimetype, size: req.file.size })); });
app.delete('/api/v1/cards/:cardId/photos/:photoId', (req, res) => { const item = store.removeAttachment(req.params.cardId, req.params.photoId); if (item.kind === 'file') removeUploadedFile(item.url); res.status(204).end(); });
app.get('/api/v1/cards/:id/comments', (req, res) => res.json(store.listComments(req.params.id)));
app.post('/api/v1/cards/:id/comments', (req, res) => res.status(201).json(store.createComment(req.params.id, req.body)));
app.patch('/api/v1/cards/:cardId/comments/:commentId', (req, res) => res.json(store.updateComment(req.params.cardId, req.params.commentId, req.body)));
app.delete('/api/v1/cards/:cardId/comments/:commentId', (req, res) => { store.deleteComment(req.params.cardId, req.params.commentId); res.status(204).end(); });
app.get('/api/v1/activity', (req, res) => res.json(store.listActivity(req.query)));
app.get('/api/v1/export', (_req, res) => { res.setHeader('Content-Disposition', 'attachment; filename="localboard-export.json"'); res.json(store.state); });
app.get('/api/openapi.json', (_req, res) => res.sendFile(path.join(root, 'openapi.json')));
app.use(express.static(path.join(root, 'public'), { extensions: ['html'] }));
app.use((error, req, res, _next) => { console.error(`${req.method} ${req.path}:`, error.message); if (error.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'too_large', message: 'Files must be 25 MB or smaller.' }); res.status(error.status || 500).json({ error: error.status === 404 ? 'not_found' : error.status === 400 ? 'bad_request' : 'internal_error', message: error.message }); });

if (require.main === module) app.listen(port, host, () => console.log(`LocalBoard listening on http://${host}:${port}`));
module.exports = app;
