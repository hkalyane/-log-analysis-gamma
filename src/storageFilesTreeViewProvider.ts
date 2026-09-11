import * as vscode from 'vscode';
import * as path from 'path';
import { State } from './extension';
import { ProjectSettingsManager, StorageFile } from './projectSettingsManager';

export class StorageFileItem extends vscode.TreeItem {
    readonly filePath: string;

    constructor(file: StorageFile) {
        super(`${file.internal ? 'Internal' : path.basename(file.path)}${file.dirty ? ' *' : ''}`);
        this.filePath = file.path;
        this.id = file.path;
        this.description = file.path;
        this.tooltip = `${file.internal ? 'Internal storage' : 'External file'}\n${file.path}\n${file.error || (file.dirty ? 'Unsaved filter changes' : (file.loaded ? 'Loaded' : 'Not loaded'))}`;
        this.contextValue = `${file.internal ? 'internal' : 'external'}-${file.loaded ? 'loaded' : 'unavailable'}`;
        this.iconPath = new vscode.ThemeIcon(file.error ? 'warning' : (file.internal ? 'database' : 'json'));
        this.command = { command: 'log-analysis-gamma.openStorageFile', title: 'Open Settings File', arguments: [file.path] };
    }
}

export class StorageFilesTreeViewProvider implements vscode.TreeDataProvider<StorageFileItem> {
    readonly onDidChangeTreeData: vscode.Event<void>;

    constructor(private manager: ProjectSettingsManager, private state: State) {
        this.onDidChangeTreeData = manager.onDidChangeFiles;
    }

    getTreeItem(item: StorageFileItem): vscode.TreeItem {
        return item;
    }

    getChildren(item?: StorageFileItem): StorageFileItem[] {
        return item ? [] : this.manager.getFiles(this.state).map(file => new StorageFileItem(file));
    }
}