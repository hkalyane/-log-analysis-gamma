import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { deserializeFilter, deserializeProject, getSettingFile, readSettings, saveSettings, serializeFilter } from '../../settings';
import { ProjectSettings, ProjectSettingsManager } from '../../projectSettingsManager';
import { Filter, Group, Project } from '../../utils';
import { State } from '../../extension';
import { ExFilterTreeViewProvider } from '../../exFilterTreeViewProvider';
import { FilterTreeViewProvider } from '../../filterTreeViewProvider';
import { ProjectTreeViewProvider } from '../../projectTreeViewProvider';
import { FocusProvider } from '../../focusProvider';
import { addExFilter, addFilter, addGroup, addProject, deleteGroup, deleteProject, loadProjectSettings,
	refreshProjectSettings, refreshSettings, saveProject, saveProjectSettings, selectProject, unloadSharedFilterFile } from '../../commands';
import { StorageFilesTreeViewProvider } from '../../storageFilesTreeViewProvider';

suite('Filter persistence', function () {
	this.timeout(10000);
	let storagePath: string;
	let manager: ProjectSettingsManager;
	let context: vscode.ExtensionContext;
	let disposables: vscode.Disposable[];
	const configurationKeys = ['editorSelectionStrategy', 'maxEditorsToProcess', 'autoDetectLogFiles',
		'showRandomColorNotifications', 'maxRememberedColors', 'relevantFileExtensions', 'userColors', 'showProjectFilePaths'];
	let configurationValues: unknown[];
	let restorePrompts: () => void;

	setup(() => {
		const original = {
			showQuickPick: vscode.window.showQuickPick, showInputBox: vscode.window.showInputBox,
			showWarningMessage: vscode.window.showWarningMessage, showOpenDialog: vscode.window.showOpenDialog
		};
		restorePrompts = () => Object.assign(vscode.window, original);
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
		restorePrompts();
		disposables.forEach(disposable => disposable.dispose());
		const config = vscode.workspace.getConfiguration('logAnalysisGamma');
		for (const [index, key] of configurationKeys.entries()) {
			if (config.inspect(key)?.globalValue !== configurationValues[index]) {
				await config.update(key, configurationValues[index], vscode.ConfigurationTarget.Global);
			}
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

	function setPromptAnswers(answers: Array<string | undefined>) {
		type Choice = vscode.QuickPickItem & { filePath?: string };
		const seen: Array<{ title?: string; options: Array<{ label: string; filePath?: string; description?: string }> }> = [];
		vscode.window.showQuickPick = (async (items: Choice[] | Thenable<Choice[]>, options?: vscode.QuickPickOptions) => {
			const choices = await items;
			seen.push({ title: options?.title, options: choices });
			assert.ok(answers.length > 0, 'Unexpected QuickPick');
			const answer = answers.shift();
			if (answer === undefined) {
				return undefined;
			}
			const chosen = choices.find(item => item.filePath === answer || item.label === answer);
			assert.ok(chosen, `Missing choice: ${answer}`);
			return chosen;
		}) as unknown as typeof vscode.window.showQuickPick;
		return seen;
	}

	test('project paths default to hidden and show/hide commands preserve tooltips and selection', async () => {
		await vscode.extensions.getExtension('hkalyane.log-analysis-gamma')!.activate();
		const config = vscode.workspace.getConfiguration('logAnalysisGamma');
		assert.strictEqual(config.inspect('showProjectFilePaths')!.defaultValue, false);
		await config.update('showProjectFilePaths', undefined, vscode.ConfigurationTarget.Global);
		const project = createSavedState().projects[0];
		project.sourcePath = path.join(storagePath, 'external.json');
		const provider = new ProjectTreeViewProvider([project]);
		const hidden = (await provider.getChildren())[0];
		assert.strictEqual(hidden.description, undefined);
		assert.ok(String(hidden.tooltip).includes(project.sourcePath));
		await vscode.commands.executeCommand('log-analysis-gamma.showProjectFilePaths');
		assert.strictEqual((await provider.getChildren())[0].description, project.sourcePath);
		assert.strictEqual(vscode.workspace.getConfiguration('logAnalysisGamma').inspect('showProjectFilePaths')!.globalValue, true);
		assert.strictEqual((await new ProjectTreeViewProvider([project]).getChildren())[0].description, project.sourcePath);
		await vscode.commands.executeCommand('log-analysis-gamma.hideProjectFilePaths');
		const hiddenAgain = (await provider.getChildren())[0];
		assert.strictEqual(hiddenAgain.description, undefined);
		assert.strictEqual(hiddenAgain.tooltip, hidden.tooltip);
		assert.deepStrictEqual(hiddenAgain.command, hidden.command);
		assert.strictEqual(project.selected, true);
	});

	test('storage file rows expose full paths, source kinds, and unsaved state', async () => {
		const externalPath = path.join(storagePath, 'external.json');
		await manager.saveProjectSettings(externalPath, createSavedState());
		const state = createState();
		await manager.initializeFiles(state);
		const provider = new StorageFilesTreeViewProvider(manager, state);
		const rows = provider.getChildren();
		assert.strictEqual(rows.length, 2);
		assert.strictEqual(rows[0].contextValue, 'internal-loaded');
		assert.strictEqual(rows[0].description, getSettingFile(state.globalStorageUri));
		assert.strictEqual(rows[1].description, externalPath);
		assert.strictEqual(rows[1].contextValue, 'external-loaded');
		assert.deepStrictEqual(rows[1].command!.arguments, [externalPath]);
		assert.ok(String(rows[1].tooltip).includes(externalPath));
		state.exFilters[0].isShown = false;
		assert.ok(String(provider.getChildren()[1].label).endsWith(' *'));
	});

	test('save prompts choose a full-path destination and scope; cancel never writes', async () => {
		const externalPath = path.join(storagePath, 'external.json');
		await manager.saveProjectSettings(externalPath, createSavedState());
		const state = createState();
		await manager.initializeFiles(state);
		state.exFilters[0].regex = /CHANGED/;
		const internalPath = getSettingFile(state.globalStorageUri);
		const internalBefore = fs.readFileSync(internalPath, 'utf8');
		const before = fs.readFileSync(externalPath, 'utf8');
		setPromptAnswers([undefined]);
		await saveProjectSettings(context, state);
		assert.strictEqual(fs.readFileSync(externalPath, 'utf8'), before);
		setPromptAnswers([externalPath, undefined]);
		await saveProjectSettings(context, state);
		assert.strictEqual(fs.readFileSync(externalPath, 'utf8'), before);
		const prompts = setPromptAnswers([externalPath, 'Exclusion Filters Only']);
		await saveProjectSettings(context, state);
		assert.deepStrictEqual(prompts[0].options.map(item => item.description), [internalPath, externalPath]);
		assert.ok(prompts[1].title!.includes(externalPath));
		assert.strictEqual(JSON.parse(fs.readFileSync(externalPath, 'utf8')).exclusionFilters[0].regex, 'CHANGED');
		assert.strictEqual(fs.readFileSync(internalPath, 'utf8'), internalBefore);
	});

	test('creation prompts assign groups, regular filters, exclusions, and projects to the chosen file', async () => {
		const externalPath = path.join(storagePath, 'external.json');
		await manager.saveProjectSettings(externalPath, createSavedState());
		const state = createState();
		await manager.initializeFiles(state);
		const internalPath = getSettingFile(state.globalStorageUri);
		const inputs = ['Internal Group', 'INTERNAL', 'EXTERNAL NOISE', 'New Project'];
		vscode.window.showInputBox = async () => inputs.shift();
		setPromptAnswers([internalPath, internalPath, externalPath, externalPath]);
		await addGroup(state);
		assert.ok(manager.selectedProject(internalPath, state).groups.some(group => group.name === 'Internal Group'));
		const externalGroup = state.groups.find(group => group.sourcePath === externalPath)!;
		await addFilter({ id: externalGroup.id } as vscode.TreeItem, state);
		assert.strictEqual(externalGroup.filters.length, 1);
		assert.ok(manager.selectedProject(internalPath, state).groups.some(group => group.filters.some(filter => filter.regex.source === 'INTERNAL')));
		await addExFilter(state);
		assert.strictEqual(state.exFilters[state.exFilters.length - 1].sourcePath, externalPath);
		await addProject(state);
		assert.strictEqual(state.projects.find(project => project.name === 'New Project')!.sourcePath, externalPath);
		assert.strictEqual(await manager.saveFile(internalPath, state), true);
		assert.strictEqual(await manager.saveFile(externalPath, state), true);
		const restored = createState();
		await new ProjectSettingsManager(context).initializeFiles(restored);
		assert.ok(restored.groups.find(group => group.sourcePath === internalPath && group.name === 'Internal Group'));
		assert.ok(restored.exFilters.some(filter => filter.regex.source === 'EXTERNAL NOISE' && filter.sourcePath === externalPath));
	});

	test('unload cancel preserves unsaved changes; discard removes only the chosen source', async () => {
		const externalPath = path.join(storagePath, 'external.json');
		await manager.saveProjectSettings(externalPath, createSavedState());
		const state = createState();
		await manager.initializeFiles(state);
		const before = fs.readFileSync(externalPath, 'utf8');
		state.groups[0].filters[0].regex = /UNSAVED/;
		vscode.window.showWarningMessage = (async () => 'Cancel') as typeof vscode.window.showWarningMessage;
		await unloadSharedFilterFile(context, state, externalPath);
		assert.strictEqual(state.groups[0].filters[0].regex.source, 'UNSAVED');
		assert.ok(manager.getLoadedSettingsPaths().includes(externalPath));
		vscode.window.showWarningMessage = (async () => 'Discard and Unload') as typeof vscode.window.showWarningMessage;
		await unloadSharedFilterFile(context, state, externalPath);
		assert.strictEqual(state.groups.length, 0);
		assert.strictEqual(state.exFilters.length, 0);
		assert.ok(state.projects.some(project => project.sourcePath === getSettingFile(state.globalStorageUri)));
		assert.strictEqual(fs.readFileSync(externalPath, 'utf8'), before);
	});

	test('save-and-unload persists changes, while reload cancellation preserves them', async () => {
		const externalPath = path.join(storagePath, 'external.json');
		await manager.saveProjectSettings(externalPath, createSavedState());
		const state = createState();
		await manager.initializeFiles(state);
		state.exFilters[0].regex = /SAVED/;
		vscode.window.showWarningMessage = (async () => 'Cancel') as typeof vscode.window.showWarningMessage;
		await refreshProjectSettings(context, state, externalPath);
		assert.strictEqual(state.exFilters[0].regex.source, 'SAVED');
		vscode.window.showWarningMessage = (async () => 'Save and Unload') as typeof vscode.window.showWarningMessage;
		await unloadSharedFilterFile(context, state, externalPath);
		assert.strictEqual(state.exFilters.length, 0);
		assert.strictEqual(JSON.parse(fs.readFileSync(externalPath, 'utf8')).exclusionFilters[0].regex, 'SAVED');
	});

	test('load dialog accepts multiple files and loading an already loaded file preserves edits', async () => {
		const firstPath = path.join(storagePath, 'first.json');
		const secondPath = path.join(storagePath, 'second.json');
		await manager.saveProjectSettings(firstPath, createSavedState());
		await manager.saveProjectSettings(secondPath, createSavedState());
		await manager.clearSettingsPath();
		const state = createState();
		await manager.initializeFiles(state);
		vscode.window.showOpenDialog = async options => {
			assert.strictEqual(options!.canSelectMany, true);
			return [vscode.Uri.file(firstPath), vscode.Uri.file(secondPath)];
		};
		await loadProjectSettings(context, state);
		assert.strictEqual(state.groups.length, 2);
		state.groups[0].filters[0].regex = /KEEP/;
		await loadProjectSettings(context, state);
		assert.strictEqual(state.groups.length, 2);
		assert.strictEqual(state.groups[0].filters[0].regex.source, 'KEEP');
	});

	test('switching and deleting projects or groups do not affect another source', async () => {
		const firstPath = path.join(storagePath, 'first.json');
		const secondPath = path.join(storagePath, 'second.json');
		const first = createSavedState();
		first.projects.push(deserializeProject({ name: 'Alternative', groups: [] }));
		await manager.saveProjectSettings(firstPath, first);
		await manager.saveProjectSettings(secondPath, createSavedState());
		const state = createState();
		await manager.initializeFiles(state);
		const secondGroup = state.groups.find(group => group.sourcePath === secondPath)!;
		const alternative = state.projects.find(project => project.name === 'Alternative')!;
		assert.strictEqual(selectProject({ id: alternative.id } as vscode.TreeItem, state), true);
		assert.ok(state.groups.includes(secondGroup));
		assert.strictEqual(secondGroup.filters[0].isHighlighted, true);
		deleteProject({ id: alternative.id } as vscode.TreeItem, state);
		assert.ok(state.groups.includes(secondGroup));
		const firstGroup = state.groups.find(group => group.sourcePath === firstPath)!;
		deleteGroup({ id: firstGroup.id } as vscode.TreeItem, state);
		assert.strictEqual(manager.selectedProject(firstPath, state).groups.length, 0);
		assert.ok(state.groups.includes(secondGroup));
	});

	test('failed save-and-unload keeps the source loaded with its unsaved filters', async () => {
		const filePath = path.join(storagePath, 'external.json');
		await manager.saveProjectSettings(filePath, createSavedState());
		const state = createState();
		await manager.initializeFiles(state);
		state.exFilters[0].regex = /KEEP/;
		fs.writeFileSync(filePath, '{broken');
		vscode.window.showWarningMessage = (async () => 'Save and Unload') as typeof vscode.window.showWarningMessage;
		await unloadSharedFilterFile(context, state, filePath);
		assert.ok(manager.getLoadedSettingsPaths().includes(filePath));
		assert.strictEqual(state.exFilters[0].regex.source, 'KEEP');
		assert.strictEqual(fs.readFileSync(filePath, 'utf8'), '{broken');
	});

	test('external settings are applied explicitly and the selected settings source survives restart', async () => {
		const filePath = path.join(storagePath, 'external.json');
		await manager.saveProjectSettings(filePath, createSavedState());
		const settings = JSON.parse(fs.readFileSync(filePath, 'utf8'));
		settings.maxEditorsToProcess = 4;
		fs.writeFileSync(filePath, JSON.stringify(settings));
		const config = vscode.workspace.getConfiguration('logAnalysisGamma');
		await config.update('maxEditorsToProcess', 2, vscode.ConfigurationTarget.Global);
		const state = createState();
		await manager.initializeFiles(state);
		assert.strictEqual(vscode.workspace.getConfiguration('logAnalysisGamma').get('maxEditorsToProcess'), 2);
		assert.strictEqual(await manager.applyFileConfiguration(filePath), true);
		assert.strictEqual(vscode.workspace.getConfiguration('logAnalysisGamma').get('maxEditorsToProcess'), 4);
		await config.update('maxEditorsToProcess', 1, vscode.ConfigurationTarget.Global);
		await new ProjectSettingsManager(context).initializeFiles(createState());
		assert.strictEqual(vscode.workspace.getConfiguration('logAnalysisGamma').get('maxEditorsToProcess'), 4);
	});

	test('migrates the legacy external path and shows unavailable remembered files', async () => {
		const filePath = path.join(storagePath, 'missing.json');
		await context.globalState.update('lastProjectSettingsPath', filePath);
		const restored = new ProjectSettingsManager(context);
		assert.deepStrictEqual(restored.getLoadedSettingsPaths(), [filePath]);
		const state = createState();
		await restored.initializeFiles(state);
		const rows = new StorageFilesTreeViewProvider(restored, state).getChildren();
		assert.strictEqual(rows[1].description, filePath);
		assert.strictEqual(rows[1].contextValue, 'external-unavailable');
		assert.ok(String(rows[1].tooltip).includes('ENOENT'));
		await restored.unloadFile(filePath, state);
		assert.strictEqual(restored.getFiles(state).length, 1);
	});

	test('internal storage preserves projects, exclusions, flags, and toggles', () => {
		const original = createSavedState();
		saveSettings(vscode.Uri.file(storagePath), original.projects, original.exFilters);
		const exclusions: Filter[] = [];
		const projects = readSettings(vscode.Uri.file(storagePath), exclusions);
		assert.deepStrictEqual(projects, original.projects);
		assert.deepStrictEqual(exclusions, original.exFilters);
	});

	test('remembers multiple files, deduplicates paths, and unloads only the chosen file', async () => {
		const firstPath = path.join(storagePath, 'first.json');
		const secondPath = path.join(storagePath, 'second.json');
		await manager.setSettingsPath(firstPath);
		await manager.setSettingsPath(secondPath);
		await manager.setSettingsPath(firstPath);
		assert.deepStrictEqual(manager.getLoadedSettingsPaths(), [firstPath, secondPath]);
		const restored = new ProjectSettingsManager(context);
		assert.deepStrictEqual(restored.getLoadedSettingsPaths(), [firstPath, secondPath]);
		await restored.clearSettingsPath(firstPath);
		assert.deepStrictEqual(new ProjectSettingsManager(context).getLoadedSettingsPaths(), [secondPath]);
		await restored.clearSettingsPath(secondPath);
		assert.deepStrictEqual(new ProjectSettingsManager(context).getLoadedSettingsPaths(), []);
	});

	test('loads multiple sources together without ID collisions or cross-file saves', async () => {
		const firstPath = path.join(storagePath, 'first.json');
		const secondPath = path.join(storagePath, 'second.json');
		await manager.saveProjectSettings(firstPath, createSavedState());
		await manager.saveProjectSettings(secondPath, createSavedState());
		const state = createState();
		await manager.initializeFiles(state);
		assert.strictEqual(manager.getFiles(state).length, 3);
		assert.strictEqual(state.groups.length, 2);
		assert.strictEqual(state.exFilters.length, 2);
		assert.notStrictEqual(state.groups[0].id, state.groups[1].id);
		const secondContent = fs.readFileSync(secondPath, 'utf8');
		const internalContent = fs.readFileSync(getSettingFile(state.globalStorageUri), 'utf8');
		const firstFilter = state.groups.find(group => group.sourcePath === firstPath)!.filters[0];
		firstFilter.regex = /FIRST/i;
		assert.strictEqual(manager.isDirty(firstPath, state), true);
		assert.strictEqual(manager.isDirty(secondPath, state), false);
		assert.strictEqual(await manager.saveFile(firstPath, state, 'filters'), true);
		assert.strictEqual(manager.isDirty(firstPath, state), false);
		assert.strictEqual(JSON.parse(fs.readFileSync(firstPath, 'utf8')).projects[0].groups[0].filters[0].regex, 'FIRST');
		assert.strictEqual(fs.readFileSync(secondPath, 'utf8'), secondContent);
		assert.strictEqual(fs.readFileSync(getSettingFile(state.globalStorageUri), 'utf8'), internalContent);
		await manager.unloadFile(firstPath, state);
		assert.strictEqual(state.groups.length, 1);
		assert.strictEqual(state.exFilters.length, 1);
		assert.strictEqual(state.groups[0].sourcePath, secondPath);
		assert.deepStrictEqual(new ProjectSettingsManager(context).getLoadedSettingsPaths(), [secondPath]);
		const restoredState = createState();
		await new ProjectSettingsManager(context).initializeFiles(restoredState);
		assert.strictEqual(restoredState.groups.length, 1);
		assert.strictEqual(restoredState.groups[0].sourcePath, secondPath);
	});

	test('partial saves preserve untouched sections in internal and external files', async () => {
		const externalPath = path.join(storagePath, 'external.json');
		await manager.saveProjectSettings(externalPath, createSavedState());
		const original = createSavedState();
		saveSettings(vscode.Uri.file(storagePath), original.projects, original.exFilters);
		const state = createState();
		await manager.initializeFiles(state);
		for (const filePath of [getSettingFile(state.globalStorageUri), externalPath]) {
			const before = JSON.parse(fs.readFileSync(filePath, 'utf8'));
			before.customMetadata = { team: 'operations' };
			before.maxEditorsToProcess = 2;
			fs.writeFileSync(filePath, JSON.stringify(before));
			state.groups.find(group => group.sourcePath === filePath)!.filters[0].regex = /CHANGED/;
			state.exFilters.find(filter => filter.sourcePath === filePath)!.regex = /NOISE/;
			assert.strictEqual(await manager.saveFile(filePath, state, 'filters'), true);
			const filtersOnly = JSON.parse(fs.readFileSync(filePath, 'utf8'));
			assert.deepStrictEqual(filtersOnly.exclusionFilters, before.exclusionFilters);
			assert.strictEqual(filtersOnly.maxEditorsToProcess, 2);
			assert.strictEqual(manager.isDirty(filePath, state), true);
			assert.strictEqual(await manager.saveFile(filePath, state, 'exclusions'), true);
			const exclusionsOnly = JSON.parse(fs.readFileSync(filePath, 'utf8'));
			assert.deepStrictEqual(exclusionsOnly.projects, filtersOnly.projects);
			assert.strictEqual(exclusionsOnly.exclusionFilters[0].regex, 'NOISE');
			assert.strictEqual(manager.isDirty(filePath, state), false);
			await vscode.workspace.getConfiguration('logAnalysisGamma').update('maxEditorsToProcess', 4, vscode.ConfigurationTarget.Global);
			assert.strictEqual(await manager.saveFile(filePath, state, 'settings'), true);
			const settingsOnly = JSON.parse(fs.readFileSync(filePath, 'utf8'));
			assert.deepStrictEqual(settingsOnly.projects, exclusionsOnly.projects);
			assert.deepStrictEqual(settingsOnly.exclusionFilters, exclusionsOnly.exclusionFilters);
			assert.strictEqual(settingsOnly.maxEditorsToProcess, 4);
			assert.deepStrictEqual(settingsOnly.customMetadata, { team: 'operations' });
			await vscode.workspace.getConfiguration('logAnalysisGamma').update('maxEditorsToProcess', 1, vscode.ConfigurationTarget.Global);
			assert.strictEqual(await manager.applyFileConfiguration(filePath), true);
			assert.strictEqual(vscode.workspace.getConfiguration('logAnalysisGamma').get('maxEditorsToProcess'), 4);
		}
	});

	test('invalid source loading and saving leave other files and live filters unchanged', async () => {
		const validPath = path.join(storagePath, 'valid.json');
		await manager.saveProjectSettings(validPath, createSavedState());
		const state = createState();
		await manager.initializeFiles(state);
		const originalGroup = state.groups[0];
		const invalidPath = path.join(storagePath, 'invalid.json');
		fs.writeFileSync(invalidPath, '{"exclusionFilters":[{"regex":{}}]}');
		assert.strictEqual(await manager.loadFile(invalidPath, state), false);
		assert.strictEqual(state.groups[0], originalGroup);
		assert.ok(!manager.getLoadedSettingsPaths().includes(invalidPath));
		assert.strictEqual(await manager.saveFile(invalidPath, state), false);
		assert.strictEqual(fs.readFileSync(invalidPath, 'utf8'), '{"exclusionFilters":[{"regex":{}}]}');
		fs.writeFileSync(validPath, '{broken');
		assert.strictEqual(await manager.loadFile(validPath, state), false);
		assert.strictEqual(state.groups[0], originalGroup);
		assert.strictEqual(await manager.saveFile(validPath, state), false);
		assert.strictEqual(fs.readFileSync(validPath, 'utf8'), '{broken');
	});

	test('new files never overwrite an existing file and internal storage cannot be unloaded', async () => {
		const state = createState();
		await manager.initializeFiles(state);
		const filePath = path.join(storagePath, 'new.json');
		assert.strictEqual(await manager.createFile(filePath, state), true);
		const before = fs.readFileSync(filePath, 'utf8');
		assert.strictEqual(await manager.createFile(filePath, state), false);
		assert.strictEqual(fs.readFileSync(filePath, 'utf8'), before);
		await manager.unloadFile(getSettingFile(state.globalStorageUri), state);
		assert.ok(manager.getFiles(state).find(file => file.internal)!.loaded);
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
