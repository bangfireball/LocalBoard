# LocalBoard

A self-hosted, Trello-inspired Kanban app with multiple boards, archiving, recurring due dates and reminders, comments, durable activity history, general file/link attachments, customizable labels, checklists, search, and a complete REST API.

Click **Board** in the top-left—or press **B**—to open the board switcher and create another board. While editing a card, paste a clipboard image directly into the description field to attach it.

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

Open <http://localhost:3001>. The Docker deployment persists data in the `localboard_data` volume.

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

# Attach any file (maximum 25 MB)
curl -X POST http://localhost:3001/api/v1/cards/CARD_ID/attachments \
  -H 'X-API-Key: your-key' \
  -F 'file=@specification.pdf'

# Archive a card without losing its history
curl -X POST -H 'X-API-Key: your-key' \
  http://localhost:3001/api/v1/cards/CARD_ID/archive

# Add a comment
curl -X POST http://localhost:3001/api/v1/cards/CARD_ID/comments \
  -H 'Content-Type: application/json' -H 'X-API-Key: your-key' \
  -d '{"author":"Alex","text":"Ready for review"}'

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
| `PORT` | `3001` | HTTP port |
| `HOST` | `0.0.0.0` | HTTP bind address |
| `DATA_FILE` | `./data/board.json` | JSON data file |
| `KANBAN_API_KEY` | empty | Optional API key |

See [`design.md`](design.md) for product and architecture decisions.
