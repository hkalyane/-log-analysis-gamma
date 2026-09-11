import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FocusProvider } from '../../focusProvider';
import { deserializeFilter, deserializeProject, getSettingFile } from '../../settings';
import { clearTimeRange, configureTimeRange, exportFocused, filterFromSelection, formatFocusedResult, literalPattern } from '../../investigationCommands';
import type { State } from '../../extension';
import { BookmarkManager, defaultBookmarkColor, findBookmarkLine, normalizeBookmarkColor, originalBookmarkLocation } from '../../bookmarks';
import { DocumentCache } from '../../documentCache';
import { cyclePattern, evaluateTimeRange, isoPattern, normalizeTime, TimeProfile, uvmPattern, validateTimeProfile } from '../../timeFilter';
import { processFocus } from '../../logProcessor';
import { ProcessingController } from '../../processing';
import { ProjectSettingsManager } from '../../projectSettingsManager';
import { FilterTreeViewProvider } from '../../filterTreeViewProvider';
import { ExFilterTreeViewProvider } from '../../exFilterTreeViewProvider';
import { ProjectTreeViewProvider } from '../../projectTreeViewProvider';
import { Filter, Group, Project } from '../../utils';

suite('Log investigation', function () {
    this.timeout(15000);
    const keys = ['contextBefore', 'contextAfter', 'timeProfiles', 'processingTimeoutMs'];
    let originalSettings: unknown[];
    let storagePath: string;
    let state: State;
    let manager: ProjectSettingsManager;

    setup(async () => {
        const config = vscode.workspace.getConfiguration('logAnalysisGamma');
        originalSettings = keys.map(key => config.inspect(key)?.globalValue);
        storagePath = fs.mkdtempSync(path.join(os.tmpdir(), 'investigation-'));
        const projects: Project[] = [];
        const groups: Group[] = [];
        const exFilters: Filter[] = [];
        const memory = new Map<string, unknown>();
        manager = new ProjectSettingsManager({ globalState: {
            get: (key: string) => memory.get(key), update: async (key: string, value: unknown) => { memory.set(key, value); }
        } } as unknown as vscode.ExtensionContext);
        state = {
            projects, groups, exFilters, inFocusMode: false, decorations: [], disposableFoldingRange: null,
            globalStorageUri: vscode.Uri.file(storagePath), noUnderlineDecorationType: vscode.window.createTextEditorDecorationType({}),
            focusProvider: new FocusProvider(groups, exFilters), filterTreeViewProvider: new FilterTreeViewProvider(groups),
            exFilterTreeViewProvider: new ExFilterTreeViewProvider(exFilters), projectTreeViewProvider: new ProjectTreeViewProvider(projects)
        };
        await manager.initializeFiles(state);
    });

    teardown(async () => {
        for (const [index, key] of keys.entries()) {
            await vscode.workspace.getConfiguration('logAnalysisGamma').update(key, originalSettings[index], vscode.ConfigurationTarget.Global);
        }
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        state.decorations.forEach(decoration => decoration.dispose());
        state.noUnderlineDecorationType.dispose();
        fs.rmdirSync(storagePath, { recursive: true });
    });

    test('context merges overlapping matches, respects exclusions, and preserves source lines', async () => {
        const config = vscode.workspace.getConfiguration('logAnalysisGamma');
        await config.update('contextBefore', 1, vscode.ConfigurationTarget.Global);
        await config.update('contextAfter', 1, vscode.ConfigurationTarget.Global);
        const document = await vscode.workspace.openTextDocument({ content: 'before\nERROR one\nERROR two\nNOISE\nafter' });
        const project = deserializeProject({ name: 'test', groups: [{ name: 'errors', filters: [
            { regex: 'ERROR', flags: 'g', color: 'red', isShown: true }
        ] }] });
        const provider = new FocusProvider(project.groups, [deserializeFilter({ regex: 'NOISE', color: 'red', isShown: true })]);
        const uri = vscode.Uri.parse('focus-gamma:' + document.uri.toString());
        assert.strictEqual(await provider.provideTextDocumentContent(uri), '\nbefore\nERROR one\nERROR two');
        assert.deepStrictEqual(provider.documentLineMap.get(document.uri.fsPath), [0, 0, 1, 2]);
        project.groups[0].filters[0].isShown = false;
        assert.strictEqual(await provider.provideTextDocumentContent(uri), '');
        assert.deepStrictEqual(provider.documentLineMap.get(document.uri.fsPath), [0]);
    });

    test('literal selection escaping preserves regex metacharacters', () => {
        const text = '[uvm] a.b(1)+$?\\path';
        const regex = new RegExp(literalPattern(text));
        assert.ok(regex.test(`prefix ${text} suffix`));
        assert.strictEqual(regex.test('[uvm] axb1'), false);
    });

    test('selection commands create literal filters in their source and cancel ambiguous destinations safely', async () => {
        const document = await vscode.workspace.openTextDocument({ content: 'reg[0].value+$' });
        const editor = await vscode.window.showTextDocument(document);
        editor.selection = new vscode.Selection(0, 0, 0, document.lineAt(0).text.length);
        await filterFromSelection(state, false);
        assert.strictEqual(state.groups[0].name, 'Selections');
        assert.ok(state.groups[0].filters[0].regex.test(document.getText()));
        assert.strictEqual(state.groups[0].filters[0].sourcePath, getSettingFile(state.globalStorageUri));
        await filterFromSelection(state, true);
        assert.strictEqual(state.exFilters.length, 1);
        assert.ok(state.exFilters[0].regex.test(document.getText()));
        state.filterHistory!.undo(state);
        assert.strictEqual(state.exFilters.length, 0);
        await manager.createFile(path.join(storagePath, 'external.json'), state);
        const originalPicker = vscode.window.showQuickPick;
        vscode.window.showQuickPick = (async () => undefined) as typeof vscode.window.showQuickPick;
        try {
            await filterFromSelection(state, true);
            assert.strictEqual(state.exFilters.length, 0);
        } finally { vscode.window.showQuickPick = originalPicker; }
        editor.selection = new vscode.Selection(0, 0, 0, 0);
        await filterFromSelection(state, false);
        assert.strictEqual(state.groups[0].filters.length, 1);
    });

    test('export command writes numbered results but never overwrites the original source', async () => {
        const sourcePath = path.join(storagePath, 'source.log');
        const content = 'ignore\nERROR a\nignore\nERROR b';
        fs.writeFileSync(sourcePath, content);
        const document = await vscode.workspace.openTextDocument(vscode.Uri.file(sourcePath));
        await vscode.window.showTextDocument(document);
        const project = manager.selectedProject(getSettingFile(state.globalStorageUri), state);
        project.groups.push(deserializeProject({ name: 'test', groups: [{ name: 'errors', filters: [{ regex: 'ERROR', color: 'red', isShown: true }] }] }).groups[0]);
        manager.updateState(state);
        const originalPicker = vscode.window.showQuickPick;
        const originalDialog = vscode.window.showSaveDialog;
        const destination = vscode.Uri.file(path.join(storagePath, 'focused.txt'));
        let chosen: vscode.Uri | undefined;
        vscode.window.showQuickPick = (async () => 'Original Line Numbers') as unknown as typeof vscode.window.showQuickPick;
        vscode.window.showSaveDialog = async () => chosen;
        try {
            await exportFocused(state, false);
            assert.strictEqual(fs.existsSync(destination.fsPath), false);
            chosen = document.uri;
            await exportFocused(state, false);
            assert.strictEqual(fs.readFileSync(sourcePath, 'utf8'), content);
            chosen = destination;
            await exportFocused(state, false);
            assert.strictEqual(fs.readFileSync(destination.fsPath, 'utf8'), '2\tERROR a\n4\tERROR b');
        } finally {
            vscode.window.showQuickPick = originalPicker;
            vscode.window.showSaveDialog = originalDialog;
        }
    });

    test('time and context profiles persist in both storage types without filter-only saves replacing settings', async () => {
        const external = path.join(storagePath, 'team.json');
        await manager.createFile(external, state);
        const logUri = vscode.Uri.file(path.join(storagePath, 'cycles.log'));
        const profile: TimeProfile = { kind: 'cycles', pattern: cyclePattern, start: '65689', end: '65690', untimed: 'inherit' };
        const config = vscode.workspace.getConfiguration('logAnalysisGamma');
        await config.update('timeProfiles', { [logUri.toString()]: profile }, vscode.ConfigurationTarget.Global);
        await config.update('contextAfter', 2, vscode.ConfigurationTarget.Global);
        for (const destination of [getSettingFile(state.globalStorageUri), external]) {
            assert.strictEqual(await manager.saveFile(destination, state, 'settings'), true);
            const settings = JSON.parse(fs.readFileSync(destination, 'utf8'));
            assert.deepStrictEqual(settings.timeProfiles[logUri.toString()], profile);
            assert.strictEqual(settings.contextAfter, 2);
        }
        await config.update('timeProfiles', {}, vscode.ConfigurationTarget.Global);
        assert.strictEqual(await manager.saveFile(external, state, 'filterData'), true);
        assert.strictEqual(await manager.applyFileConfiguration(external), true);
        assert.strictEqual(vscode.workspace.getConfiguration('logAnalysisGamma').get<Record<string, TimeProfile>>('timeProfiles', {})[logUri.toString()].start, '65689');
        const restored = new ProjectSettingsManager({ globalState: { get: () => undefined, update: async () => undefined } } as unknown as vscode.ExtensionContext);
        await restored.initializeFiles(state);
        assert.strictEqual(vscode.workspace.getConfiguration('logAnalysisGamma').get<Record<string, TimeProfile>>('timeProfiles', {})[logUri.toString()].kind, 'cycles');
    });

    test('export removes the focus header and numbers original lines including blank context', () => {
        assert.strictEqual(formatFocusedResult('\nfirst\n\nlast', [0, 3, 4, 9], true), '4\tfirst\n5\t\n10\tlast');
        assert.strictEqual(formatFocusedResult('\nfirst\nlast', [0, 3, 9], false), 'first\nlast');
        assert.strictEqual(formatFocusedResult('', [0], true), '');
        assert.throws(() => formatFocusedResult('\ntext', [0], true), /out of sync/);
    });

    test('cycle profile extracts DmacRunSeq counts without confusing hexadecimal register data', () => {
        const profile: TimeProfile = { kind: 'cycles', pattern: cyclePattern, start: '65689', end: '65690', untimed: 'exclude' };
        const result = evaluateTimeRange([
            '[DmacRunSeq          ]|(cycle:65689  )| Writing to SYSDMASRCADDRLO=01080012',
            '[DmacRunSeq]|(cycle:65690)| Writing register',
            '[DmacRunSeq]|(cycle:65691)| Writing register',
            'address=65689 without a cycle'
        ], profile);
        assert.deepStrictEqual(result.allowed, [true, true, false, false]);
        assert.strictEqual(result.summary.first, '65689 cycles');
        assert.throws(() => normalizeTime('65689 ns', profile), /whole counts/);
        assert.throws(() => normalizeTime('65689.5', profile), /whole counts/);
    });

    test('cycle comparisons retain exact integers beyond JavaScript safe integer limits', () => {
        const profile: TimeProfile = { kind: 'cycles', pattern: cyclePattern, start: '9007199254740993', end: '9007199254740993', untimed: 'exclude' };
        assert.deepStrictEqual(evaluateTimeRange(['(cycle:9007199254740992)', '(cycle:9007199254740993)', '(cycle:9007199254740994)'], profile).allowed, [false, true, false]);
    });

    test('UVM simulation profiles normalize explicit units and scaled unitless ticks exactly', () => {
        const profile: TimeProfile = { kind: 'simulation', pattern: uvmPattern, unit: 'ns', scale: '10', start: '1 us', end: '1.5 us', untimed: 'exclude' };
        assert.deepStrictEqual(evaluateTimeRange(['UVM_INFO @ 100: first', 'UVM_INFO @ 1500 ns: second', 'UVM_INFO @ 1.501 us: outside', 'UVM_INFO @ 1000000 ps: same'], profile).allowed, [true, true, false, true]);
        assert.strictEqual(normalizeTime('0.000001 ns', profile).toFixed(), '1');
        assert.throws(() => validateTimeProfile({ ...profile, unit: undefined }), /Choose the unit/);
    });

    test('continuations inherit only a valid preceding timestamp and counter resets are reported', () => {
        const profile: TimeProfile = { kind: 'cycles', pattern: 'cycle:(\\S+)', start: '10', end: '20', untimed: 'inherit' };
        const result = evaluateTimeRange(['header', 'cycle:12', 'stack line', 'cycle:bad', 'not inherited', 'cycle:18', 'cycle:2', 'outside', 'cycle:12'], profile);
        assert.deepStrictEqual(result.allowed, [false, true, true, false, false, true, false, false, true]);
        assert.strictEqual(result.summary.invalid, 1);
        assert.strictEqual(result.summary.resets, 1);
        assert.strictEqual(result.summary.minimum, '2 cycles');
    });

    test('wall clocks support ISO offsets and explicit custom date formats and timezones', () => {
        const profile: TimeProfile = { kind: 'wall', pattern: isoPattern, zone: 'UTC', format: 'ISO', start: '2026-09-11T10:00:00Z', end: '2026-09-11T10:00:01Z', untimed: 'exclude' };
        assert.deepStrictEqual(evaluateTimeRange(['2026-09-11T15:30:00+05:30 INFO', '2026-09-11 10:00:01 INFO', '2026-09-11T10:00:02Z INFO'], profile).allowed, [true, true, false]);
        const custom: TimeProfile = { ...profile, pattern: '^\\[([^\\]]+)\\]', format: 'dd/MM/yyyy HH:mm:ss', zone: 'Asia/Kolkata', start: '11/09/2026 15:30:00', end: '11/09/2026 15:30:01' };
        assert.deepStrictEqual(evaluateTimeRange(['[11/09/2026 15:30:01] OK'], custom).allowed, [true]);
        assert.throws(() => normalizeTime('2026-02-30T12:00:00Z', profile), /Invalid timestamp/);
        assert.throws(() => normalizeTime('2026-09-11T10:00:00.1234Z', profile), /millisecond/);
        assert.throws(() => validateTimeProfile({ ...custom, format: 'HH:mm:ss' }), /full date/);
        assert.throws(() => validateTimeProfile({ ...profile, zone: 'not-a-zone' }), /timezone/);
        assert.throws(() => validateTimeProfile({ ...profile, start: '2026-09-12T00:00:00Z' }), /start/);
        assert.throws(() => normalizeTime('2026-03-08T02:30:00', { ...profile, zone: 'America/New_York' }), /clock gap/);
        assert.throws(() => normalizeTime('2026-11-01T01:30:00', { ...profile, zone: 'America/New_York' }), /Ambiguous/);
    });

    test('cycle wizard previews the exact sample, applies only on confirmation, and clears per document', async () => {
        const document = await vscode.workspace.openTextDocument({ content: '[DmacRunSeq          ]|(cycle:65689  )| Writing to SYSDMASRCADDRLO=01080012' });
        await vscode.window.showTextDocument(document);
        const originals = { showQuickPick: vscode.window.showQuickPick, showInputBox: vscode.window.showInputBox, showInformationMessage: vscode.window.showInformationMessage };
        const provider = new FocusProvider([], []);
        const state = { focusProvider: provider } as State;
        let confirm = false;
        const answers = [cyclePattern, '65689', '65689', cyclePattern, '65689', '65689'];
        vscode.window.showQuickPick = (async (choices: unknown[]) => typeof choices[0] === 'string' ? choices[0] : choices[0]) as unknown as typeof vscode.window.showQuickPick;
        vscode.window.showInputBox = async () => answers.shift();
        vscode.window.showInformationMessage = (async (message: string) => {
            assert.ok(message.includes('65689 cycles'));
            return confirm ? 'Apply Range' : undefined;
        }) as typeof vscode.window.showInformationMessage;
        try {
            await configureTimeRange(state);
            assert.strictEqual(vscode.workspace.getConfiguration('logAnalysisGamma').get<Record<string, TimeProfile>>('timeProfiles', {})[document.uri.toString()], undefined);
            confirm = true;
            await configureTimeRange(state);
            const profile = vscode.workspace.getConfiguration('logAnalysisGamma').get<Record<string, TimeProfile>>('timeProfiles', {})[document.uri.toString()];
            assert.strictEqual(profile.kind, 'cycles');
            assert.strictEqual(profile.start, '65689');
            assert.strictEqual(await provider.provideTextDocumentContent(vscode.Uri.parse('focus-gamma:' + document.uri.toString())), '\n' + document.getText());
            await clearTimeRange(state);
            assert.strictEqual(vscode.workspace.getConfiguration('logAnalysisGamma').get<Record<string, TimeProfile>>('timeProfiles', {})[document.uri.toString()], undefined);
        } finally {
            Object.assign(vscode.window, originals);
            await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        }
    });

    test('time-only focusing works and context never leaks outside range or exclusions', () => {
        const profile: TimeProfile = { kind: 'cycles', pattern: cyclePattern, start: '10', end: '20', untimed: 'inherit' };
        const result = processFocus({
            lines: ['(cycle:9) outside', '(cycle:10) ERROR', 'detail', '(cycle:20) NOISE', '(cycle:21) outside'],
            filters: [], exclusions: [{ regex: 'NOISE', flags: '', id: 'noise' }], before: 2, after: 3, timeProfile: profile
        });
        assert.deepStrictEqual(result.indices, [1, 2]);
        assert.strictEqual(result.timeline!.timed, 4);
        assert.deepStrictEqual(result.counts, [1]);
    });

    test('processing jobs cancel, pause, resume, and time out without blocking the host', async () => {
        const controller = new ProcessingController();
        try {
            const input = { lines: ['ERROR'], filters: [{ regex: 'ERROR', flags: '', id: 'error' }] };
            controller.setPaused(true);
            await assert.rejects(controller.run('test', 'highlights', input), /Canceled/);
            controller.setPaused(false);
            assert.deepStrictEqual(await controller.run('test', 'highlights', input), [[0]]);
            const token = new vscode.CancellationTokenSource();
            const canceled = controller.run('cancel', 'highlights', input, token.token);
            token.cancel();
            await assert.rejects(canceled, /Canceled/);
            token.dispose();
            const expensive = { lines: ['a'.repeat(100) + '!'], filters: [{ regex: '^(a+)+$', flags: '', id: 'slow' }] };
            await assert.rejects(controller.run('timeout', 'highlights', expensive, undefined, 400), /timed out/);
            assert.strictEqual(controller.activeJobs, 0);
        } finally {
            controller.dispose();
        }
    });

    test('bookmarks persist workspace notes, replace duplicate positions, and remove cleanly', async () => {
        const data = new Map<string, unknown>();
        const storage = { keys: () => [...data.keys()], get: (key: string, fallback: unknown) => data.get(key) || fallback,
            update: async (key: string, value: unknown) => { data.set(key, value); } } as unknown as vscode.Memento;
        const manager = new BookmarkManager(storage);
        const uri = vscode.Uri.file('/logs/test.log');
        const entry = await manager.add(uri, 2, 'important', 'investigate');
        assert.strictEqual(entry.color, defaultBookmarkColor);
        await manager.setColor(entry.id, '#F80');
        await manager.add(uri, 2, 'important', 'updated note');
        const restored = new BookmarkManager(storage);
        assert.strictEqual(restored.getChildren().length, 1);
        assert.strictEqual(restored.getChildren()[0].bookmark.id, entry.id);
        assert.strictEqual(restored.getChildren()[0].label, 'updated note');
        assert.strictEqual(restored.getChildren()[0].bookmark.color, '#ff8800');
        await assert.rejects(restored.setColor(entry.id, 'red" onload="bad'), /hex color/);
        assert.strictEqual(restored.getChildren()[0].bookmark.color, '#ff8800');
        assert.strictEqual(findBookmarkLine(entry, ['inserted', 'x', 'y', 'important']), 3);
        assert.strictEqual(findBookmarkLine(entry, ['important', 'important', 'changed']), undefined);
        assert.strictEqual(findBookmarkLine(entry, ['changed']), undefined);
        await restored.remove(entry.id);
        const empty = new BookmarkManager(storage);
        assert.strictEqual(empty.getChildren().length, 0);
        manager.dispose(); restored.dispose(); empty.dispose();
    });

    test('legacy bookmarks without colors and invalid saved colors default to blue', () => {
        const entries = [
            { id: 'legacy', uri: 'file:///test.log', line: 1, text: 'line', note: 'note' },
            { id: 'invalid', uri: 'file:///test.log', line: 2, text: 'line', note: 'note', color: 'invalid' }
        ];
        const manager = new BookmarkManager({ get: () => entries } as unknown as vscode.Memento);
        assert.deepStrictEqual(manager.getChildren().map(item => item.bookmark.color), [defaultBookmarkColor, defaultBookmarkColor]);
        manager.dispose();
    });

    function createBookmarks(): BookmarkManager {
        const values = new Map<string, unknown>();
        return new BookmarkManager({
            keys: () => [...values.keys()],
            get: (key: string, fallback: unknown) => values.get(key) || fallback,
            update: async (key: string, value: unknown) => { values.set(key, value); }
        } as unknown as vscode.Memento);
    }

    test('bookmark decorations cover source lines and safely display user notes on hover', async () => {
        const document = await vscode.workspace.openTextDocument({ content: 'before\nimportant\n\nafter' });
        const bookmarks = createBookmarks();
        try {
            const note = 'Check register\n[run](command:evil) <script>';
            await bookmarks.add(document.uri, 1, 'important', note);
            await bookmarks.add(document.uri, 2, '', 'blank context');
            const decorations = await bookmarks.getDecorations(document);
            assert.strictEqual(decorations.get(defaultBookmarkColor)!.length, 2);
            const marker = decorations.get(defaultBookmarkColor)![0];
            assert.deepStrictEqual(marker.range, new vscode.Range(1, 0, 1, 'important'.length));
            const hover = marker.hoverMessage as vscode.MarkdownString;
            assert.strictEqual(hover.isTrusted, false);
            assert.ok(hover.value.includes(new vscode.MarkdownString().appendText(note).value));
            assert.ok(hover.value.includes('\\[run\\]'));
            assert.ok(hover.value.includes(':2'));
            assert.deepStrictEqual(decorations.get(defaultBookmarkColor)![1].range, new vscode.Range(2, 0, 2, 0));
            const otherDocument = await vscode.workspace.openTextDocument({ content: document.getText() });
            assert.strictEqual((await bookmarks.getDecorations(otherDocument)).size, 0);
        } finally { bookmarks.dispose(); }
    });

    test('focus bookmark markers map original lines, omit filtered lines, and reject stale mappings', async () => {
        const document = await vscode.workspace.openTextDocument({ content: 'hidden\nERROR important\nERROR second' });
        const project = deserializeProject({ name: 'test', groups: [{ name: 'errors', filters: [{ regex: 'ERROR', color: 'red', isShown: true }] }] });
        const focus = new FocusProvider(project.groups, []);
        const uri = vscode.Uri.parse('focus-gamma:' + document.uri.toString());
        const content = await focus.provideTextDocumentContent(uri);
        const lines = content.split('\n');
        const virtualDocument = {
            uri, lineCount: lines.length, lineAt: (line: number) => ({ text: lines[line] })
        } as unknown as vscode.TextDocument;
        const bookmarks = createBookmarks();
        try {
            await bookmarks.add(document.uri, 0, 'hidden', 'not in focus');
            await bookmarks.add(document.uri, 1, 'ERROR important', 'visible note');
            const result = await bookmarks.getDecorations(virtualDocument, focus);
            assert.strictEqual(result.get(defaultBookmarkColor)!.length, 1);
            assert.strictEqual(result.get(defaultBookmarkColor)![0].range.start.line, 1);
            assert.ok((result.get(defaultBookmarkColor)![0].hoverMessage as vscode.MarkdownString).value.includes(new vscode.MarkdownString().appendText('visible note').value));
            const edit = new vscode.WorkspaceEdit();
            edit.insert(document.uri, new vscode.Position(0, 0), 'inserted\n');
            await vscode.workspace.applyEdit(edit);
            assert.strictEqual((await bookmarks.getDecorations(virtualDocument, focus)).size, 0);
            const moved = await bookmarks.getDecorations(document);
            assert.deepStrictEqual(moved.get(defaultBookmarkColor)!.map(option => option.range.start.line), [1, 2]);
            await focus.provideTextDocumentContent(uri);
            assert.strictEqual((await bookmarks.getDecorations(virtualDocument, focus)).get(defaultBookmarkColor)!.length, 1);
        } finally { bookmarks.dispose(); }
    });

    test('bookmark color picker supports swatches and custom hex and leaves canceled choices untouched', async () => {
        const bookmarks = createBookmarks();
        const originalPicker = vscode.window.showQuickPick;
        const originalInput = vscode.window.showInputBox;
        const entry = await bookmarks.add(vscode.Uri.file('/logs/test.log'), 0, 'line', 'note');
        try {
            vscode.window.showQuickPick = (async () => undefined) as typeof vscode.window.showQuickPick;
            await bookmarks.changeColor(bookmarks.getChildren()[0]);
            assert.strictEqual(entry.color, defaultBookmarkColor);
            vscode.window.showQuickPick = (async (items: Array<vscode.QuickPickItem & { color: string }>) => {
                assert.ok(items[0].iconPath instanceof vscode.Uri);
                return items.find(item => item.label === 'Red');
            }) as unknown as typeof vscode.window.showQuickPick;
            await bookmarks.changeColor(bookmarks.getChildren()[0]);
            assert.strictEqual(entry.color, '#e74c3c');
            vscode.window.showQuickPick = (async (items: Array<vscode.QuickPickItem & { color: string }>) => items.find(item => item.color === '')) as unknown as typeof vscode.window.showQuickPick;
            vscode.window.showInputBox = async () => undefined;
            await bookmarks.changeColor(bookmarks.getChildren()[0]);
            assert.strictEqual(entry.color, '#e74c3c');
            vscode.window.showInputBox = async options => {
                assert.ok(await options!.validateInput!('not-a-color'));
                assert.strictEqual(await options!.validateInput!('#0Af'), undefined);
                return '#0Af';
            };
            await bookmarks.changeColor(bookmarks.getChildren()[0]);
            assert.strictEqual(entry.color, '#00aaff');
            assert.strictEqual(normalizeBookmarkColor('red'), undefined);
            const icon = bookmarks.getChildren()[0].iconPath as vscode.Uri;
            assert.ok(Buffer.from(icon.path.split(',')[1], 'base64').toString('utf8').includes('#00aaff'));
        } finally {
            vscode.window.showQuickPick = originalPicker;
            vscode.window.showInputBox = originalInput;
            bookmarks.dispose();
        }
    });

    test('gutter rendering recolors and removes markers, clears unrelated editors, and disposes resources', async () => {
        const document = await vscode.workspace.openTextDocument({ content: 'bookmark me' });
        const unrelated = await vscode.workspace.openTextDocument({ content: 'other' });
        const bookmarks = createBookmarks();
        const focus = new FocusProvider([], []);
        const originalCreate = vscode.window.createTextEditorDecorationType;
        const created: Array<{ options: vscode.DecorationRenderOptions; disposed: boolean }> = [];
        const rendered: vscode.DecorationOptions[][] = [];
        const editor = { document, setDecorations: (_type: vscode.TextEditorDecorationType, options: vscode.DecorationOptions[]) => rendered.push(options) } as unknown as vscode.TextEditor;
        vscode.window.createTextEditorDecorationType = options => {
            const resource = { options, disposed: false };
            created.push(resource);
            return { key: `test-${created.length}`, dispose: () => { resource.disposed = true; } };
        };
        try {
            const entry = await bookmarks.add(document.uri, 0, 'bookmark me', 'first note');
            await bookmarks.refreshDecorations(focus, [editor]);
            assert.strictEqual(created.length, 1);
            assert.ok(created[0].options.gutterIconPath instanceof vscode.Uri);
            assert.strictEqual(created[0].options.gutterIconSize, 'contain');
            assert.strictEqual(rendered[0][0].range.start.line, 0);
            await bookmarks.setColor(entry.id, '#ff8800');
            await bookmarks.refreshDecorations(focus, [editor]);
            assert.strictEqual(created[0].disposed, true);
            assert.strictEqual(created.length, 2);
            await bookmarks.add(document.uri, 0, 'bookmark me', 'edited note');
            await bookmarks.refreshDecorations(focus, [editor]);
            assert.ok((rendered[rendered.length - 1][0].hoverMessage as vscode.MarkdownString).value.includes(new vscode.MarkdownString().appendText('edited note').value));
            await bookmarks.refreshDecorations(focus, [{ document: unrelated, setDecorations: editor.setDecorations } as unknown as vscode.TextEditor]);
            assert.deepStrictEqual(rendered[rendered.length - 1], []);
            await bookmarks.remove(entry.id);
            await bookmarks.refreshDecorations(focus, [editor]);
            assert.strictEqual(created[1].disposed, true);
            await bookmarks.add(document.uri, 0, 'bookmark me', 'new');
            await bookmarks.refreshDecorations(focus, [editor]);
            bookmarks.dispose();
            assert.ok(created.every(resource => resource.disposed));
        } finally {
            bookmarks.dispose();
            vscode.window.createTextEditorDecorationType = originalCreate;
        }
    });

    test('focus bookmarks use the original line map and reject the synthetic header', () => {
        const source = vscode.Uri.file('/logs/source.log');
        const focusUri = vscode.Uri.parse('focus-gamma:' + source.toString());
        const provider = new FocusProvider([], []);
        provider.documentLineMap.set(source.fsPath, [0, 12]);
        const editor = { document: { uri: focusUri }, selection: new vscode.Selection(1, 0, 1, 0) } as vscode.TextEditor;
        assert.strictEqual(originalBookmarkLocation(editor, provider)!.line, 12);
        assert.strictEqual(originalBookmarkLocation(editor, provider)!.uri.toString(), source.toString());
        editor.selection = new vscode.Selection(0, 0, 0, 0);
        assert.strictEqual(originalBookmarkLocation(editor, provider), undefined);
    });

    test('async highlight cache handles global regexes and rejects stale document versions', async () => {
        const document = await vscode.workspace.openTextDocument({ content: 'ERROR\nERROR\nother\nerror' });
        const cache = new DocumentCache(document);
        assert.deepStrictEqual(await cache.getMatchingLinesBatch([/ERROR/gi, /other/]), [[0, 1, 3], [2]]);
        assert.deepStrictEqual(await cache.getMatchingLinesBatch([/ERROR/gi]), [[0, 1, 3]]);
        const edit = new vscode.WorkspaceEdit();
        edit.insert(document.uri, new vscode.Position(0, 0), 'inserted\n');
        await vscode.workspace.applyEdit(edit);
        await assert.rejects(cache.getMatchingLinesBatch([/ERROR/]), /Canceled/);
    });

    test('a newer job supersedes the old result and pause cancels all outstanding jobs', async () => {
        const controller = new ProcessingController();
        try {
            const slow = controller.run('same', 'highlights', { lines: ['a'.repeat(100) + '!'], filters: [{ regex: '^(a+)+$', flags: '', id: 'slow' }] });
            const canceled = assert.rejects(slow, /Canceled/);
            const fast = controller.run('same', 'highlights', { lines: ['yes'], filters: [{ regex: 'yes', flags: '', id: 'fast' }] });
            await canceled;
            assert.deepStrictEqual(await fast, [[0]]);
            const pending = controller.run('pause', 'highlights', { lines: ['yes'], filters: [] });
            controller.setPaused(true);
            await assert.rejects(pending, /Canceled/);
            assert.strictEqual(controller.activeJobs, 0);
        } finally { controller.dispose(); }
    });
});