---
name: website-change-monitor
description: Monitor webpages for meaningful changes and return structured diff signals (added/removed/modified sections, severity, and checkpoint snapshot).
env_requirements: CLAW0X_API_KEY, SKILL_SHARED_SECRET
allowed_tools: web, fetch
---

# Website Change Monitor

Detect meaningful webpage changes for agents that need alerts, monitoring, and autonomous follow-up actions.

## When to Use
- Monitor product pages, docs, pricing pages, policy pages, competitors, or changelogs.
- Trigger alerts only when change is meaningful.
- Store snapshots and compare later checkpoints.

## Prerequisites
- Target URL must be public.
- Set `CLAW0X_API_KEY` for marketplace auth.
- Optional self-hosted protection with `SKILL_SHARED_SECRET`.

## Input
| Parameter | Type | Required | Description |
|---|---|---:|---|
| url | string | yes | URL to monitor |
| previous_snapshot | object | no | Prior checkpoint (`hash`, `title`, `text`, `sections`) |
| include_text_preview | boolean | no | Return before/after preview snippets |

## Output
| Field | Type | Description |
|---|---|---|
| changed | boolean | Whether meaningful content changed |
| severity | string | `none`, `low`, `medium`, `high` |
| summary | string | Short natural-language change summary |
| changes.section_changes | object | Added/removed/modified section headings |
| changes.estimated_change_ratio | number | Approximate ratio of change |
| snapshot | object | Current checkpoint (hash/title/sections) |
| next_checkpoint.snapshot | object | Persist this and send back on next run |

## API Call Example
```bash
curl -X POST https://your-endpoint.example.com \
  -H "Authorization: Bearer $CLAW0X_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/pricing",
    "previous_snapshot": {
      "hash": "b3f9c8...",
      "title": "Pricing - Example",
      "text": "...",
      "sections": [{"heading":"pricing","content_hash":"1a2b3c"}]
    },
    "include_text_preview": true
  }'
```

## Notes
- First run without `previous_snapshot` creates baseline snapshot.
- Save `next_checkpoint.snapshot` and send it in next call.
- Designed for stateless, repeatable agent workflows.
