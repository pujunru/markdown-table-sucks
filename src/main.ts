import {
	App,
	Editor,
	MarkdownFileInfo,
	MarkdownView,
	Menu,
	Notice,
	Platform,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
} from "obsidian";
import { EditorSession } from "./editor";
import { TableEditorModal } from "./modal";
import { TableData, emptyTable, findNearest, findTableAt, lineChToOffset, planInsert, serializeTable } from "./table";
import { TableEditorView, VIEW_TYPE_TABLE_EDITOR } from "./view";

type OpenIn = "modal" | "window";

interface Settings {
	defaultColumns: number;
	defaultRows: number;
	padColumns: boolean;
	openIn: OpenIn;
}

const DEFAULT_SETTINGS: Settings = {
	defaultColumns: 3,
	defaultRows: 2,
	padColumns: true,
	openIn: "modal",
};

export default class MarkdownTableSucks extends Plugin {
	settings: Settings = DEFAULT_SETTINGS;

	async onload(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

		this.registerView(VIEW_TYPE_TABLE_EDITOR, (leaf) => new TableEditorView(leaf));

		this.addCommand({
			id: "insert-or-edit-table",
			name: "Insert or edit table",
			icon: "table",
			editorCallback: (editor, ctx) => this.openEditor(editor, ctx, this.settings.openIn),
		});

		if (Platform.isDesktopApp) {
			this.addCommand({
				id: "insert-or-edit-table-in-window",
				name: "Insert or edit table in a pop-out window",
				icon: "picture-in-picture-2",
				editorCallback: (editor, ctx) => this.openEditor(editor, ctx, "window"),
			});
		}

		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu: Menu, editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => {
				const title = this.tableAtCursor(editor) ? "Edit table" : "Insert table";
				menu.addItem((item) =>
					item
						.setTitle(title)
						.setIcon("table")
						.setSection("insert")
						.onClick(() => this.openEditor(editor, ctx, this.settings.openIn)),
				);
				if (Platform.isDesktopApp && this.settings.openIn === "modal") {
					menu.addItem((item) =>
						item
							.setTitle(`${title} in new window`)
							.setIcon("picture-in-picture-2")
							.setSection("insert")
							.onClick(() => this.openEditor(editor, ctx, "window")),
					);
				}
			}),
		);

		this.addSettingTab(new SettingsTab(this.app, this));
	}

	onunload(): void {
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_TABLE_EDITOR);
	}

	private tableAtCursor(editor: Editor) {
		return findTableAt((n) => editor.getLine(n), editor.lineCount(), editor.getCursor().line);
	}

	openEditor(editor: Editor, ctx: MarkdownView | MarkdownFileInfo, openIn: OpenIn): void {
		const session = this.createSession(editor, ctx.file);
		if (openIn === "window" && Platform.isDesktopApp) {
			void this.popOut(session);
		} else {
			new TableEditorModal(this.app, session, Platform.isDesktopApp ? (s) => void this.popOut(s) : undefined).open();
		}
	}

	private async popOut(session: EditorSession): Promise<void> {
		const leaf = this.app.workspace.openPopoutLeaf({ size: { width: 960, height: 640 } });
		await leaf.setViewState({ type: VIEW_TYPE_TABLE_EDITOR, active: true });
		if (leaf.view instanceof TableEditorView) leaf.view.setSession(session);
	}

	/**
	 * Capture what is being edited. Saving re-locates the table by its original text, so it still lands
	 * in the right place if the note was edited while a pop-out window was open.
	 */
	private createSession(editor: Editor, file: TFile | null): EditorSession {
		const sourcePath = file?.path ?? "";
		const pad = () => this.settings.padColumns;
		const found = this.tableAtCursor(editor);

		if (found) {
			const from = { line: found.startLine, ch: 0 };
			const to = { line: found.endLine, ch: editor.getLine(found.endLine).length };
			const original = editor.getRange(from, to);
			const near = editor.posToOffset(from);
			return {
				table: found.table,
				isNew: false,
				sourcePath,
				commit: (table) => {
					const text = serializeTable(table, { prefix: found.prefix, pad: pad() });
					this.applyToNote(editor, file, text, (content) => {
						const at = findNearest(content, original, near);
						return at === -1 ? null : { start: at, end: at + original.length, text, cursor: text.length };
					});
				},
			};
		}

		const lineNo = editor.getCursor().line;
		return {
			table: emptyTable(this.settings.defaultColumns, this.settings.defaultRows),
			isNew: true,
			sourcePath,
			commit: (table: TableData) => {
				const fallback = serializeTable(table, { pad: pad() });
				this.applyToNote(editor, file, fallback, (content) => {
					const lines = content.split("\n");
					const plan = planInsert(lines, lineNo, table, { pad: pad() });
					const start = lineChToOffset(lines, plan.from);
					return { start, end: lineChToOffset(lines, plan.to), text: plan.text, cursor: plan.cursor };
				});
			},
		};
	}

	/** Apply an edit through the open editor for the note if there is one, otherwise to the file on disk. */
	private applyToNote(
		fallbackEditor: Editor,
		file: TFile | null,
		markdown: string,
		plan: (content: string) => { start: number; end: number; text: string; cursor: number } | null,
	): void {
		const editor = this.liveEditor(file) ?? (file ? null : fallbackEditor);
		if (editor) {
			const edit = plan(editor.getValue());
			if (!edit) return this.giveUp(markdown);
			editor.replaceRange(edit.text, editor.offsetToPos(edit.start), editor.offsetToPos(edit.end));
			editor.setCursor(editor.offsetToPos(edit.start + edit.cursor));
			return;
		}
		if (!file) return this.giveUp(markdown);
		let failed = false;
		void this.app.vault
			.process(file, (content) => {
				const edit = plan(content);
				if (!edit) {
					failed = true;
					return content;
				}
				return content.slice(0, edit.start) + edit.text + content.slice(edit.end);
			})
			.then(() => failed && this.giveUp(markdown));
	}

	private liveEditor(file: TFile | null): Editor | null {
		if (!file) return null;
		const leaf = this.app.workspace
			.getLeavesOfType("markdown")
			.find((l) => l.view instanceof MarkdownView && l.view.file?.path === file.path);
		return leaf?.view instanceof MarkdownView ? leaf.view.editor : null;
	}

	private giveUp(markdown: string): void {
		void navigator.clipboard.writeText(markdown);
		new Notice("The original table changed in the note, so it wasn't overwritten. The edited table was copied to your clipboard.", 8000);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}

class SettingsTab extends PluginSettingTab {
	constructor(app: App, private readonly plugin: MarkdownTableSucks) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		const numberSetting = (name: string, desc: string, key: "defaultColumns" | "defaultRows", min: number) =>
			new Setting(containerEl)
				.setName(name)
				.setDesc(desc)
				.addText((text) => {
					text.inputEl.type = "number";
					text.inputEl.min = String(min);
					text.setValue(String(this.plugin.settings[key])).onChange(async (value) => {
						const n = parseInt(value, 10);
						if (Number.isFinite(n) && n >= min) {
							this.plugin.settings[key] = n;
							await this.plugin.saveSettings();
						}
					});
				});

		numberSetting("Default columns", "Columns in a newly inserted table.", "defaultColumns", 1);
		numberSetting("Default rows", "Body rows (not counting the header) in a newly inserted table.", "defaultRows", 0);

		if (Platform.isDesktopApp) {
			new Setting(containerEl)
				.setName("Open editor in")
				.setDesc("Where Insert/Edit table opens. You can always switch with the Pop out button or the window command.")
				.addDropdown((dropdown) =>
					dropdown
						.addOption("modal", "Dialog")
						.addOption("window", "Pop-out window")
						.setValue(this.plugin.settings.openIn)
						.onChange(async (value) => {
							this.plugin.settings.openIn = value as OpenIn;
							await this.plugin.saveSettings();
						}),
				);
		}

		new Setting(containerEl)
			.setName("Pad columns")
			.setDesc("Align the pipes in the Markdown source so the table is readable as plain text. CJK and emoji count as double width.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.padColumns).onChange(async (value) => {
					this.plugin.settings.padColumns = value;
					await this.plugin.saveSettings();
				}),
			);
	}
}
