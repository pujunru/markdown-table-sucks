import { App, Component, MarkdownRenderer, Menu, Platform, setIcon } from "obsidian";
import { Align, TableData, parseTableText, parseTsv } from "./table";

type Cell = { row: number; col: number }; // row -1 is the header
type Drag = { kind: "row" | "col"; from: number };

export function cloneTable(t: TableData): TableData {
	return { header: [...t.header], rows: t.rows.map((r) => [...r]), aligns: [...t.aligns] };
}

const ALIGN_ICONS: Record<Align, string> = {
	none: "align-justify",
	left: "align-left",
	center: "align-center",
	right: "align-right",
};

export interface EditorSession {
	table: TableData;
	isNew: boolean;
	sourcePath: string;
	/** Write the table back to the note. */
	commit: (table: TableData) => void;
}

export interface EditorHost {
	close: () => void;
	/** Move editing to a pop-out window; absent where pop-outs are unavailable. */
	popOut?: (session: EditorSession) => void;
}

/** The table grid, buttons, and keyboard handling, mountable in a modal or a workspace view. */
export class TableEditor {
	private data: TableData;
	private gridEl!: HTMLElement;
	private focusAfterRender: Cell | null = { row: -1, col: 0 };
	private lastFocused: Cell = { row: -1, col: 0 };
	private saved = false;
	private drag: Drag | null = null;
	private renderScope = new Component();
	private readonly sourcePath: string;

	constructor(
		private readonly app: App,
		private readonly containerEl: HTMLElement,
		private readonly session: EditorSession,
		private readonly host: EditorHost,
	) {
		this.sourcePath = session.sourcePath;
		this.data = cloneTable(session.table);
	}

	mount(): void {
		const { containerEl } = this;
		containerEl.addClass("mts-editor");
		containerEl.createDiv({
			cls: "mts-hint",
			text: `Drag ⠿ to reorder · Click ⠿ for options · Enter: next row · Shift+Enter: line break · ${Platform.isMacOS ? "⌘" : "Ctrl"}+Enter: save · Paste cells from a spreadsheet`,
		});

		this.gridEl = containerEl.createDiv("mts-grid-wrap");
		this.gridEl.addEventListener("dragover", (evt) => this.onDragOver(evt));
		this.gridEl.addEventListener("drop", (evt) => this.onDrop(evt));
		this.render();

		const footer = containerEl.createDiv("modal-button-container mts-footer");
		if (this.host.popOut) {
			const pop = footer.createEl("button", { cls: "mts-popout", attr: { "aria-label": "Edit in a separate window" } });
			setIcon(pop.createSpan(), "picture-in-picture-2");
			pop.createSpan({ text: "Pop out" });
			pop.onclick = () => this.host.popOut?.({ ...this.session, table: cloneTable(this.data) });
		}
		footer.createEl("button", { text: "Cancel" }).onclick = () => this.host.close();
		const save = footer.createEl("button", { text: this.session.isNew ? "Insert" : "Update", cls: "mod-cta" });
		save.onclick = () => this.save();

		containerEl.addEventListener("keydown", (evt) => {
			if (evt.key === "Enter" && (Platform.isMacOS ? evt.metaKey : evt.ctrlKey)) {
				evt.preventDefault();
				evt.stopPropagation();
				this.save();
			}
		});
	}

	destroy(): void {
		this.renderScope.unload();
		this.containerEl.empty();
	}

	save(): void {
		if (this.saved) return;
		this.saved = true;
		this.session.commit(this.data);
		this.host.close();
	}

	// ---- rendering ----------------------------------------------------------

	private render(): void {
		const scrollLeft = this.gridEl.scrollLeft;
		const scrollTop = this.gridEl.scrollTop;
		this.gridEl.empty();
		this.renderScope.unload();
		this.renderScope = new Component();
		this.renderScope.load();
		const table = this.gridEl.createEl("table", { cls: "mts-grid" });

		// Column handles, plus the "add column" strip running down the right edge
		const handleRow = table.createEl("tr", { cls: "mts-col-handles" });
		handleRow.createEl("td", { cls: "mts-corner" });
		this.data.header.forEach((_, col) => {
			const td = handleRow.createEl("td", { attr: { "data-col": String(col) } });
			const btn = this.handle(td, "grip-horizontal", "Drag to move column, click for options", { kind: "col", from: col });
			if (this.data.aligns[col] !== "none") setIcon(btn.createSpan("mts-align-badge"), ALIGN_ICONS[this.data.aligns[col]]);
			btn.onclick = (evt) => this.columnMenu(col, evt);
		});
		const addCol = handleRow.createEl("td", {
			cls: "mts-add mts-add-col",
			attr: { rowspan: String(this.data.rows.length + 2), "aria-label": "Add column" },
		});
		setIcon(addCol, "plus");
		addCol.onclick = () => this.insertCol(this.colCount);

		this.renderRow(table, -1, this.data.header);
		this.data.rows.forEach((row, r) => this.renderRow(table, r, row));

		const addRow = table.createEl("tr").createEl("td", {
			cls: "mts-add mts-add-row",
			attr: { colspan: String(this.colCount + 1), "aria-label": "Add row" },
		});
		setIcon(addRow, "plus");
		addRow.onclick = () => this.insertRow(this.data.rows.length);

		this.gridEl.scrollLeft = scrollLeft;
		this.gridEl.scrollTop = scrollTop;

		if (this.focusAfterRender) {
			const target = this.focusAfterRender;
			this.focusAfterRender = null;
			window.setTimeout(() => this.focusCell(target), 0);
		}
	}

	private renderRow(table: HTMLElement, rowIndex: number, cells: string[]): void {
		const tr = table.createEl("tr", { cls: rowIndex === -1 ? "mts-header" : "", attr: { "data-row": String(rowIndex) } });
		const handleCell = tr.createEl("td", { cls: "mts-row-handle" });
		const btn =
			rowIndex === -1
				? handleCell.createEl("button", { cls: "mts-handle clickable-icon", attr: { "aria-label": "Row options" } })
				: this.handle(handleCell, "grip-vertical", "Drag to move row, click for options", { kind: "row", from: rowIndex });
		if (rowIndex === -1) setIcon(btn, "grip-vertical");
		btn.onclick = (evt) => this.rowMenu(rowIndex, evt);

		cells.forEach((value, col) => {
			const td = tr.createEl("td", { cls: "mts-cell", attr: { "data-col": String(col) } });
			const preview = td.createDiv({ cls: "mts-preview markdown-rendered" });
			if (this.data.aligns[col] !== "none") preview.style.textAlign = this.data.aligns[col];
			this.renderPreview(preview, value);
			const input = td.createEl("textarea", {
				attr: { rows: "1", "data-row": String(rowIndex), "data-col": String(col), spellcheck: "false" },
			});
			input.value = value;
			input.placeholder = rowIndex === -1 ? `Header ${col + 1}` : "";
			input.style.textAlign = this.data.aligns[col] === "none" ? "" : this.data.aligns[col];

			input.addEventListener("input", () => {
				this.setValue(rowIndex, col, input.value);
				this.autosize(input);
			});
			input.addEventListener("focus", () => {
				this.lastFocused = { row: rowIndex, col };
				this.autosize(input);
			});
			input.addEventListener("blur", () => {
				input.style.height = "";
				this.renderPreview(preview, input.value);
			});
			input.addEventListener("keydown", (evt) => this.onCellKey(evt, rowIndex, col));
			input.addEventListener("paste", (evt) => this.onPaste(evt, rowIndex, col));
		});
	}

	/** A grip button that starts a row/column drag. */
	private handle(parent: HTMLElement, icon: string, label: string, drag: Drag): HTMLButtonElement {
		const btn = parent.createEl("button", { cls: "mts-handle clickable-icon", attr: { "aria-label": label, draggable: "true" } });
		setIcon(btn, icon);
		btn.addEventListener("dragstart", (evt) => {
			this.drag = drag;
			if (!evt.dataTransfer) return;
			evt.dataTransfer.effectAllowed = "move";
			evt.dataTransfer.setData("text/plain", "");
			const ghost = drag.kind === "row" ? btn.closest("tr") : null;
			if (ghost) evt.dataTransfer.setDragImage(ghost, 16, 16);
		});
		btn.addEventListener("dragend", () => {
			this.drag = null;
			this.clearDropMarks();
		});
		return btn;
	}

	// ---- drag & drop --------------------------------------------------------

	/** Insertion index (0..n) under the pointer for the current drag, or null. */
	private dropIndex(evt: DragEvent): number | null {
		if (!this.drag) return null;
		const target = evt.target as HTMLElement;
		if (this.drag.kind === "row") {
			const tr = target.closest<HTMLElement>("tr[data-row]");
			if (!tr) return null;
			const row = Number(tr.dataset.row);
			if (row === -1) return 0;
			const rect = tr.getBoundingClientRect();
			return evt.clientY < rect.top + rect.height / 2 ? row : row + 1;
		}
		const td = target.closest<HTMLElement>("td[data-col]");
		if (!td) return null;
		const col = Number(td.dataset.col);
		const rect = td.getBoundingClientRect();
		return evt.clientX < rect.left + rect.width / 2 ? col : col + 1;
	}

	private onDragOver(evt: DragEvent): void {
		const index = this.dropIndex(evt);
		if (index === null || !this.drag) return;
		evt.preventDefault();
		if (evt.dataTransfer) evt.dataTransfer.dropEffect = "move";
		this.clearDropMarks();

		if (this.drag.kind === "row") {
			const rows = this.gridEl.querySelectorAll<HTMLElement>("tr[data-row]:not(.mts-header)");
			if (index < rows.length) rows[index].addClass("mts-drop-before");
			else rows[rows.length - 1]?.addClass("mts-drop-after");
		} else {
			const atEnd = index >= this.colCount;
			const col = atEnd ? this.colCount - 1 : index;
			this.gridEl
				.querySelectorAll<HTMLElement>(`td[data-col="${col}"]`)
				.forEach((td) => td.addClass(atEnd ? "mts-drop-after" : "mts-drop-before"));
		}
	}

	private onDrop(evt: DragEvent): void {
		const index = this.dropIndex(evt);
		const drag = this.drag;
		this.drag = null;
		this.clearDropMarks();
		if (index === null || !drag) return;
		evt.preventDefault();
		const to = index > drag.from ? index - 1 : index;
		if (to === drag.from) return;
		if (drag.kind === "row") this.moveRow(drag.from, to);
		else this.moveCol(drag.from, to);
	}

	private clearDropMarks(): void {
		this.gridEl
			.querySelectorAll(".mts-drop-before, .mts-drop-after")
			.forEach((el) => el.removeClasses(["mts-drop-before", "mts-drop-after"]));
	}

	/** Show the cell the way Obsidian would render it, using the note's path to resolve links and embeds. */
	private renderPreview(el: HTMLElement, value: string): void {
		el.empty();
		const markdown = value.trim().replace(/\n/g, "<br>");
		if (markdown) void MarkdownRenderer.render(this.app, markdown, el, this.sourcePath, this.renderScope);
	}

	private autosize(el: HTMLTextAreaElement): void {
		el.style.height = "auto";
		el.style.height = `${el.scrollHeight}px`;
	}

	private focusCell({ row, col }: Cell): void {
		const el = this.gridEl.querySelector<HTMLTextAreaElement>(
			`textarea[data-row="${row}"][data-col="${col}"]`,
		);
		if (!el) return;
		el.focus();
		el.setSelectionRange(el.value.length, el.value.length);
	}

	// ---- data helpers -------------------------------------------------------

	private get colCount(): number {
		return this.data.header.length;
	}

	private getRow(row: number): string[] {
		return row === -1 ? this.data.header : this.data.rows[row];
	}

	private setValue(row: number, col: number, value: string): void {
		this.getRow(row)[col] = value;
	}

	private insertRow(at: number, focus = true): void {
		this.data.rows.splice(at, 0, Array(this.colCount).fill(""));
		if (focus) this.focusAfterRender = { row: at, col: Math.min(this.lastFocused.col, this.colCount - 1) };
		this.render();
	}

	private deleteRow(at: number): void {
		this.data.rows.splice(at, 1);
		this.focusAfterRender = { row: Math.min(at, this.data.rows.length - 1), col: this.lastFocused.col };
		this.render();
	}

	private moveRow(from: number, to: number): void {
		if (to < 0 || to >= this.data.rows.length) return;
		const [row] = this.data.rows.splice(from, 1);
		this.data.rows.splice(to, 0, row);
		this.focusAfterRender = { row: to, col: this.lastFocused.col };
		this.render();
	}

	private insertCol(at: number): void {
		this.data.header.splice(at, 0, "");
		this.data.aligns.splice(at, 0, "none");
		this.data.rows.forEach((r) => r.splice(at, 0, ""));
		this.focusAfterRender = { row: -1, col: at };
		this.render();
	}

	private deleteCol(at: number): void {
		if (this.colCount <= 1) return;
		this.data.header.splice(at, 1);
		this.data.aligns.splice(at, 1);
		this.data.rows.forEach((r) => r.splice(at, 1));
		this.focusAfterRender = { row: this.lastFocused.row, col: Math.min(at, this.colCount - 1) };
		this.render();
	}

	private moveCol(from: number, to: number): void {
		if (to < 0 || to >= this.colCount) return;
		const move = <T>(arr: T[]) => arr.splice(to, 0, arr.splice(from, 1)[0]);
		move(this.data.header);
		move(this.data.aligns);
		this.data.rows.forEach(move);
		this.focusAfterRender = { row: this.lastFocused.row, col: to };
		this.render();
	}

	private sortCol(col: number, dir: 1 | -1): void {
		const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
		this.data.rows.sort((a, b) => {
			const x = a[col].trim();
			const y = b[col].trim();
			if (!x !== !y) return x ? -1 : 1; // blanks always last
			return dir * collator.compare(x, y);
		});
		this.render();
	}

	private setAlign(col: number, align: Align): void {
		this.data.aligns[col] = align;
		this.render();
	}

	/** Grow the grid so that (row, col) exists. */
	private ensureSize(row: number, col: number): void {
		while (this.colCount <= col) {
			this.data.header.push("");
			this.data.aligns.push("none");
			this.data.rows.forEach((r) => r.push(""));
		}
		while (this.data.rows.length <= row) this.data.rows.push(Array(this.colCount).fill(""));
	}

	// ---- menus --------------------------------------------------------------

	private columnMenu(col: number, evt: MouseEvent): void {
		const menu = new Menu();
		const align = (title: string, value: Align) =>
			menu.addItem((i) =>
				i
					.setTitle(title)
					.setIcon(ALIGN_ICONS[value])
					.setChecked(this.data.aligns[col] === value)
					.onClick(() => this.setAlign(col, value)),
			);
		align("Align left", "left");
		align("Align center", "center");
		align("Align right", "right");
		align("No alignment", "none");
		menu.addSeparator();
		menu.addItem((i) => i.setTitle("Sort A → Z").setIcon("arrow-down-a-z").onClick(() => this.sortCol(col, 1)));
		menu.addItem((i) => i.setTitle("Sort Z → A").setIcon("arrow-up-z-a").onClick(() => this.sortCol(col, -1)));
		menu.addSeparator();
		menu.addItem((i) => i.setTitle("Insert column left").setIcon("arrow-left-to-line").onClick(() => this.insertCol(col)));
		menu.addItem((i) => i.setTitle("Insert column right").setIcon("arrow-right-to-line").onClick(() => this.insertCol(col + 1)));
		if (col > 0) menu.addItem((i) => i.setTitle("Move left").setIcon("chevron-left").onClick(() => this.moveCol(col, col - 1)));
		if (col < this.colCount - 1)
			menu.addItem((i) => i.setTitle("Move right").setIcon("chevron-right").onClick(() => this.moveCol(col, col + 1)));
		if (this.colCount > 1) {
			menu.addSeparator();
			menu.addItem((i) => i.setTitle("Delete column").setIcon("trash-2").setWarning(true).onClick(() => this.deleteCol(col)));
		}
		menu.showAtMouseEvent(evt);
	}

	private rowMenu(row: number, evt: MouseEvent): void {
		const menu = new Menu();
		if (row >= 0) {
			menu.addItem((i) => i.setTitle("Insert row above").setIcon("arrow-up-to-line").onClick(() => this.insertRow(row)));
		}
		menu.addItem((i) => i.setTitle("Insert row below").setIcon("arrow-down-to-line").onClick(() => this.insertRow(row + 1)));
		if (row > 0) menu.addItem((i) => i.setTitle("Move up").setIcon("chevron-up").onClick(() => this.moveRow(row, row - 1)));
		if (row >= 0 && row < this.data.rows.length - 1)
			menu.addItem((i) => i.setTitle("Move down").setIcon("chevron-down").onClick(() => this.moveRow(row, row + 1)));
		if (row >= 0) {
			menu.addSeparator();
			menu.addItem((i) => i.setTitle("Delete row").setIcon("trash-2").setWarning(true).onClick(() => this.deleteRow(row)));
		}
		menu.showAtMouseEvent(evt);
	}

	// ---- keyboard & clipboard ----------------------------------------------

	private onCellKey(evt: KeyboardEvent, row: number, col: number): void {
		if (evt.isComposing) return;
		if (evt.key === "Enter" && !evt.shiftKey && !evt.metaKey && !evt.ctrlKey && !evt.altKey) {
			evt.preventDefault();
			if (row + 1 >= this.data.rows.length) this.insertRow(this.data.rows.length, false);
			this.focusCell({ row: row + 1, col });
			return;
		}
		if (evt.altKey && (evt.key === "ArrowUp" || evt.key === "ArrowDown")) {
			evt.preventDefault();
			const next = row + (evt.key === "ArrowUp" ? -1 : 1);
			if (next >= -1 && next < this.data.rows.length) this.focusCell({ row: next, col });
		}
	}

	private onPaste(evt: ClipboardEvent, row: number, col: number): void {
		const text = evt.clipboardData?.getData("text/plain") ?? "";
		let grid: string[][] | null = null;

		const md = text.includes("|") ? parseTableText(text) : null;
		if (md) {
			grid = [md.header, ...md.rows];
		} else if (text.includes("\t")) {
			grid = parseTsv(text);
		}
		if (!grid) return; // plain text: let the textarea handle it

		evt.preventDefault();
		const width = Math.max(...grid.map((r) => r.length));
		this.ensureSize(row + grid.length - 1, col + width - 1);
		grid.forEach((cells, dr) => cells.forEach((value, dc) => this.setValue(row + dr, col + dc, value)));
		if (md && row === -1) {
			md.aligns.forEach((a, i) => (this.data.aligns[col + i] = a));
		}
		this.focusAfterRender = { row, col };
		this.render();
	}
}
