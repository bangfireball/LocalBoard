# Board

A simple, Trello-inspired personal Kanban app with multiple boards, lists, cards, drag and drop, photo attachments, labels, due dates, checklists, search, and a complete REST API.

Click **Board** in the top-left—or press **B**—to open the board switcher and create another board.

## Run directly with Node

```bash
npm install
PORT=3001 npm start
```

On PowerShell:

```powershell
$env:PORT=3001
npm start
```

Data is stored in `data/board.json`.

## Run with Docker

```bash
cp .env.example .env
docker compose up -d --build
```

Open <http://localhost:3000>. The Docker deployment persists data in the `workboard_data` volume.

## API

The OpenAPI contract is available at `/api/openapi.json`.

```bash
# Create a board
curl -X POST http://localhost:3001/api/v1/boards \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: your-key' \
  -d '{"name":"Client work"}'

# Create a card
curl -X POST http://localhost:3001/api/v1/cards \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: your-key' \
  -d '{"title":"Review pull request","listId":"list_todo","labels":["work"]}'

# Attach a photo (JPEG, PNG, GIF, or WebP; maximum 5 MB)
curl -X POST http://localhost:3001/api/v1/cards/CARD_ID/photos \
  -H 'X-API-Key: your-key' \
  -F 'photo=@screenshot.png'

# Move a card
curl -X POST http://localhost:3001/api/v1/cards/CARD_ID/move \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: your-key' \
  -d '{"listId":"list_doing","position":0}'

# Search
curl -H 'X-API-Key: your-key' 'http://localhost:3001/api/v1/cards?q=review'

# Backup
curl -H 'X-API-Key: your-key' http://localhost:3001/api/v1/export > board-backup.json
```

If `KANBAN_API_KEY` is empty, authentication is disabled. When enabled, the browser prompts for the key and stores it only for the current tab.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `DATA_FILE` | `./data/board.json` | JSON data file |
| `KANBAN_API_KEY` | empty | Optional API key |

See [`design.md`](design.md) for product and architecture decisions.
