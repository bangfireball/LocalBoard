# Board — Design

## Direction

A deliberately simple, Trello-inspired personal Kanban board. The product uses familiar lists and cards, quick inline creation, drag-and-drop movement, and a lightweight detail dialog. It borrows the interaction model—not Trello branding, assets, or exact visual design.

## Principles

- **The board is the product.** No dashboard, metrics, sidebar, sprints, priorities, estimates, or developer-specific fields.
- **Fast capture.** Add a card directly at the bottom of any list. A title is the only required field.
- **Details stay optional.** Cards may have a description, labels, due date, and checklist.
- **Direct manipulation.** Drag cards between lists. Click names to rename them.
- **API parity.** Scripts and AI agents can do everything the browser can do through `/api/v1`.
- **Easy to host.** One Node process or one Docker container, with an atomic JSON data file.

## Interface

- A compact top bar contains the product name, search, and API link.
- The board title and background controls sit above horizontally scrolling lists.
- Lists use a neutral surface over a colored board background.
- Cards show only useful signals: label colors, due date, description indicator, and checklist progress.
- Card details open in a focused dialog.
- Adding cards and lists happens inline, without navigating away.

## Data model

```text
Board
 ├── name
 ├── background
 └── Lists (ordered)
      └── Cards (ordered)
           ├── title
           ├── description
           ├── labels[]
           ├── dueDate
           └── checklist[]
```

## Architecture

The static browser client and external clients use the same Express JSON API. `Store` writes a versioned JSON document through a temporary file and atomic rename. This is appropriate for a personal homelab board; a multi-user version should use a transactional database.

## API

- `GET /api/v1/state` — complete board state
- `PATCH /api/v1/board` — rename or recolor the board
- `GET/POST /api/v1/lists` — list or create lists
- `PATCH/DELETE /api/v1/lists/:id` — rename or remove an empty list
- `GET/POST /api/v1/cards` — search/list or create cards
- `GET/PATCH/DELETE /api/v1/cards/:id` — card operations
- `POST /api/v1/cards/:id/move` — move/reorder a card
- `GET /api/v1/export` — download a backup
- `GET /api/openapi.json` — machine-readable contract

An optional `KANBAN_API_KEY` protects API routes. The browser asks for it once per tab and keeps it in session storage.

## Deployment and security

The app binds to `0.0.0.0`, can run directly under Node, and includes Docker support. Use a reverse proxy with TLS outside a trusted LAN. The container runs unprivileged and persists `/app/data` in a named volume.
