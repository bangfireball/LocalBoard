# Moodle Workboard — Design

## Product direction

A focused, self-hosted Kanban board for a senior developer building custom Moodle plugins. The product should feel faster and calmer than a general project-management suite while retaining rich technical metadata and complete API control.

## Core goals

1. **Glanceable work state** — columns, WIP limits, priorities, due dates, estimates, checklist progress, and sprint metrics.
2. **Moodle-aware tasks** — first-class plugin component name, target Moodle version, issue/repository URL, and tags for APIs or subsystems.
3. **API-first operation** — every meaningful board operation is available under a versioned JSON REST API, suitable for shell scripts, CI jobs, or AI agents.
4. **Simple homelab operation** — one container, one persistent volume, health check, no external database, and optional API-key protection.
5. **Low maintenance** — server-rendered static assets with no frontend build chain; atomic JSON persistence suitable for a personal/small-team board.

## User experience

- Dark navigation rail and a low-noise canvas inspired by developer tools.
- Horizontal, draggable columns with explicit WIP counters.
- Cards summarize type, priority, plugin, tags, checklist, estimate, and due date.
- Global search plus type and priority filters.
- Task modal provides rich metadata without cluttering the board.
- Activity log gives a compact audit trail.
- Keyboard shortcut: `N` creates a task; `Escape` closes dialogs.
- Light and dark themes persist locally.
- Responsive layout preserves horizontal Kanban behavior on small screens.

## Architecture

```text
Browser / script / AI agent
          │
          ├── Static UI (HTML + CSS + vanilla JS)
          │
          └── REST /api/v1/*
                    │
              Express service
                    │
          atomic board.json writes
                    │
          Docker named volume
```

### Persistence

The data store is a versioned JSON document containing board metadata, columns, cards, and the latest 500 activity events. Writes go to a temporary file and are atomically renamed to reduce corruption risk. This is intentionally optimized for a single-user homelab deployment. For a larger multi-user installation, replace `Store` with a PostgreSQL adapter while keeping the HTTP contract.

### Data model

- **Board:** name, description, timestamps.
- **Column:** name, color, order, optional WIP limit.
- **Card:** title, Markdown-ready description, column/order, priority, type, tags, assignee, due date, estimate, Moodle version, plugin component, tracker URL, checklist, archived flag, timestamps.
- **Activity:** action, related card, human-readable detail, timestamp.

## API design

- Base path: `/api/v1`
- JSON requests and responses.
- Stable resource IDs with readable prefixes (`card_`, `col_`, `event_`).
- Optional authentication through `X-API-Key` or `Authorization: Bearer ...` when `KANBAN_API_KEY` is set.
- Machine-readable contract at `/api/openapi.json`.
- Health endpoint at `/health` is intentionally unauthenticated for container orchestration.
- Board export endpoint provides simple backups and migration.

## Security and deployment

- Runs as an unprivileged container user.
- `no-new-privileges` in Compose.
- Common security headers and request body limit.
- API key comparison is currently appropriate for a private homelab. Place the service behind a TLS reverse proxy (Caddy, Traefik, or Nginx) before access outside the LAN.
- Back up the Docker volume, or regularly download `/api/v1/export`.

## Deliberate tradeoffs

- JSON persistence avoids database administration but is not intended for high write concurrency.
- The browser UI uses the same API as automation, keeping capabilities aligned.
- Descriptions are stored as plain text and ready for future Markdown rendering; rendering is withheld now to avoid introducing an HTML sanitization dependency.
- Authentication protects the entire API when enabled. A future multi-user release should add sessions, roles, and per-board authorization.

## Potential next iterations

- Multiple boards and saved views.
- Recurring tasks and task templates for Moodle release workflows.
- GitLab/GitHub and Moodle Tracker synchronization.
- Webhooks for card events.
- PostgreSQL adapter and user accounts.
- Markdown preview, comments, and file attachments.
- Cycle-time analytics and sprint history.
