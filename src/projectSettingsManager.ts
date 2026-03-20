import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export interface ProjectSettings {
    editorSelectionStrategy: 'active' | 'visible' | 'relevant' | 'adaptive';
    maxEditorsToProcess: number;
    autoDetectLogFiles: boolean;
    showRandomColorNotifications: boolean;
    maxRememberedColors: number;
    // Internal projects system (from the old vscode_log_analysis.json)
    projects: Array<{
        id?: string;
        name: string;
        selected?: boolean;
        groups: Array<{
            id?: string;
            name: string;
            filters: Array<{
                id: string;
                name: string;
                pattern: string;
                color: string;
                enabled: boolean;
                isExclusionFilter?: boolean;
            }>;
        }>;
    }>;
    // Direct filters (new external system)
    filters: Array<{
        id: string;
        name: string;
        pattern: string;
        color: string;
        enabled: boolean;
        isExclusionFilter: boolean;
    }>;
    exclusionFilters: Array<{
        id: string;
        name: string;
        pattern: string;
        color: string;
        enabled: boolean;
    }>;
}

export class ProjectSettingsManager {
    private static instance: ProjectSettingsManager;
    private currentSettingsPath: string | undefined;
    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        // Restore last used settings path
        this.currentSettingsPath = context.globalState.get('lastProjectSettingsPath');
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

    /**
     * Set and remember the project settings file path
     */
    async setSettingsPath(filePath: string): Promise<void> {
        this.currentSettingsPath = filePath;
        await this.context.globalState.update('lastProjectSettingsPath', filePath);
    }

    /**
     * Clear the remembered project settings file path
     */
    async clearSettingsPath(): Promise<void> {
        this.currentSettingsPath = undefined;
        await this.context.globalState.update('lastProjectSettingsPath', undefined);
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
    async saveProjectSettings(filePath?: string, currentState?: any): Promise<boolean> {
        const targetPath = filePath || this.currentSettingsPath;
        
        if (!targetPath) {
            vscode.window.showWarningMessage('No project settings file path specified');
            return false;
        }

        try {
            // Get current VS Code configuration
            const config = vscode.workspace.getConfiguration('logAnalysisGamma');
            
            // Convert current filters from state if provided
            const filters = currentState?.filters?.map((filter: any) => ({
                id: filter.id,
                name: filter.name,
                pattern: filter.pattern,
                color: filter.color,
                enabled: filter.enabled,
                isExclusionFilter: false
            })) || [];

            const exclusionFilters = currentState?.exFilters?.map((filter: any) => ({
                id: filter.id,
                name: filter.name,
                pattern: filter.pattern,
                color: filter.color,
                enabled: filter.enabled
            })) || [];

            // Convert internal projects if provided
            const projects = currentState?.projects?.map((project: any) => ({
                id: project.id,
                name: project.name,
                selected: project.selected,
                groups: project.groups || []
            })) || [];
            
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
    async applyProjectSettings(settings: ProjectSettings, currentState?: any): Promise<void> {
        try {
            const config = vscode.workspace.getConfiguration('logAnalysisGamma');
            
            // Apply configuration settings
            await config.update('editorSelectionStrategy', settings.editorSelectionStrategy, vscode.ConfigurationTarget.Global);
            await config.update('maxEditorsToProcess', settings.maxEditorsToProcess, vscode.ConfigurationTarget.Global);
            await config.update('autoDetectLogFiles', settings.autoDetectLogFiles, vscode.ConfigurationTarget.Global);
            await config.update('showRandomColorNotifications', settings.showRandomColorNotifications, vscode.ConfigurationTarget.Global);
            await config.update('maxRememberedColors', settings.maxRememberedColors, vscode.ConfigurationTarget.Global);

            // Apply filters to current state if provided
            if (currentState) {
                // Clear existing filters
                currentState.filters = [];
                currentState.exFilters = [];
                
                // Add loaded filters
                if (settings.filters) {
                    currentState.filters.push(...settings.filters);
                }
                
                if (settings.exclusionFilters) {
                    currentState.exFilters.push(...settings.exclusionFilters);
                }

                // Apply projects if provided
                if (settings.projects && currentState.projects) {
                    currentState.projects = settings.projects;
                }
            }
            
            vscode.window.showInformationMessage(`$(check) Applied unified project settings (${settings.projects?.length || 0} projects, ${settings.filters?.length || 0} filters, ${settings.exclusionFilters?.length || 0} exclusions)`);
            
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to apply project settings: ${error}`);
        }
    }

    /**
     * Refresh settings from file (manual reload)
     */
    async refreshProjectSettings(): Promise<void> {
        if (!this.currentSettingsPath) {
            vscode.window.showWarningMessage('No project settings file to refresh');
            return;
        }

        const settings = await this.loadProjectSettings();
        if (settings) {
            await this.applyProjectSettings(settings);
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
            const mergedProjects = [...(existingSettings.projects || []), ...(currentState.projects || [])];
            
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