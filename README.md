# Markdown Table Sucks

Writing Markdown tables by hand is miserable. This Obsidian plugin lets you edit them in a spreadsheet-like modal instead, and writes back a clean, valid Markdown table every time.

## Usage

- **Right-click** in the editor → **Insert table** (or **Edit table** when the cursor is inside one), or **… in new window**.
- **Command palette** → **Insert or edit table**, or **Insert or edit table in a pop-out window**. Bind either to a hotkey in *Settings → Hotkeys*.

If the cursor is inside an existing table, the editor opens with its contents. Otherwise it opens a fresh table and inserts it at the cursor.

### The editor

Cells are rendered with Obsidian's own Markdown renderer — bold, links, code, math and embeds look the way they do in your note. Click a cell (or Tab into it) to edit its raw Markdown.

| Action                       | How                                                                        |
| ---------------------------- | -------------------------------------------------------------------------- |
| Reorder rows / columns       | Drag the ⠿ grip left of a row or above a column                            |
| Row / column options         | Click the grip: align, sort, insert, move, delete                          |
| Add a row / column           | Click the **+** strip along the bottom / right edge                        |
| Next row (adds one at end)   | `Enter`                                                                    |
| Line break inside a cell     | `Shift+Enter` (saved as `<br>`)                                            |
| Next / previous cell         | `Tab` / `Shift+Tab`                                                        |
| Cell above / below           | `Alt+↑` / `Alt+↓`                                                          |
| Save                         | `Cmd/Ctrl+Enter` or **Insert / Update**                                    |
| Paste a block of cells       | Paste from Excel / Google Sheets / Numbers, or paste a Markdown table      |
| Edit in a separate window    | **Pop out** button (desktop)                                               |

### Pop-out window

On desktop the editor can live in its own resizable window, so you can keep the note visible while you edit. Saving finds the original table by its text, so it still lands in the right place if you edit the note meanwhile — even if the note was closed. If the table itself was changed in the note, nothing is overwritten and the edited table is copied to your clipboard instead.

## What the output looks like

- Always a header row, a separator row, and the same number of cells on every row.
- `|` inside cells is escaped as `\|`, so wikilink aliases like `[[Note|alias]]` keep working.
- Line breaks are written as `<br>`.
- Column alignment is written to the separator (`:--`, `:-:`, `--:`).
- Pipes are padded so the source lines up, counting CJK and emoji as double width. Turn this off in settings for compact output.
- Tables inside blockquotes and callouts keep their `> ` prefix.

## Settings

- **Default columns / rows** for new tables.
- **Open editor in** — dialog or pop-out window.
- **Pad columns** — aligned or compact Markdown source.

## Install

### From the community plugin list
Search for **Markdown Table Sucks** in *Settings → Community plugins → Browse* (once accepted).

### Manually
Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/pujunru/markdown-table-sucks/releases/latest) into `<vault>/.obsidian/plugins/markdown-table-sucks/`, then enable the plugin.

## Development

```bash
npm install
npm run dev     # watch build
npm run build   # typecheck + production build
npm test        # parser/serializer tests
```

Releases: `npm version patch` then push the tag; the GitHub workflow attaches the build to a draft release.

## License

MIT
