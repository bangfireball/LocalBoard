# Moodle Workboard

A simple, feature-rich, API-first Kanban board for custom Moodle plugin work. It includes drag and drop, WIP limits, search and filters, priorities, estimates, due dates, checklists, Moodle/plugin metadata, activity history, dark mode, JSON export, and an OpenAPI contract.

## Run with Docker

```bash
cp .env.example .env
# Edit .env and choose a strong API key.
docker compose up -d --build
```

Open <http://localhost:3000>. Data persists in the `workboard_data` Docker volume.

> When `KANBAN_API_KEY` is set, the browser prompts for it and keeps it only in session storage. API clients send `X-API-Key: ...`.

## Run locally

```bash
npm install
npm run dev
```

By default, data is written to `data/board.json`.

## API examples

The machine-readable API description is at `/api/openapi.json`.

```bash
# Create a task
curl -X POST http://localhost:3000/api/v1/cards \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: your-key' \
  -d '{
    "title":"Implement privacy provider",
    "columnId":"col_ready",
    "type":"feature",
    "priority":"high",
    "pluginName":"local_clientportal",
    "moodleVersion":"4.5",
    "tags":["privacy-api","backend"],
    "estimate":4
  }'

# Search cards
curl -H 'X-API-Key: your-key' \
  'http://localhost:3000/api/v1/cards?q=privacy&priority=high'

# Move a task
curl -X POST http://localhost:3000/api/v1/cards/CARD_ID/move \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: your-key' \
  -d '{"columnId":"col_progress","position":0}'

# Back up all data
curl -H 'X-API-Key: your-key' http://localhost:3000/api/v1/export > backup.json
```

Authentication is disabled if `KANBAN_API_KEY` is empty. Keep the service on a trusted network or configure the key and a reverse proxy with TLS.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP listening port |
| `DATA_FILE` | `./data/board.json` | Persistent JSON data path |
| `KANBAN_API_KEY` | empty | Optional API authentication token |

## Development

```bash
npm test
```

See [`design.md`](design.md) for product decisions and architecture.
