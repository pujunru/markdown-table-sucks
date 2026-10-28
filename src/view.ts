import { ItemView, WorkspaceLeaf } from "obsidian";
import { EditorSession, TableEditor } from "./editor";

export const VIEW_TYPE_TABLE_EDITOR = "markdown-table-sucks-editor";

/** Hosts the table editor in a workspace leaf, typically inside a pop-out window. */
export class TableEditorView extends ItemView {
	private editor: TableEditor | null = null;
	private title = "Edit table";

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_TABLE_EDITOR;
	}

	getDisplayText(): string {
		return this.title;
	}

	getIcon(): string {
		return "table";
	}

	async onOpen(): Promise<void> {
		// Restored after a restart with no session to edit: nothing to show.
		if (!this.editor) window.setTimeout(() => !this.editor && this.leaf.detach(), 0);
	}

	setSession(session: EditorSession): void {
		this.editor?.destroy();
		this.title = `${session.isNew ? "Insert" : "Edit"} table · ${session.sourcePath.split("/").pop()?.replace(/\.md$/, "") ?? ""}`;
		const container = this.contentEl;
		container.empty();
		container.addClass("mts-view");
		this.editor = new TableEditor(this.app, container, session, { close: () => this.leaf.detach() });
		this.editor.mount();
		(this.leaf as WorkspaceLeaf & { updateHeader?: () => void }).updateHeader?.();
	}

	async onClose(): Promise<void> {
		this.editor?.destroy();
		this.editor = null;
	}
}
