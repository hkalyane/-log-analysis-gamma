import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { deserializeFilter, deserializeProject, readSettings, saveSettings, serializeFilter } from '../../settings';
import { ProjectSettings, ProjectSettingsManager } from '../../projectSettingsManager';
import { Filter, Group, Project } from '../../utils';
import { State } from '../../extension';
import { ExFilterTreeViewProvider } from '../../exFilterTreeViewProvider';
import { FilterTreeViewProvider } from '../../filterTreeViewProvider';
import { ProjectTreeViewProvider } from '../../projectTreeViewProvider';
import { FocusProvider } from '../../focusProvider';
import { refreshSettings, saveProject } from '../../commands';

suite('Filter persistence', () => {
	let storagePath: string;
	let manager: ProjectSettingsManager;
	let context: vscode.ExtensionContext;
	let disposables: vscode.Disposable[];
	const configurationKeys = ['editorSelectionStrategy', 'maxEditorsToProcess', 'autoDetectLogFiles',
		'showRandomColorNotifications', 'maxRememberedColors'];
	let configurationValues: unknown[];

	setup(() => {
		storagePath = fs.mkdtempSync(path.join(os.tmpdir(), 'log-highlighter-'));
		disposables = [];
		const storedValues = new Map<string, unknown>();
		context = {
			globalState: {
				get: (key: string) => storedValues.get(key),
				update: async (key: string, value: unknown) => { storedValues.set(key, value); }
			}
		} as unknown as vscode.ExtensionContext;
		manager = new ProjectSettingsManager(context);
		const config = vscode.workspace.getConfiguration('logAnalysisGamma');
		configurationValues = configurationKeys.map(key => config.inspect(key)?.globalValue);
	});

	teardown(async () => {
		disposables.forEach(disposable => disposable.dispose());
		const config = vscode.workspace.getConfiguration('logAnalysisGamma');
		for (const [index, key] of configurationKeys.entries()) {
			await config.update(key, configurationValues[index], vscode.ConfigurationTarget.Global);
		}
		fs.rmdirSync(storagePath, { recursive: true });
	});

	function createState(): State {
		const projects: Project[] = [];
		const groups: Group[] = [];
		const exFilters: Filter[] = [];
		const decoration = vscode.window.createTextEditorDecorationType({});
		disposables.push(decoration);
		return {
			projects, groups, exFilters, inFocusMode: false, decorations: [], disposableFoldingRange: null,
			globalStorageUri: vscode.Uri.file(storagePath), noUnderlineDecorationType: decoration,
			filterTreeViewProvider: new FilterTreeViewProvider(groups),
			exFilterTreeViewProvider: new ExFilterTreeViewProvider(exFilters),
			projectTreeViewProvider: new ProjectTreeViewProvider(projects),
			focusProvider: new FocusProvider(groups, exFilters)
		};
	}

	function createSavedState() {
		const project = deserializeProject({
			id: 'project', name: 'Logs', selected: true,
			groups: [{ id: 'group', name: 'Errors', isShown: true, isHighlighted: true,
				filters: [{ id: 'error', regex: 'ERROR\\s+\\d+', flags: 'i', color: '#ff0000', isShown: true, isHighlighted: true }] }]
		});
		return {
			projects: [project], groups: project.groups,
			exFilters: [deserializeFilter({ id: 'debug', regex: 'DEBUG.*verbose', color: '#00ff00', isShown: true }, true)]
		};
	}

	test('internal storage preserves projects, exclusions, flags, and toggles', () => {
		const original = createSavedState();
		saveSettings(vscode.Uri.file(storagePath), original.projects, original.exFilters);
		const exclusions: Filter[] = [];
		const projects = readSettings(vscode.Uri.file(storagePath), exclusions);
		assert.deepStrictEqual(projects, original.projects);
		assert.deepStrictEqual(exclusions, original.exFilters);
	});

	test('shared file serializes nested regexes and exclusion visibility', async () => {
		const original = createSavedState();
		const filePath = path.join(storagePath, 'shared.json');
		assert.strictEqual(await manager.saveProjectSettings(filePath, original), true);
		const saved = JSON.parse(fs.readFileSync(filePath, 'utf8'));
		assert.strictEqual(saved.projects[0].groups[0].filters[0].regex, 'ERROR\\s+\\d+');
		assert.strictEqual(saved.projects[0].groups[0].filters[0].flags, 'i');
		assert.strictEqual(saved.exclusionFilters[0].regex, 'DEBUG.*verbose');
		assert.strictEqual(saved.exclusionFilters[0].isShown, true);
		assert.strictEqual(saved.projects[0].groups[0].filters[0].iconPath, undefined);
		assert.ok(original.projects[0].groups[0].filters[0].regex instanceof RegExp);
	});

	test('shared save preserves distinct groups when merging selected projects', async () => {
		const original = createSavedState();
		original.projects.push(deserializeProject({
			name: 'Imported', selected: true,
			groups: [{ name: 'Warnings', filters: [{ regex: 'WARN', color: 'yellow' }] }]
		}));
		const filePath = path.join(storagePath, 'merged.json');
		assert.strictEqual(await manager.saveProjectSettings(filePath, original), true);
		const saved = await manager.loadProjectSettings(filePath);
		assert.strictEqual(saved!.projects[0].groups[0].filters[0].regex, 'ERROR\\s+\\d+');
		assert.strictEqual(saved!.projects[1].groups[0].filters[0].regex, 'WARN');
	});

	test('remembered shared file restores all providers and working focus exclusions', async () => {
		const filePath = path.join(storagePath, 'shared.json');
		await manager.saveProjectSettings(filePath, createSavedState());
		const restoredManager = new ProjectSettingsManager(context);
		assert.strictEqual(restoredManager.getCurrentSettingsPath(), filePath);
		const settings = await restoredManager.loadProjectSettings();
		assert.ok(settings);
		const state = createState();
		const exclusions = state.exFilters;
		let refreshCount = 0;
		disposables.push(state.exFilterTreeViewProvider.onDidChangeTreeData(() => refreshCount++));
		assert.strictEqual(await restoredManager.applyProjectSettings(settings!, state), true);
		assert.strictEqual(state.exFilters, exclusions);
		assert.strictEqual(refreshCount, 1);
		assert.strictEqual((await state.projectTreeViewProvider.getChildren())[0].label, 'Logs');
		assert.strictEqual((await state.filterTreeViewProvider.getChildren())[0].label, 'Errors');
		assert.strictEqual((await state.exFilterTreeViewProvider.getChildren())[0].label, '/DEBUG.*verbose/');
		assert.strictEqual(state.groups, state.projects[0].groups);
		const logPath = path.join(storagePath, 'focus.log');
		fs.writeFileSync(logPath, 'error 42\nerror 99 DEBUG verbose\nignored');
		const focusUri = vscode.Uri.parse('focus-gamma:' + vscode.Uri.file(logPath).toString());
		assert.strictEqual(await state.focusProvider.provideTextDocumentContent(focusUri), '\nerror 42');

		settings!.exclusionFilters[0].isShown = false;
		fs.writeFileSync(filePath, JSON.stringify(settings));
		await restoredManager.refreshProjectSettings(state);
		assert.strictEqual(state.exFilters, exclusions);
		assert.strictEqual((await state.exFilterTreeViewProvider.getChildren()).length, 1);
		assert.strictEqual(state.exFilters[0].isShown, false);
		assert.strictEqual(await state.focusProvider.provideTextDocumentContent(focusUri), '\nerror 42\nerror 99 DEBUG verbose');
	});

	test('internal startup refresh restores selected project and exclusion panel', async () => {
		const original = createSavedState();
		original.projects.unshift(deserializeProject({ name: 'Other', groups: [] }));
		saveSettings(vscode.Uri.file(storagePath), original.projects, original.exFilters);
		const state = createState();
		const exclusions = state.exFilters;
		assert.strictEqual(refreshSettings(state), true);
		assert.strictEqual(state.projects.length, 2);
		assert.strictEqual(state.groups, state.projects[1].groups);
		assert.strictEqual(state.projects[1].selected, true);
		assert.strictEqual(state.groups[0].filters[0].isHighlighted, true);
		assert.strictEqual(state.exFilters, exclusions);
		assert.strictEqual((await state.exFilterTreeViewProvider.getChildren())[0].label, '/DEBUG.*verbose/');
	});

	test('internal save supports exclusion-only projects and removing the last exclusion', () => {
		const state = createState();
		refreshSettings(state);
		state.exFilters.push(...createSavedState().exFilters);
		saveProject(state);
		const restored = createState();
		refreshSettings(restored);
		assert.strictEqual(restored.exFilters.length, 1);
		restored.exFilters.splice(0);
		saveProject(restored);
		refreshSettings(state);
		assert.strictEqual(state.exFilters.length, 0);
	});

	test('legacy internal projects load without exclusions or state flags', () => {
		fs.writeFileSync(path.join(storagePath, 'vscode_log_analysis.json'), JSON.stringify({
			projects: [{ name: 'Legacy', groups: [{ name: 'Errors', filters: [{ regex: 'ERROR', color: 'red' }] }] }]
		}));
		const exclusions = createSavedState().exFilters;
		const projects = readSettings(vscode.Uri.file(storagePath), exclusions);
		assert.strictEqual(projects[0].groups[0].filters[0].regex.source, 'ERROR');
		assert.strictEqual(exclusions.length, 0);
	});

	test('legacy shared direct filters are restored and do not duplicate on reload', async () => {
		const settings = {
			projects: [], exclusionFilters: [], filters: [
				{ pattern: 'ERROR', enabled: true, color: 'red' },
				{ pattern: 'DEBUG', enabled: true, color: 'green', isExclusionFilter: true }
			]
		} as unknown as ProjectSettings;
		const state = createState();
		assert.strictEqual(await manager.applyProjectSettings(settings, state), true);
		assert.strictEqual(await manager.applyProjectSettings(settings, state), true);
		assert.strictEqual(state.groups.length, 1);
		assert.strictEqual(state.groups[0].filters[0].regex.source, 'ERROR');
		assert.strictEqual(state.exFilters[0].regex.source, 'DEBUG');
		const filePath = path.join(storagePath, 'converted.json');
		assert.strictEqual(await manager.saveProjectSettings(filePath, state), true);
		assert.strictEqual(await manager.applyProjectSettings((await manager.loadProjectSettings(filePath))!, state), true);
		assert.strictEqual(state.groups.length, 1);
		assert.strictEqual(state.exFilters.length, 1);
	});

	test('corrupted shared data leaves live filters unchanged', async () => {
		const state = createState();
		state.exFilters.push(...createSavedState().exFilters);
		const originalFilter = state.exFilters[0];
		const settings = JSON.parse('{"projects":[],"exclusionFilters":[{"regex":{},"color":"red"}]}');
		assert.strictEqual(await manager.applyProjectSettings(settings, state), false);
		assert.strictEqual(state.exFilters[0], originalFilter);
		assert.strictEqual((await state.exFilterTreeViewProvider.getChildren()).length, 1);
	});

	test('corrupted internal data is not overwritten with a default project', () => {
		const filePath = path.join(storagePath, 'vscode_log_analysis.json');
		const content = '{"projects":[{"name":"Broken","groups":[{"name":"Errors","filters":[{"regex":{}}]}]}]}';
		fs.writeFileSync(filePath, content);
		assert.strictEqual(refreshSettings(createState()), false);
		assert.strictEqual(fs.readFileSync(filePath, 'utf8'), content);
	});

	test('round-trips regex source, flags, and disabled visibility through JSON', () => {
		const original = deserializeFilter({
			id: 'exclude-debug', regex: '^DEBUG\\s+verbose$', flags: 'im', color: '#ff0000',
			isHighlighted: false, isShown: false
		}, true);
		const saved = JSON.parse(JSON.stringify(serializeFilter(original)));
		assert.strictEqual(saved.regex, '^DEBUG\\s+verbose$');
		assert.strictEqual(saved.flags, 'im');
		assert.strictEqual(saved.isShown, false);
		assert.strictEqual(saved.iconPath, undefined);
		const restored = deserializeFilter(saved, true);
		assert.ok(restored.regex instanceof RegExp);
		assert.ok(restored.regex.test('debug verbose'));
		assert.strictEqual(restored.isShown, false);
		assert.ok(restored.iconPath instanceof vscode.Uri);
	});

	test('accepts legacy pattern/enabled filters and empty regex strings', () => {
		const restored = deserializeFilter({ pattern: 'ERROR', enabled: true, color: '#ff0000' });
		assert.ok(restored.regex.test('ERROR'));
		assert.strictEqual(restored.isHighlighted, true);
		assert.strictEqual(restored.isShown, true);
		assert.ok(deserializeFilter({ regex: '', color: '#ff0000' }).regex.test('anything'));
	});

	test('rejects missing, corrupted, and invalid regex patterns', () => {
		assert.throws(() => deserializeFilter({ color: '#ff0000' }), /no valid regex/);
		assert.throws(() => deserializeFilter(JSON.parse('{"regex":{},"color":"red"}')), /no valid regex/);
		assert.throws(() => deserializeFilter({ regex: '[', color: '#ff0000' }), SyntaxError);
	});
});
