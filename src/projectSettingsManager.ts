import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import type { State } from './extension';
import { StoredFilter, StoredProject, deserializeFilter, deserializeProject, getSettingFile, saveSettings, serializeFilter, serializeProject } from './settings';
import { Filter, Group, Project } from './utils';
import { TimeProfile, validateTimeProfile } from './timeFilter';

export type SaveSection = 'all' | 'filters' | 'exclusions' | 'settings' | 'filterData';
export type StorageFile = { path: string; internal: boolean; loaded: boolean; dirty: boolean; error?: string };
const configurationKeys = ['editorSelectionStrategy', 'maxEditorsToProcess', 'autoDetectLogFiles',
    'showRandomColorNotifications', 'maxRememberedColors', 'relevantFileExtensions', 'userColors', 'contextBefore', 'contextAfter', 'timeProfiles', 'processingTimeoutMs'] as const;

function decodeSettings(settings: ProjectSettings): { projects: Project[]; exclusions: Filter[] } {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
        throw new Error('Expected a project settings object');
    }
    if (settings.timeProfiles !== undefined) {
        if (!settings.timeProfiles || typeof settings.timeProfiles !== 'object' || Array.isArray(settings.timeProfiles)) {
            throw new Error('Expected document time profiles');
        }
        Object.values(settings.timeProfiles).forEach(validateTimeProfile);
    }
    for (const key of ['projects', 'filters', 'exclusionFilters'] as const) {
        if (settings[key] !== undefined && !Array.isArray(settings[key])) {
            throw new Error(`Expected an array for ${key}`);
        }
    }
    const projects = (settings.projects || []).map(deserializeProject);
    const directFilters = settings.filters || [];
    const exclusions = [...(settings.exclusionFilters || []), ...directFilters.filter(filter => filter.isExclusionFilter)]
        .map(filter => deserializeFilter(filter, true));
    const filters = directFilters.filter(filter => !filter.isExclusionFilter).map(filter => deserializeFilter(filter));
    if (projects.length === 0) {
        projects.push(deserializeProject({ name: 'NONAME', groups: [] }));
    }
    const selectedProject = projects.find(project => project.selected) || projects[0];
    projects.forEach(project => project.selected = project === selectedProject);
    if (filters.length > 0) {
        selectedProject.groups.push({
            id: `${Math.random()}`, name: 'Shared Filters',
            isHighlighted: filters.some(filter => filter.isHighlighted),
            isShown: filters.some(filter => filter.isShown), filters
        });
    }
    return { projects, exclusions };
}

export interface ProjectSettings {
    timeProfiles?: Record<string, TimeProfile>;
    processingTimeoutMs?: number;
    contextBefore?: number;
    contextAfter?: number;
    relevantFileExtensions?: string[];
    userColors?: string[];
    editorSelectionStrategy: 'active' | 'visible' | 'relevant' | 'adaptive';
    maxEditorsToProcess: number;
    autoDetectLogFiles: boolean;
    showRandomColorNotifications: boolean;
    maxRememberedColors: number;
    // Internal projects system (from the old vscode_log_analysis.json)
    projects: StoredProject[];
    // Direct filters (new external system)
    filters: StoredFilter[];
    exclusionFilters: StoredFilter[];
}

export class ProjectSettingsManager {
    private static instance: ProjectSettingsManager;
    private currentSettingsPath: string | undefined;
    private loadedSettingsPaths: string[];
    private context: vscode.ExtensionContext;
    private sources = new Map<string, { projects: StoredProject[]; exclusions: StoredFilter[] }>();
    private fileErrors = new Map<string, string>();
    private fileChangeEmitter = new vscode.EventEmitter<void>();
    readonly onDidChangeFiles = this.fileChangeEmitter.event;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        // Restore last used settings path
        this.currentSettingsPath = context.globalState.get('lastProjectSettingsPath');
        const remembered = context.globalState.get<string[]>('loadedProjectSettingsPaths');
        this.loadedSettingsPaths = [...new Set((remembered || (this.currentSettingsPath ? [this.currentSettingsPath] : []))
            .map(filePath => path.resolve(filePath)))];
        const lastPath = this.currentSettingsPath ? path.resolve(this.currentSettingsPath) : undefined;
        this.currentSettingsPath = lastPath && this.loadedSettingsPaths.includes(lastPath)
            ? lastPath : this.loadedSettingsPaths[this.loadedSettingsPaths.length - 1];
    }

    static getInstance(context?: vscode.ExtensionContext): ProjectSettingsManager {
        if (!ProjectSettingsManager.instance && context) {
            ProjectSettingsManager.instance = new ProjectSettingsManager(context);
        }
        return ProjectSettingsManager.instance;
    }

    /**
     * Get the current project settings file path
     */
    getCurrentSettingsPath(): string | undefined {
        return this.currentSettingsPath;
    }

    getLoadedSettingsPaths(): string[] {
        return [...this.loadedSettingsPaths];
    }

    getFiles(state: State): StorageFile[] {
        const paths = [...new Set([getSettingFile(state.globalStorageUri), ...this.loadedSettingsPaths])];
        return paths.map(filePath => ({
            path: filePath, internal: filePath === getSettingFile(state.globalStorageUri),
            loaded: this.sources.has(filePath), dirty: this.isDirty(filePath, state),
            error: this.fileErrors.get(filePath)
        }));
    }

    refreshFiles(): void {
        this.fileChangeEmitter.fire();
    }

    private fileContent(filePath: string, state: State) {
        return {
            projects: state.projects.filter(project => project.sourcePath === filePath).map(serializeProject),
            exclusions: state.exFilters.filter(filter => filter.sourcePath === filePath).map(serializeFilter)
        };
    }

    isDirty(filePath: string, state: State): boolean {
        const saved = this.sources.get(filePath);
        return saved !== undefined && JSON.stringify(saved) !== JSON.stringify(this.fileContent(filePath, state));
    }

    async initializeFiles(state: State): Promise<void> {
        state.settingsManager = this;
        state.projectTreeViewProvider.setSources(() => this.getFiles(state));
        const internalPath = getSettingFile(state.globalStorageUri);
        if (!fs.existsSync(internalPath)) {
            saveSettings(state.globalStorageUri, [], []);
        }
        await this.loadFile(internalPath, state, true);
        for (const filePath of this.getLoadedSettingsPaths()) {
            if (filePath !== internalPath) {
                await this.loadFile(filePath, state);
            }
        }
        const configurationPath = this.context.globalState.get<string>('configurationProjectSettingsPath');
        if (configurationPath && configurationPath !== internalPath && this.sources.has(configurationPath)) {
            await this.applyFileConfiguration(configurationPath);
        }
    }

    async loadFile(filePath: string, state: State, applyConfiguration = false): Promise<boolean> {
        const targetPath = path.resolve(filePath);
        try {
            const settings: ProjectSettings = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
            const { projects, exclusions } = decodeSettings(settings);
            if (applyConfiguration) {
                await this.applyConfiguration(settings);
            }
            for (const project of projects) {
                project.sourcePath = targetPath;
                project.id = `${Math.random()}`;
                for (const group of project.groups) {
                    group.sourcePath = targetPath;
                    group.id = `${Math.random()}`;
                    for (const filter of group.filters) {
                        filter.sourcePath = targetPath;
                        filter.id = `${Math.random()}`;
                    }
                }
            }
            exclusions.forEach(filter => { filter.sourcePath = targetPath; filter.id = `${Math.random()}`; });
            state.projects.splice(0, state.projects.length,
                ...state.projects.filter(project => project.sourcePath !== targetPath), ...projects);
            state.exFilters.splice(0, state.exFilters.length,
                ...state.exFilters.filter(filter => filter.sourcePath !== targetPath), ...exclusions);
            this.sources.set(targetPath, this.fileContent(targetPath, state));
            this.fileErrors.delete(targetPath);
            if (targetPath !== getSettingFile(state.globalStorageUri)) {
                await this.setSettingsPath(targetPath);
            }
            state.filterHistory?.clear();
            this.updateState(state);
            return true;
        } catch (error) {
            this.fileErrors.set(targetPath, String(error));
            this.refreshFiles();
            vscode.window.showErrorMessage(`Could not load ${targetPath}: ${error}`);
            return false;
        }
    }

    updateState(state: State): void {
        state.groups = state.projects.filter(project => project.selected)
            .reduce<Group[]>((groups, project) => groups.concat(project.groups), []);
        state.projectTreeViewProvider.update(state.projects);
        state.filterTreeViewProvider.update(state.groups);
        state.exFilterTreeViewProvider.refresh();
        state.focusProvider.update(state.groups);
        this.refreshFiles();
    }

    selectedProject(filePath: string, state: State): Project {
        const project = state.projects.find(candidate => candidate.sourcePath === filePath && candidate.selected);
        if (!project) {
            throw new Error(`No selected project for ${filePath}`);
        }
        return project;
    }

    async unloadFile(filePath: string, state: State): Promise<void> {
        const targetPath = path.resolve(filePath);
        if (targetPath === getSettingFile(state.globalStorageUri)) {
            return;
        }
        state.projects.splice(0, state.projects.length, ...state.projects.filter(project => project.sourcePath !== targetPath));
        state.exFilters.splice(0, state.exFilters.length, ...state.exFilters.filter(filter => filter.sourcePath !== targetPath));
        this.sources.delete(targetPath);
        this.fileErrors.delete(targetPath);
        await this.clearSettingsPath(targetPath);
        state.filterHistory?.clear();
        this.updateState(state);
    }

    async saveAllChangedFiles(state: State): Promise<{ saved: string[]; failed: string[] }> {
        const result: { saved: string[]; failed: string[] } = { saved: [], failed: [] };
        for (const file of this.getFiles(state).filter(candidate => candidate.loaded && candidate.dirty)) {
            const success = await this.saveFile(file.path, state, 'filterData', true);
            (success ? result.saved : result.failed).push(file.path);
        }
        return result;
    }

    async saveFile(filePath: string, state: State, section: SaveSection = 'all', quiet = false): Promise<boolean> {
        const targetPath = path.resolve(filePath);
        try {
            const saved = this.sources.get(targetPath);
            if (!saved) {
                throw new Error('Load this file successfully before saving to it');
            }
            const settings: ProjectSettings = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
            decodeSettings(settings);
            const current = this.fileContent(targetPath, state);
            const nextSaved = { ...saved };
            if (section === 'all' || section === 'filterData' || section === 'filters') {
                settings.projects = current.projects;
                settings.filters = (settings.filters || []).filter(filter => filter.isExclusionFilter);
                nextSaved.projects = current.projects;
            }
            if (section === 'all' || section === 'filterData' || section === 'exclusions') {
                settings.exclusionFilters = current.exclusions;
                settings.filters = (settings.filters || []).filter(filter => !filter.isExclusionFilter);
                nextSaved.exclusions = current.exclusions;
            }
            if (section === 'all' || section === 'settings') {
                Object.assign(settings, this.currentConfiguration());
            }
            fs.writeFileSync(targetPath, JSON.stringify(settings, null, 2), 'utf8');
            this.sources.set(targetPath, nextSaved);
            this.fileErrors.delete(targetPath);
            this.refreshFiles();
            if (!quiet) {
                vscode.window.showInformationMessage(`Saved ${section} to ${targetPath}`);
            }
            return true;
        } catch (error) {
            vscode.window.showErrorMessage(`Could not save ${targetPath}: ${error}`);
            return false;
        }
    }

    async createFile(filePath: string, state: State): Promise<boolean> {
        try {
            const settings = { ...this.currentConfiguration(), projects: [], filters: [], exclusionFilters: [] };
            fs.writeFileSync(filePath, JSON.stringify(settings, null, 2), { encoding: 'utf8', flag: 'wx' });
            return await this.loadFile(filePath, state);
        } catch (error) {
            vscode.window.showErrorMessage(`Could not create ${filePath}: ${error}`);
            return false;
        }
    }

    async applyFileConfiguration(filePath: string): Promise<boolean> {
        try {
            const settings: ProjectSettings = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            decodeSettings(settings);
            await this.applyConfiguration(settings);
            await this.context.globalState.update('configurationProjectSettingsPath', path.resolve(filePath));
            return true;
        } catch (error) {
            vscode.window.showErrorMessage(`Could not apply settings from ${filePath}: ${error}`);
            return false;
        }
    }

    private currentConfiguration(): Record<string, unknown> {
        const config = vscode.workspace.getConfiguration('logAnalysisGamma');
        const settings: Record<string, unknown> = {};
        configurationKeys.forEach(key => settings[key] = config.get(key));
        return settings;
    }

    private async applyConfiguration(settings: ProjectSettings): Promise<void> {
        const config = vscode.workspace.getConfiguration('logAnalysisGamma');
        for (const key of configurationKeys) {
            if (settings[key] !== undefined) {
                await config.update(key, settings[key], vscode.ConfigurationTarget.Global);
            }
        }
    }

    /**
     * Set and remember the project settings file path
     */
    async setSettingsPath(filePath: string): Promise<void> {
        const normalized = path.resolve(filePath);
        if (!this.loadedSettingsPaths.includes(normalized)) {
            this.loadedSettingsPaths.push(normalized);
        }
        this.currentSettingsPath = normalized;
        await this.context.globalState.update('loadedProjectSettingsPaths', this.loadedSettingsPaths);
        await this.context.globalState.update('lastProjectSettingsPath', normalized);
    }

    /**
     * Clear the remembered project settings file path
     */
    async clearSettingsPath(filePath?: string): Promise<void> {
        this.loadedSettingsPaths = filePath
            ? this.loadedSettingsPaths.filter(loadedPath => loadedPath !== path.resolve(filePath))
            : [];
        this.currentSettingsPath = this.loadedSettingsPaths[this.loadedSettingsPaths.length - 1];
        await this.context.globalState.update('loadedProjectSettingsPaths', this.loadedSettingsPaths);
        await this.context.globalState.update('lastProjectSettingsPath', this.currentSettingsPath);
    }

    /**
     * Load project settings from file
     */
    async loadProjectSettings(filePath?: string): Promise<ProjectSettings | undefined> {
        const targetPath = filePath || this.currentSettingsPath;
        
        if (!targetPath) {
            vscode.window.showWarningMessage('No project settings file path specified');
            return undefined;
        }

        try {
            if (!fs.existsSync(targetPath)) {
                vscode.window.showWarningMessage(`Project settings file not found: ${targetPath}`);
                return undefined;
            }

            const content = fs.readFileSync(targetPath, 'utf8');
            const settings: ProjectSettings = JSON.parse(content);
            
            // Remember this path for future use
            await this.setSettingsPath(targetPath);
            
            vscode.window.showInformationMessage(`$(check) Loaded project settings from: ${path.basename(targetPath)}`);
            return settings;
            
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to load project settings: ${error}`);
            return undefined;
        }
    }

    /**
     * Save current VS Code settings to project file
     */
    async saveProjectSettings(filePath?: string, currentState?: Pick<State, 'projects' | 'groups' | 'exFilters'>): Promise<boolean> {
        const targetPath = filePath || this.currentSettingsPath;
        
        if (!targetPath) {
            vscode.window.showWarningMessage('No project settings file path specified');
            return false;
        }

        try {
            // Get current VS Code configuration
            const config = vscode.workspace.getConfiguration('logAnalysisGamma');
            
            // Convert current filters from state if provided
            const filters: StoredFilter[] = [];
            const exclusionFilters = currentState?.exFilters.map(serializeFilter) || [];

            // Convert internal projects if provided
            const projects = currentState?.projects.map(serializeProject) || [];
            
            const projectSettings: ProjectSettings = {
                editorSelectionStrategy: config.get('editorSelectionStrategy', 'adaptive'),
                maxEditorsToProcess: config.get('maxEditorsToProcess', 3),
                autoDetectLogFiles: config.get('autoDetectLogFiles', true),
                showRandomColorNotifications: config.get('showRandomColorNotifications', true),
                maxRememberedColors: config.get('maxRememberedColors', 10),
                projects: projects,
                filters: filters,
                exclusionFilters: exclusionFilters
            };

            // Ensure directory exists
            const dir = path.dirname(targetPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            // Save to file with nice formatting
            fs.writeFileSync(targetPath, JSON.stringify(projectSettings, null, 2), 'utf8');
            
            // Remember this path
            await this.setSettingsPath(targetPath);
            
            vscode.window.showInformationMessage(`$(save) Saved project settings to: ${path.basename(targetPath)} (${filters.length} filters, ${exclusionFilters.length} exclusions)`);
            return true;
            
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to save project settings: ${error}`);
            return false;
        }
    }

    /**
     * Apply project settings to current VS Code configuration and state
     */
    async applyProjectSettings(settings: ProjectSettings, currentState?: State): Promise<boolean> {
        try {
            const { projects, exclusions } = decodeSettings(settings);
            const selectedProject = projects.find(project => project.selected)!;
            
            // Apply configuration settings
            await this.applyConfiguration(settings);

            // Apply filters to current state if provided
            if (currentState) {
                currentState.projects.splice(0, currentState.projects.length, ...projects);
                currentState.groups = selectedProject.groups;
                currentState.exFilters.splice(0, currentState.exFilters.length, ...exclusions);
                currentState.projectTreeViewProvider.update(currentState.projects);
                currentState.filterTreeViewProvider.update(currentState.groups);
                currentState.exFilterTreeViewProvider.refresh();
                currentState.focusProvider.update(currentState.groups);
            }
            
            vscode.window.showInformationMessage(`$(check) Applied unified project settings (${settings.projects?.length || 0} projects, ${settings.filters?.length || 0} filters, ${settings.exclusionFilters?.length || 0} exclusions)`);
            return true;
            
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to apply project settings: ${error}`);
            return false;
        }
    }

    /**
     * Refresh settings from file (manual reload)
     */
    async refreshProjectSettings(currentState?: State): Promise<void> {
        if (!this.currentSettingsPath) {
            vscode.window.showWarningMessage('No project settings file to refresh');
            return;
        }

        const settings = await this.loadProjectSettings();
        if (settings && await this.applyProjectSettings(settings, currentState)) {
            vscode.window.showInformationMessage(`$(refresh) Refreshed project settings from: ${path.basename(this.currentSettingsPath)}`);
        }
    }

    /**
     * Create a new project settings file with current configuration
     */
    async createNewProjectSettings(): Promise<void> {
        const options: vscode.SaveDialogOptions = {
            defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri,
            filters: {
                'JSON Files': ['json'],
                'All Files': ['*']
            },
            saveLabel: 'Create Project Settings'
        };

        const fileUri = await vscode.window.showSaveDialog(options);
        if (fileUri) {
            await this.saveProjectSettings(fileUri.fsPath);
        }
    }

    /**
     * Load existing project settings file
     */
    async loadExistingProjectSettings(): Promise<void> {
        const options: vscode.OpenDialogOptions = {
            canSelectMany: false,
            openLabel: 'Load Project Settings',
            filters: {
                'JSON Files': ['json'],
                'All Files': ['*']
            }
        };

        const fileUri = await vscode.window.showOpenDialog(options);
        if (fileUri && fileUri[0]) {
            const settings = await this.loadProjectSettings(fileUri[0].fsPath);
            if (settings) {
                await this.applyProjectSettings(settings);
            }
        }
    }

    /**
     * Import existing internal projects from VS Code storage
     */
    async importInternalProjects(currentState?: any): Promise<void> {
        if (!currentState?.projects) {
            vscode.window.showWarningMessage('No internal projects found to import');
            return;
        }

        const internalProjects = currentState.projects;
        if (!internalProjects || internalProjects.length === 0) {
            vscode.window.showInformationMessage('No internal projects to import');
            return;
        }

        const choice = await vscode.window.showQuickPick([
            {
                label: "Create New Unified Settings File",
                description: "Export internal projects to new external file",
                detail: "Create a new shareable file with your internal projects"
            },
            {
                label: "Add to Existing Settings File", 
                description: "Merge with current external project settings",
                detail: "Add internal projects to currently loaded external file"
            }
        ], {
            placeHolder: "How would you like to export your internal projects?",
            title: "Import Internal Projects"
        });

        if (choice?.label === "Create New Unified Settings File") {
            await this.createUnifiedProjectSettings(currentState);
        } else if (choice?.label === "Add to Existing Settings File") {
            if (this.currentSettingsPath) {
                await this.mergeWithExistingSettings(currentState);
            } else {
                vscode.window.showWarningMessage('No external settings file loaded. Please load a settings file first.');
            }
        }
    }

    /**
     * Create a new unified settings file with internal projects
     */
    private async createUnifiedProjectSettings(currentState: any): Promise<void> {
        const options: vscode.SaveDialogOptions = {
            defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri,
            filters: {
                'JSON Files': ['json'],
                'All Files': ['*']
            },
            saveLabel: 'Create Unified Project Settings'
        };

        const fileUri = await vscode.window.showSaveDialog(options);
        if (fileUri) {
            await this.saveProjectSettings(fileUri.fsPath, currentState);
            vscode.window.showInformationMessage(`$(check) Created unified project settings with ${currentState.projects?.length || 0} internal projects`);
        }
    }

    /**
     * Merge internal projects with existing external settings
     */
    private async mergeWithExistingSettings(currentState: any): Promise<void> {
        const existingSettings = await this.loadProjectSettings();
        if (existingSettings) {
            // Merge projects
            const mergedProjects = [...(existingSettings.projects || []).map(deserializeProject), ...(currentState.projects || [])];
            
            // Update current state with merged data
            const mergedState = {
                ...currentState,
                projects: mergedProjects
            };

            await this.saveProjectSettings(undefined, mergedState);
            vscode.window.showInformationMessage(`$(check) Merged ${currentState.projects?.length || 0} internal projects with existing settings`);
        }
    }

    /**
     * Get project settings file status info
     */
    getSettingsFileInfo(): { path?: string; exists: boolean; lastModified?: Date } {
        if (!this.currentSettingsPath) {
            return { exists: false };
        }

        try {
            const stats = fs.statSync(this.currentSettingsPath);
            return {
                path: this.currentSettingsPath,
                exists: true,
                lastModified: stats.mtime
            };
        } catch {
            return { path: this.currentSettingsPath, exists: false };
        }
    }
}