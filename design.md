# LocalBoard — Design

## Direction

A deliberately simple, Trello-inspired personal Kanban app. The product supports multiple independent boards with familiar lists and cards, quick inline creation, drag-and-drop movement, and a lightweight detail dialog. It borrows the interaction model—not Trello branding, assets, or exact visual design.

## Principles

- **The board is the product.** No dashboard, metrics, sidebar, sprints, priorities, estimates, or developer-specific fields.
- **Fast capture.** Add a card directly at the bottom of any list. A title is the only required field.
- **Details stay optional.** Cards may have a description, labels, assignee, complete/recurring due date, reminder, checklist, files, links, and comments.
- **History is durable.** Cards and lists archive instead of disappearing, while activity records creates, edits, moves, completions, comments, and attachments.
- **Direct manipulation.** Drag cards between lists. Click names to rename them.
- **API parity.** Scripts and AI agents can do everything the browser can do through `/api/v1`.
- **Easy to host.** One Node process or one Docker container, with an atomic JSON data file.

## Interface

- A compact top bar contains the Board switcher, search, and API link.
- Clicking **Board** or pressing **B** opens a sidebar for switching and creating boards.
- The board title and background controls sit above horizontally scrolling lists.
- Lists use a neutral surface over a colored board background.
- Cards show only useful signals: label colors, due date, description indicator, and checklist progress.
- Card details open in a focused dialog that closes when its backdrop is clicked; clipboard images pasted into the description are uploaded directly to the card.
- Photos open in a full-size, in-browser lightbox.
- Trello-style colored labels are defined and customized per board, then selected on cards.
- Adding cards and lists happens inline, without navigating away.

## Data model

```text
Boards
 └── Board
      ├── name
      ├── background
      └── Lists (ordered)
      └── Cards (ordered)
           ├── title
           ├── description
           ├── labels[]
           ├── dueAt / dueComplete / reminder / recurrence
           ├── assignee
           ├── checklist[]
           ├── attachments[]
           └── comments[]

Activity[] records durable board and card events.
```

## Architecture

The static browser client and external clients use the same Express JSON API. `Store` writes a versioned JSON document through a temporary file and atomic rename. This is appropriate for a personal homelab board; a multi-user version should use a transactional database.

## API

- `GET /api/v1/state?boardId=...` — one board's complete state
- `GET/POST /api/v1/boards` — list or create boards
- `GET/PATCH/DELETE /api/v1/boards/:id` — get, edit, or delete a board
- `GET/POST /api/v1/lists` — list or create lists
- `PATCH /api/v1/lists/:id` and `POST .../archive|restore` — edit or archive lists
- `GET/POST /api/v1/cards` — search/list or create cards
- `GET/PATCH/DELETE /api/v1/cards/:id` — card operations
- `POST /api/v1/cards/:id/move|archive|restore|complete-due` — workflow operations
- `POST/DELETE /api/v1/cards/:id/attachments` — files and links
- `GET/POST/PATCH/DELETE .../comments` — card discussion
- `GET /api/v1/activity` — board or card audit history
- `GET /api/v1/export` — download a backup
- `GET /api/openapi.json` — machine-readable contract

An optional `KANBAN_API_KEY` protects API routes. The browser asks for it once per tab and keeps it in session storage. Uploaded files are stored under the data directory with randomized URLs. In-app and browser-notification reminders run while LocalBoard is open; the due metadata remains available to external automation at all times.

All confirmations and text entry use accessible native HTML dialogs; the interface does not rely on browser `alert`, `prompt`, or `confirm` boxes.

## Deployment and security

LocalBoard is intended to run as a Docker container on a homelab server and be reachable by other devices on the local network. It binds to `0.0.0.0:3001`; the host must publish TCP port `3001` and allow it through the LAN-facing firewall. The container runs as an unprivileged user and persists `/app/data` in the `localboard_data` named volume.

Set a strong `KANBAN_API_KEY` before exposing the service to the network. Keep the server and port restricted to trusted LAN or VPN clients. If LocalBoard is exposed beyond the trusted LAN, place it behind an authenticated reverse proxy with TLS rather than publishing the container directly. Back up the named volume—or regularly download `/api/v1/export`—because application data and uploaded files live there. The existing host `data/board.json` is not imported into the Docker volume automatically.

The same application can also run directly as a single Node process for development, but the homelab deployment target is Docker Compose.
