# issync

Bidirectional GitHub issue syncing tool.

## Features

- Bidirectional sync between GitHub and local markdown files
- Conflict detection
- Metadata support (labels, assignees, milestones, state)
- GitHub Projects v2 support (custom fields)
- Issues stored as markdown with YAML frontmatter
- Direct GitHub API integration (fast and reliable)

## Requirements

- Node.js >= 18
- GitHub authentication (see below)

## Installation

```bash
npm install -g issync
```

Or run directly:

```bash
npx issync
```

## Authentication

Two options:

1. **Environment variable**: Set `GITHUB_TOKEN` or `GH_TOKEN` (get token from https://github.com/settings/tokens)
2. **GitHub CLI**: Run `gh auth login` (issync uses `gh auth token` automatically)

## Usage

```bash
issync down                              # Sync from GitHub
issync down --closed --projects          # Include closed issues and project fields
issync up                                # Sync to GitHub
issync up --dry-run                      # Preview changes
issync sync                              # Bidirectional sync
issync conflicts                         # Detect conflicts
```

Flags: `--closed` `--full` `--projects` `--force` `--dry-run`

## How it Works

Issues stored in `.issync/issues/` as markdown with YAML frontmatter. Sync state tracked in `.issync/state.json`. Conflicts detected when both local and remote changed since last sync.

## Licence

MIT
