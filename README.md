# LocalBoard

A self-hosted, Trello-inspired Kanban app with multiple boards, archiving, recurring due dates and reminders, comments, durable activity history, general file/link attachments, customizable labels, checklists, search, and a complete REST API.

Click **Board** in the top-left—or press **B**—to open the board switcher, create another board, or import a Trello board JSON export. While editing a card, paste a clipboard image directly into the description field to attach it.

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
# Replace KANBAN_API_KEY in .env; for example: openssl rand -hex 32
docker compose up -d --build
```

Compose refuses to start without `KANBAN_API_KEY`, because it publishes the service to the LAN. Open <http://localhost:3001>. The Docker deployment persists data in the `localboard_data` volume.

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

# Import a Trello board export (maximum 5 MB)
curl -X POST http://localhost:3001/api/v1/import/trello \
  -H 'Content-Type: application/json' -H 'X-API-Key: your-key' \
  --data-binary @trello-board.json

# Backup
curl -H 'X-API-Key: your-key' http://localhost:3001/api/v1/export > board-backup.json
```

Trello import always creates a new board. It maps ordered lists/cards, descriptions, labels, due/completed state, members into the single assignee field, checklists, and `commentCard` comments. Comment authors and source timestamps are preserved. Attachments and unsupported fields are ignored; LocalBoard never fetches remote attachment URLs. Invalid imports are rejected without creating a partial board.

When running directly with Node, an empty `KANBAN_API_KEY` disables authentication for trusted local development. Docker Compose requires a key. When enabled, the browser prompts for it and stores it only for the current tab.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3001` | HTTP port |
| `HOST` | `0.0.0.0` | HTTP bind address |
| `DATA_FILE` | `./data/board.json` | JSON data file |
| `KANBAN_API_KEY` | empty for direct Node; required by Compose | API key for all `/api/v1` routes |

See [`design.md`](design.md) for product and architecture decisions.
