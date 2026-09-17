# bb-setup

Adnan's BB customization layer — one repo, one command per machine.

## What's inside

| Path | What | BB id |
|---|---|---|
| `plugins/adnan-mission-control` | Engineering cockpit plugin (workflow state, agent tree, role resolver) | `adnan-mission-control` v0.2.0 |
| `plugins/cyberpunk-terminal` | Neon tabbed terminal window plugin | `cyberpunk-terminal` v0.1.0 |
| `theme/cyber-punk/theme.css` | Custom app theme | `cyber-punk` |

Built against BB 0.43.1 (plugin SDK 0.4.87).

Each plugin ships its prebuilt bundle in `dist/` (committed). BB prefers the
prebuilt bundle over compiling from source, so **the install scripts need no
Node.js and no npm** — just the BB app and git.

## Install on a fresh machine

Prerequisites: BB app installed, `bb` CLI and `git` on PATH. Node.js is **not**
needed — BB installs plugin dependencies with its own bundled npm.

```powershell
# Windows (PowerShell)
git clone <this-repo-url> bb-setup
cd bb-setup
.\install.ps1
```

```bash
# macOS / Linux
git clone <this-repo-url> bb-setup
cd bb-setup
./install.sh
```

The scripts copy the theme into `~/.bb/theme/cyber-punk` (or
`%USERPROFILE%\.bb\...`) and install both plugins **from the clone's git
origin** via BB's subdirectory install (`bb plugin install git:<origin>
--subdirectory plugins/<name>`). Managed git installs stay updatable with
`bb plugin update <id>`. Not included, by design: provider auth, account-pool
credentials, and `bb.db` state — re-authenticate on each machine.

## Day-to-day

- **Edit a plugin:** change files in `plugins/<name>/`, then rebuild and reload:
  `npm install` (first time only, needs Node) → `bb plugin build plugins/<name>`
  → `bb plugin reload <id>` → commit the updated `dist/` with the source.
- **Change the theme:** edit `theme/cyber-punk/theme.css` (live copy at
  `$(bb theme dir)/cyber-punk/theme.css`), then `bb theme set cyber-punk`.
- **Propagate updates to another machine:** commit + push here, then `git pull`
  in the clone there and `bb plugin update adnan-mission-control` /
  `bb plugin update cyberpunk-terminal` (managed git installs track the repo).
- **Moving a plugin's directory:** `bb plugin install path:<new dir>` re-points
  it and keeps its config.

## Updating from a machine where the plugins live elsewhere

The canonical copies used to live at `~/Projects/bb-plugin-adnan-mission-control`
(mac) and inside a personal-workspace thread dir (cyberpunk-terminal). Those are
superseded by this repo. Diff before deleting anything:

```bash
diff -r ~/Projects/bb-plugin-adnan-mission-control plugins/adnan-mission-control \
  --exclude node_modules --exclude dist
```
