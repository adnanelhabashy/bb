# bb-setup

Adnan's BB customization layer — one repo, one command per machine.

## What's inside

| Path | What | BB id |
|---|---|---|
| `plugins/adnan-mission-control` | Engineering cockpit plugin (workflow state, agent tree, role resolver) | `adnan-mission-control` v0.2.0 |
| `plugins/cyberpunk-terminal` | Neon tabbed terminal window plugin | `cyberpunk-terminal` v0.1.0 |
| `theme/cyber-punk/theme.css` | Custom app theme | `cyber-punk` |

Built against BB 0.43.1 (plugin SDK 0.4.87).

## Install on a fresh machine

Prerequisite: BB app installed and `bb` CLI on PATH. Nothing else — plugin
sources are plain TS; BB compiles them with its shipped toolchain.

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

The scripts copy the theme into `~/.bb/theme/cyber-punk` (or `%USERPROFILE%\.bb\...`)
and register both plugins by path. Not included, by design: provider auth,
account-pool credentials, and `bb.db` state — re-authenticate on each machine.

## Day-to-day

- **Edit a plugin:** change files in `plugins/<name>/`, then `bb plugin reload <id>`.
- **Change the theme:** edit `theme/cyber-punk/theme.css` (live copy at
  `$(bb theme dir)/cyber-punk/theme.css`), then `bb theme set cyber-punk`.
- **Propagate to another machine:** commit + push here, then `git pull` there.
  Plugin registrations survive a pull (paths don't move); if a plugin dir ever
  moves, `bb plugin install path:<new dir>` re-points it and keeps its config.

## Updating from a machine where the plugins live elsewhere

The canonical copies used to live at `~/Projects/bb-plugin-adnan-mission-control`
(mac) and inside a personal-workspace thread dir (cyberpunk-terminal). Those are
superseded by this repo. Diff before deleting anything:

```bash
diff -r ~/Projects/bb-plugin-adnan-mission-control plugins/adnan-mission-control \
  --exclude node_modules --exclude dist
```
