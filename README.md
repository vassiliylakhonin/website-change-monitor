# Website Change Monitor

`website-change-monitor` — self-hosted skill for detecting meaningful webpage changes and returning structured diff signals for AI agents.

## What it does

- Fetches a public webpage
- Builds a normalized snapshot (`hash`, `title`, `sections`, text length)
- Compares current page with a previous snapshot
- Returns:
  - `changed` flag
  - `severity` (`none` / `low` / `medium` / `high`)
  - section-level changes (`added`, `removed`, `modified`)
  - `estimated_change_ratio`
  - `next_checkpoint.snapshot` for next run

## Use cases

- Monitor competitor pricing pages
- Track product/changelog/docs updates
- Watch legal pages (ToS/Privacy) for changes
- Trigger automations only when change is meaningful

## API

### Endpoint

`POST /`

### Request body

```json
{
  "url": "https://example.com/pricing",
  "previous_snapshot": {
    "hash": "abc123",
    "title": "Pricing - Example",
    "text": "...",
    "sections": [
      { "heading": "pricing", "content_hash": "def456" }
    ]
  },
  "include_text_preview": true
}
```

### Response (example)

```json
{
  "url": "https://example.com/pricing",
  "fetched_at": "2026-03-20T10:00:00.000Z",
  "snapshot": {
    "title": "Pricing",
    "hash": "9f2ab1...",
    "text_length": 12345,
    "sections": [
      { "heading": "pricing", "content_hash": "a1b2c3" }
    ]
  },
  "changed": true,
  "severity": "medium",
  "summary": "Detected changes: 2 modified sections, 1 added, 0 removed.",
  "changes": {
    "title_changed": false,
    "section_changes": {
      "added": ["faq"],
      "removed": [],
      "modified": ["pricing", "plans"]
    },
    "estimated_change_ratio": 0.187
  },
  "next_checkpoint": {
    "snapshot": {
      "hash": "9f2ab1...",
      "title": "Pricing",
      "text": "...",
      "sections": [
        { "heading": "pricing", "content_hash": "a1b2c3" }
      ]
    }
  }
}
```

## Local run

```bash
npm install
npm run dev
```

Server starts on:

- `http://127.0.0.1:8787` (local)
- `PORT` env var in production

## Quick test

```bash
curl -X POST http://127.0.0.1:8787 \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com"}'
```

## Deploy (Railway)

1. Create/link project
2. Deploy this folder
3. Set env vars if needed:
   - `SKILL_SHARED_SECRET` (optional)
   - `NIXPACKS_PKGS=ca-certificates` (recommended)
4. Use generated HTTPS domain as skill endpoint

## Notes

- First call without `previous_snapshot` creates baseline snapshot.
- Persist `next_checkpoint.snapshot` and send it in the next call.
- Designed for stateless repeated monitoring workflows.
