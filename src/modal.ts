import { App, Modal } from "obsidian";
import { EditorHost, EditorSession, TableEditor } from "./editor";

export class TableEditorModal extends Modal {
	private editor: TableEditor | null = null;

	constructor(
		app: App,
		private readonly session: EditorSession,
		private readonly popOut?: (session: EditorSession) => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.modalEl.addClass("mts-modal");
		this.titleEl.setText(this.session.isNew ? "Insert table" : "Edit table");
		const host: EditorHost = { close: () => this.close() };
		if (this.popOut) {
			const popOut = this.popOut;
			host.popOut = (session) => {
				this.close();
				popOut(session);
			};
		}
		this.editor = new TableEditor(this.app, this.contentEl, this.session, host);
		this.editor.mount();
	}

	onClose(): void {
		this.editor?.destroy();
		this.editor = null;
	}
}
