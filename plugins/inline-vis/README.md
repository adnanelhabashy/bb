# bb-plugin-inline-vis

Builtin plugin for the assistant **message directive** slot
(`app.slots.messageDirective`). When the model emits:

```text
::inline-vis{file="demo.html"}
::inline-vis{file="notes.md"}
```

The omitted `source` defaults to `workspace`; `source="workspace"` is equivalent.
For a read-only artifact in the current thread's storage directory, use:

```text
::inline-vis{source="thread-storage" file="reports/result.html"}
```

Set an optional preview height in pixels with `height`:

```text
::inline-vis{file="demo.html" height="480"}
```

The default is 224px; accepted values are whole numbers from 120 through 1200.

bb replaces that leaf with this plugin's React component, which:

1. Validates the untrusted `source` and `file` attributes.
2. Resolves the canonical workspace or thread-storage file reference with
   `experimental_useFileResources()` and fetches the resulting short-lived,
   same-origin URL to surface clean inline errors.
3. Shows loading / error states. Workspace previews include a header action
   that opens the source file in bb's sidebar workspace viewer; thread-storage
   previews do not.
4. Points HTML files at bb's confined preview lease inside a sandboxed iframe.
   The lease is path-shaped, so relative sibling assets work, scripts are
   enabled, and normal web loading is allowed. The iframe keeps an opaque
   origin (no `allow-same-origin`) so scripts cannot access the bb page, its
   cookies, or storage. Remote scripts, styles, images, fonts, media, fetches,
   and WebSockets work subject to ordinary browser CORS, mixed-content, and
   remote-server policies.
5. Renders Markdown files with bb's Markdown renderer. Raw HTML is disabled.

## File security

The app validates source values and `.html`, `.htm`, `.md`, or `.markdown`
paths before resolution. The message context supplies the workspace
environment ID; thread-storage uses the message's thread ID. The host keeps
filesystem roots private and issues a ten-minute preview
lease confined to the selected root. Absolute paths and traversal are rejected.
The app rejects missing files, non-UTF-8 content, and files over 5 MiB.
Markdown renders the fetched content; HTML and its relative assets stay behind
the same confined lease. The plugin's required server entrypoint is empty.

It ships with bb and is reconciled through the builtin plugin lifecycle. Ship
a supported file in either source, then ask the agent to show it with the
directive (see the bundled `inline-vis` skill).

## Tests

```bash
pnpm exec turbo run test typecheck --filter=bb-plugin-inline-vis
```

Markdown links and images resolve relative to the document's directory in the
selected source. For `::inline-vis{source="thread-storage" file="reports/report.md"}`,
`[Notes](notes.md)` and `![Chart](chart.svg)` refer to files under `reports/`
in that thread's storage. The same rule applies to workspace reports.
