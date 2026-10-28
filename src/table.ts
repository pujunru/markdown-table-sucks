// Pure Markdown table model: parsing, locating, and serializing.
// Kept free of Obsidian imports so it can be unit tested with plain Node.

export type Align = "none" | "left" | "center" | "right";

export interface TableData {
	header: string[];
	rows: string[][];
	aligns: Align[];
}

export interface TableRange {
	startLine: number;
	endLine: number; // inclusive
	prefix: string; // blockquote/callout prefix shared by every line, e.g. "> "
	table: TableData;
}

export interface SerializeOptions {
	prefix?: string;
	pad?: boolean;
}

const PREFIX_RE = /^[ \t]*(?:>[ \t]?)*/;
const SEPARATOR_CELL_RE = /^:?-+:?$/;
const BR_RE = /<br\s*\/?>/gi;

export function emptyTable(cols: number, rows: number): TableData {
	cols = Math.max(1, cols);
	return {
		header: Array.from({ length: cols }, (_, i) => `Column ${i + 1}`),
		rows: Array.from({ length: Math.max(0, rows) }, () => Array(cols).fill("")),
		aligns: Array(cols).fill("none"),
	};
}

export function linePrefix(line: string): string {
	return (line.match(PREFIX_RE) ?? [""])[0];
}

function quoteDepth(prefix: string): number {
	return (prefix.match(/>/g) ?? []).length;
}

function isEscaped(text: string, index: number): boolean {
	let backslashes = 0;
	for (let i = index - 1; i >= 0 && text[i] === "\\"; i--) backslashes++;
	return backslashes % 2 === 1;
}

function hasUnescapedPipe(text: string): boolean {
	for (let i = 0; i < text.length; i++) {
		if (text[i] === "|" && !isEscaped(text, i)) return true;
	}
	return false;
}

/** Split one table row (prefix already removed) into raw cell strings. */
export function splitRow(content: string): string[] {
	let text = content.trim();
	if (text.startsWith("|")) text = text.slice(1);
	if (text.endsWith("|") && !isEscaped(text, text.length - 1)) text = text.slice(0, -1);

	const cells: string[] = [];
	let current = "";
	for (let i = 0; i < text.length; i++) {
		if (text[i] === "|" && !isEscaped(text, i)) {
			cells.push(current.trim());
			current = "";
		} else {
			current += text[i];
		}
	}
	cells.push(current.trim());
	return cells;
}

/** Markdown cell source -> text shown in the editor. */
export function decodeCell(raw: string): string {
	let out = "";
	for (let i = 0; i < raw.length; i++) {
		if (raw[i] === "\\" && raw[i + 1] === "|") {
			out += "|";
			i++;
		} else {
			out += raw[i];
		}
	}
	return out.replace(BR_RE, "\n");
}

/** Text from the editor -> Markdown cell source. */
export function encodeCell(text: string): string {
	let out = "";
	for (let i = 0; i < text.length; i++) {
		out += text[i] === "|" && !isEscaped(text, i) ? "\\|" : text[i];
	}
	return out
		.replace(/\r\n?/g, "\n")
		.trim()
		.replace(/[ \t]*\n[ \t]*/g, "<br>");
}

function parseAlign(cell: string): Align {
	const left = cell.startsWith(":");
	const right = cell.endsWith(":");
	if (left && right) return "center";
	if (left) return "left";
	if (right) return "right";
	return "none";
}

function isSeparatorRow(cells: string[]): boolean {
	return cells.length > 0 && cells.every((c) => SEPARATOR_CELL_RE.test(c.replace(/\s+/g, "")));
}

/** Parse lines (prefix already stripped) into a table, or null if they are not one. */
export function parseTable(lines: string[]): TableData | null {
	if (lines.length < 2) return null;
	const headerCells = splitRow(lines[0]);
	const sepCells = splitRow(lines[1]);
	if (!isSeparatorRow(sepCells)) return null;

	const bodyCells = lines.slice(2).map(splitRow);
	const cols = Math.max(headerCells.length, sepCells.length, ...bodyCells.map((r) => r.length));
	const fit = (cells: string[]) =>
		Array.from({ length: cols }, (_, i) => decodeCell(cells[i] ?? ""));

	return {
		header: fit(headerCells),
		rows: bodyCells.map(fit),
		aligns: Array.from({ length: cols }, (_, i) =>
			sepCells[i] ? parseAlign(sepCells[i].replace(/\s+/g, "")) : "none",
		),
	};
}

/** Parse a standalone Markdown table string (e.g. clipboard contents). */
export function parseTableText(text: string): TableData | null {
	const lines = text.replace(/\r\n?/g, "\n").trim().split("\n");
	const prefix = linePrefix(lines[0] ?? "");
	return parseTable(lines.map((l) => l.slice(Math.min(prefix.length, linePrefix(l).length))));
}

/** Find the table that contains `cursorLine`, if any. */
export function findTableAt(
	getLine: (n: number) => string,
	lineCount: number,
	cursorLine: number,
): TableRange | null {
	const line = getLine(cursorLine);
	const prefix = linePrefix(line);
	const depth = quoteDepth(prefix);

	const isRow = (n: number) => {
		const l = getLine(n);
		const p = linePrefix(l);
		return quoteDepth(p) === depth && hasUnescapedPipe(l.slice(p.length));
	};
	if (!isRow(cursorLine)) return null;

	let start = cursorLine;
	while (start > 0 && isRow(start - 1)) start--;
	let end = cursorLine;
	while (end < lineCount - 1 && isRow(end + 1)) end++;

	// The block may contain the separator of a table that starts below a stray piped line.
	for (let s = start; s <= Math.min(cursorLine, end - 1); s++) {
		const lines: string[] = [];
		for (let n = s; n <= end; n++) {
			const l = getLine(n);
			lines.push(l.slice(linePrefix(l).length));
		}
		const table = parseTable(lines);
		if (table) return { startLine: s, endLine: end, prefix: linePrefix(getLine(s)), table };
	}
	return null;
}

/** Terminal-style display width so CJK and emoji columns line up. */
export function displayWidth(text: string): number {
	let width = 0;
	for (const ch of text) {
		const cp = ch.codePointAt(0) ?? 0;
		if (cp === 0x200d || (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0x300 && cp <= 0x36f)) continue;
		const wide =
			(cp >= 0x1100 && cp <= 0x115f) ||
			(cp >= 0x2e80 && cp <= 0xa4cf) ||
			(cp >= 0xac00 && cp <= 0xd7a3) ||
			(cp >= 0xf900 && cp <= 0xfaff) ||
			(cp >= 0xfe30 && cp <= 0xfe4f) ||
			(cp >= 0xff00 && cp <= 0xff60) ||
			(cp >= 0xffe0 && cp <= 0xffe6) ||
			(cp >= 0x1f300 && cp <= 0x1f64f) ||
			(cp >= 0x1f900 && cp <= 0x1f9ff) ||
			(cp >= 0x20000 && cp <= 0x3fffd);
		width += wide ? 2 : 1;
	}
	return width;
}

function padCell(text: string, width: number, align: Align): string {
	const gap = Math.max(0, width - displayWidth(text));
	if (align === "right") return " ".repeat(gap) + text;
	if (align === "center") {
		const left = Math.floor(gap / 2);
		return " ".repeat(left) + text + " ".repeat(gap - left);
	}
	return text + " ".repeat(gap);
}

function separatorCell(width: number, align: Align): string {
	const w = Math.max(3, width);
	switch (align) {
		case "left":
			return ":" + "-".repeat(w - 1);
		case "right":
			return "-".repeat(w - 1) + ":";
		case "center":
			return ":" + "-".repeat(w - 2) + ":";
		default:
			return "-".repeat(w);
	}
}

/** Serialize to a valid GFM/Obsidian table. Always has a header, a separator, and equal column counts. */
export function serializeTable(table: TableData, opts: SerializeOptions = {}): string {
	const { prefix = "", pad = true } = opts;
	const cols = Math.max(1, table.header.length);
	const aligns = Array.from({ length: cols }, (_, i) => table.aligns[i] ?? "none");
	const encode = (row: string[]) => Array.from({ length: cols }, (_, i) => encodeCell(row[i] ?? ""));

	const header = encode(table.header);
	const body = table.rows.map(encode);
	const widths = Array.from({ length: cols }, (_, i) =>
		pad ? Math.max(3, displayWidth(header[i]), ...body.map((r) => displayWidth(r[i]))) : 3,
	);

	const line = (cells: string[]) =>
		`${prefix}| ${cells.map((c, i) => (pad ? padCell(c, widths[i], aligns[i]) : c)).join(" | ")} |`;

	return [
		line(header),
		`${prefix}| ${aligns.map((a, i) => separatorCell(widths[i], a)).join(" | ")} |`,
		...body.map(line),
	].join("\n");
}

/** Parse tab-separated clipboard data (Excel, Sheets, Numbers), honoring quoted multi-line cells. */
export function parseTsv(text: string): string[][] {
	const rows: string[][] = [[]];
	let cell = "";
	let quoted = false;
	const src = text.replace(/\r\n?/g, "\n").replace(/\n$/, "");
	for (let i = 0; i < src.length; i++) {
		const ch = src[i];
		if (quoted) {
			if (ch === '"' && src[i + 1] === '"') {
				cell += '"';
				i++;
			} else if (ch === '"') {
				quoted = false;
			} else {
				cell += ch;
			}
		} else if (ch === '"' && cell === "") {
			quoted = true;
		} else if (ch === "\t") {
			rows[rows.length - 1].push(cell);
			cell = "";
		} else if (ch === "\n") {
			rows[rows.length - 1].push(cell);
			rows.push([]);
			cell = "";
		} else {
			cell += ch;
		}
	}
	rows[rows.length - 1].push(cell);
	return rows;
}

/** Index of the occurrence of `needle` in `content` closest to `near`, or -1. */
export function findNearest(content: string, needle: string, near: number): number {
	let best = -1;
	for (let i = content.indexOf(needle); i !== -1; i = content.indexOf(needle, i + 1)) {
		if (best === -1 || Math.abs(i - near) < Math.abs(best - near)) best = i;
	}
	return best;
}

export interface InsertPlan {
	from: { line: number; ch: number };
	to: { line: number; ch: number };
	text: string;
	/** Offset within `text` where the cursor should end up (end of the table). */
	cursor: number;
}

/**
 * Plan inserting a table at `lineNo`: replace the line if it is blank, otherwise add the table after it.
 * Blank lines keep the table separated from surrounding text, and a blockquote/callout prefix is carried over.
 */
export function planInsert(lines: string[], lineNo: number, table: TableData, opts: SerializeOptions = {}): InsertPlan {
	lineNo = Math.max(0, Math.min(lineNo, lines.length - 1));
	const line = lines[lineNo] ?? "";
	const prefix = linePrefix(line);
	const blank = prefix.trimEnd();
	const tableText = serializeTable(table, { ...opts, prefix });
	const hasContent = (n: number) => n >= 0 && n < lines.length && lines[n].slice(linePrefix(lines[n]).length).trim() !== "";
	const after = hasContent(lineNo + 1) ? "\n" + blank : "";

	const end = { line: lineNo, ch: line.length };
	if (line.slice(prefix.length).trim() === "") {
		const text = (hasContent(lineNo - 1) ? blank + "\n" : "") + tableText;
		return { from: { line: lineNo, ch: 0 }, to: end, text: text + after, cursor: text.length };
	}
	const text = "\n" + blank + "\n" + tableText;
	return { from: end, to: end, text: text + after, cursor: text.length };
}

export function lineChToOffset(lines: string[], pos: { line: number; ch: number }): number {
	let offset = 0;
	for (let i = 0; i < pos.line; i++) offset += lines[i].length + 1;
	return offset + pos.ch;
}
