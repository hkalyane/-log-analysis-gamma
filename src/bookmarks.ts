import * as vscode from 'vscode';
import * as path from 'path';
import type { FocusProvider } from './focusProvider';

export const defaultBookmarkColor = '#3794ff';
export type LogBookmark = { id: string; uri: string; line: number; text: string; note: string; color: string };

export function normalizeBookmarkColor(color: string): string | undefined {
    if (!/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(color)) {
        return undefined;
    }
    return (color.length === 4 ? '#' + color.slice(1).split('').map(character => character + character).join('') : color).toLowerCase();
}

export function bookmarkIcon(color: string): vscode.Uri {
    const fill = normalizeBookmarkColor(color) || defaultBookmarkColor;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><path fill="${fill}" stroke="${fill}" stroke-linejoin="round" d="M4 2h8v12l-4-3-4 3z"/></svg>`;
    return vscode.Uri.parse('data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'));
}

export function originalBookmarkLocation(editor: vscode.TextEditor, focus: FocusProvider): { uri: vscode.Uri; line: number } | undefined {
    if (editor.document.uri.scheme !== 'focus-gamma') {
        return { uri: editor.document.uri, line: editor.selection.active.line };
    }
    if (editor.selection.active.line === 0) {
        return undefined;
    }
    const line = focus.getOriginalLineNumber(editor.document.uri.toString(), editor.selection.active.line);
    return line === undefined ? undefined : { uri: focus.getOriginalUri(editor.document.uri), line };
}

export function findBookmarkLine(bookmark: LogBookmark, lines: string[]): number | undefined {
    if (lines[bookmark.line] === bookmark.text) {
        return bookmark.line;
    }
    let found: number | undefined;
    for (let index = 0; index < lines.length; index++) {
        if (lines[index] === bookmark.text) {
            if (found !== undefined) { return undefined; }
            found = index;
        }
    }
    return found;
}

export class BookmarkItem extends vscode.TreeItem {
    constructor(readonly bookmark: LogBookmark) {
        super(bookmark.note || bookmark.text.slice(0, 80) || 'Blank line', vscode.TreeItemCollapsibleState.None);
        this.id = bookmark.id;
        this.description = `${path.basename(vscode.Uri.parse(bookmark.uri).path)}:${bookmark.line + 1}`;
        this.tooltip = `${bookmark.uri}:${bookmark.line + 1}\n${bookmark.note}\n${bookmark.text}`;
        this.iconPath = bookmarkIcon(bookmark.color);
        this.contextValue = 'logBookmark';
        this.command = { command: 'log-analysis-gamma.openBookmark', title: 'Open Bookmark', arguments: [this] };
    }
}

export class BookmarkManager implements vscode.TreeDataProvider<BookmarkItem>, vscode.Disposable {
    private entries: LogBookmark[];
    private emitter = new vscode.EventEmitter<void>();
    private decorations = new Map<string, vscode.TextEditorDecorationType>();
    private subscriptions: vscode.Disposable[] = [];
    private renderGeneration = 0;
    private disposed = false;
    readonly onDidChangeTreeData = this.emitter.event;
    constructor(private storage: vscode.Memento) {
        this.entries = storage.get<LogBookmark[]>('logInvestigationBookmarks', []).filter(entry => typeof entry.uri === 'string'
            && typeof entry.text === 'string' && typeof entry.note === 'string' && Number.isInteger(entry.line) && entry.line >= 0)
            .map(entry => ({ ...entry, color: typeof entry.color === 'string' ? normalizeBookmarkColor(entry.color) || defaultBookmarkColor : defaultBookmarkColor }));
    }
    getTreeItem(item: BookmarkItem): vscode.TreeItem { return item; }
    getChildren(item?: BookmarkItem): BookmarkItem[] { return item ? [] : this.entries.map(entry => new BookmarkItem(entry)); }

    private async persist(): Promise<void> {
        await this.storage.update('logInvestigationBookmarks', this.entries.map(entry => ({ ...entry })));
        this.emitter.fire();
    }

    async add(uri: vscode.Uri, line: number, text: string, note: string): Promise<LogBookmark> {
        const existing = this.entries.find(entry => entry.uri === uri.toString() && entry.line === line);
        const entry = { id: existing?.id || `${Date.now()}-${Math.random()}`, uri: uri.toString(), line, text, note, color: existing?.color || defaultBookmarkColor };
        if (existing) {
            this.entries.splice(this.entries.indexOf(existing), 1, entry);
        } else {
            this.entries.push(entry);
        }
        await this.persist();
        return entry;
    }

    async remove(id: string): Promise<void> {
        this.entries = this.entries.filter(entry => entry.id !== id);
        await this.persist();
    }

    async setColor(id: string, color: string): Promise<void> {
        const normalized = normalizeBookmarkColor(color);
        if (!normalized) { throw new Error('Use a hex color such as #3794ff or #38f'); }
        const entry = this.entries.find(candidate => candidate.id === id);
        if (!entry || entry.color === normalized) { return; }
        entry.color = normalized;
        await this.persist();
    }

    async changeColor(item: BookmarkItem): Promise<void> {
        const entry = this.entries.find(candidate => candidate.id === item.bookmark.id);
        if (!entry) { return; }
        const colors = [
            { label: 'Blue', color: defaultBookmarkColor },
            { label: 'Red', color: '#e74c3c' },
            { label: 'Green', color: '#2ecc71' },
            { label: 'Yellow', color: '#f1c40f' },
            { label: 'Orange', color: '#e67e22' },
            { label: 'Purple', color: '#9b59b6' }
        ];
        const options = colors.map(choice => ({
            ...choice, description: choice.color,
            detail: entry.color === choice.color ? 'Current color' : undefined,
            iconPath: bookmarkIcon(choice.color)
        }));
        const custom = { label: 'Custom Hex Color...', color: '', description: entry.color,
            detail: undefined, iconPath: bookmarkIcon(entry.color) };
        const choice = await vscode.window.showQuickPick([...options, custom], {
            title: 'Bookmark Color', ignoreFocusOut: true
        });
        if (!choice) { return; }
        const color = choice.color || await vscode.window.showInputBox({
            title: 'Bookmark Color', value: entry.color, ignoreFocusOut: true,
            validateInput: value => normalizeBookmarkColor(value) ? undefined : 'Enter a hex color such as #3794ff or #38f'
        });
        if (color !== undefined) { await this.setColor(entry.id, color); }
    }

    async getDecorations(document: vscode.TextDocument, focus?: FocusProvider): Promise<Map<string, vscode.DecorationOptions[]>> {
        const result = new Map<string, vscode.DecorationOptions[]>();
        const isFocus = document.uri.scheme === 'focus-gamma';
        if (isFocus && !focus) { return result; }
        const originalUri = isFocus ? focus!.getOriginalUri(document.uri) : document.uri;
        const entries = this.entries.filter(entry => entry.uri === originalUri.toString());
        if (!entries.length) { return result; }
        const source = isFocus ? await vscode.workspace.openTextDocument(originalUri) : document;
        const lines = source.getText().split(/\r?\n/);
        const mappedLines = new Map<number, number[]>();
        if (isFocus) {
            const lineMap = focus!.documentLineMap.get(originalUri.fsPath) || [];
            for (let index = 1; index < Math.min(lineMap.length, document.lineCount); index++) {
                const mapped = mappedLines.get(lineMap[index]) || [];
                mapped.push(index);
                mappedLines.set(lineMap[index], mapped);
            }
        }
        for (const entry of entries) {
            const sourceLine = findBookmarkLine(entry, lines);
            if (sourceLine === undefined) { continue; }
            const editorLines = isFocus ? mappedLines.get(sourceLine) || [] : [sourceLine];
            for (const line of editorLines) {
                if (line >= document.lineCount) { continue; }
                if (isFocus && (focus!.getOriginalLineNumber(document.uri.toString(), line) !== sourceLine
                    || document.lineAt(line).text !== entry.text)) { continue; }
                const hover = new vscode.MarkdownString();
                hover.appendText(entry.note || 'Bookmark');
                hover.appendMarkdown('\n\n');
                hover.appendText(`${path.basename(originalUri.path)}:${sourceLine + 1}`);
                hover.isTrusted = false;
                const options = result.get(entry.color) || [];
                options.push({ range: new vscode.Range(line, 0, line, document.lineAt(line).text.length), hoverMessage: hover });
                result.set(entry.color, options);
            }
        }
        return result;
    }

    attachDecorations(focus: FocusProvider): void {
        if (this.subscriptions.length || this.disposed) { return; }
        const refresh = () => { void this.refreshDecorations(focus); };
        this.subscriptions.push(
            this.onDidChangeTreeData(refresh),
            vscode.window.onDidChangeVisibleTextEditors(refresh),
            vscode.workspace.onDidChangeTextDocument(refresh),
            focus.onDidUpdateLineMap(refresh)
        );
        refresh();
    }

    async refreshDecorations(focus: FocusProvider, editors: readonly vscode.TextEditor[] = vscode.window.visibleTextEditors): Promise<void> {
        if (this.disposed) { return; }
        const generation = ++this.renderGeneration;
        const activeColors = new Set(this.entries.map(entry => entry.color));
        for (const [color, decoration] of this.decorations) {
            if (!activeColors.has(color)) {
                decoration.dispose();
                this.decorations.delete(color);
            }
        }
        await Promise.all(editors.map(async editor => {
            const version = editor.document.version;
            let options: Map<string, vscode.DecorationOptions[]>;
            try {
                options = await this.getDecorations(editor.document, focus);
            } catch {
                options = new Map();
            }
            if (this.disposed || generation !== this.renderGeneration || editor.document.isClosed || editor.document.version !== version) { return; }
            for (const color of options.keys()) {
                if (!this.decorations.has(color)) {
                    this.decorations.set(color, vscode.window.createTextEditorDecorationType({
                        gutterIconPath: bookmarkIcon(color), gutterIconSize: 'contain',
                        isWholeLine: true, rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
                    }));
                }
            }
            for (const [color, decoration] of this.decorations) {
                editor.setDecorations(decoration, options.get(color) || []);
            }
        }));
    }

    async editNote(item: BookmarkItem): Promise<void> {
        const entry = this.entries.find(candidate => candidate.id === item.bookmark.id);
        if (!entry) { return; }
        const note = await vscode.window.showInputBox({ title: 'Bookmark Note', value: entry.note, ignoreFocusOut: true });
        if (note === undefined) { return; }
        entry.note = note;
        await this.persist();
    }

    async addFromEditor(focus: FocusProvider): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        const location = editor && originalBookmarkLocation(editor, focus);
        if (!location) { return; }
        const document = await vscode.workspace.openTextDocument(location.uri);
        if (location.line >= document.lineCount) { return; }
        const text = document.lineAt(location.line).text;
        const note = await vscode.window.showInputBox({ title: 'Bookmark Note', prompt: text.slice(0, 120), ignoreFocusOut: true });
        if (note === undefined) { return; }
        await this.add(location.uri, location.line, text, note);
    }

    async open(item: BookmarkItem): Promise<void> {
        try {
            const entry = this.entries.find(candidate => candidate.id === item.bookmark.id);
            if (!entry) { return; }
            const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(entry.uri));
            const line = findBookmarkLine(entry, document.getText().split(/\r?\n/));
            if (line === undefined) {
                vscode.window.showWarningMessage('Bookmarked text changed or is ambiguous. Open the log and recreate this bookmark.');
                return;
            }
            entry.line = line;
            await this.persist();
            const editor = await vscode.window.showTextDocument(document, { preview: false });
            editor.selection = new vscode.Selection(line, 0, line, 0);
            editor.revealRange(new vscode.Range(line, 0, line, 0), vscode.TextEditorRevealType.InCenter);
        } catch (error) {
            vscode.window.showErrorMessage(`Could not open bookmark: ${error}`);
        }
    }

    async navigate(direction: 1 | -1, focus: FocusProvider): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        const location = editor && originalBookmarkLocation(editor, focus);
        const entries = this.entries.filter(entry => !location || entry.uri === location.uri.toString())
            .sort((left, right) => left.line - right.line);
        if (!entries.length) { vscode.window.showInformationMessage('No bookmarks in this log'); return; }
        const current = location?.line ?? (direction === 1 ? -1 : Number.MAX_SAFE_INTEGER);
        const entry = direction === 1 ? entries.find(candidate => candidate.line > current) || entries[0]
            : entries.slice().reverse().find(candidate => candidate.line < current) || entries[entries.length - 1];
        await this.open(new BookmarkItem(entry));
    }

    dispose(): void {
        this.disposed = true;
        this.renderGeneration++;
        this.subscriptions.forEach(subscription => subscription.dispose());
        this.decorations.forEach(decoration => decoration.dispose());
        this.decorations.clear();
        this.emitter.dispose();
    }
}