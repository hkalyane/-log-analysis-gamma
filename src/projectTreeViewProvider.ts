import * as vscode from 'vscode';
import * as path from 'path';
import { Project } from "./utils";
import type { StorageFile } from './projectSettingsManager';

export class ProjectTreeViewProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private getSources?: () => StorageFile[];
  constructor(private projects: Project[]) { }

  setSources(getSources: () => StorageFile[]): void {
    this.getSources = getSources;
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem): Thenable<vscode.TreeItem[]> {
    const showPaths = vscode.workspace.getConfiguration('logAnalysisGamma').get<boolean>('showProjectFilePaths', false);
    if (element === undefined) {
      if (this.getSources) {
        return Promise.resolve(this.getSources().map(file => new ProjectSourceItem(file,
          this.projects.filter(project => project.sourcePath === file.path).length, showPaths)));
      }
      return Promise.resolve(this.projects.map(project => new ProjectItem(project, showPaths)));
    } else if (element instanceof ProjectSourceItem) {
      return Promise.resolve(this.projects.filter(project => project.sourcePath === element.filePath)
        .map(project => new ProjectItem(project, showPaths)));
    } else {
      return Promise.resolve([]);
    }
  }

  getParent(element: vscode.TreeItem): vscode.TreeItem | undefined {
    if (element instanceof ProjectItem && this.getSources) {
      const file = this.getSources().find(source => source.path === element.project.sourcePath);
      if (file) {
        return new ProjectSourceItem(file, this.projects.filter(project => project.sourcePath === file.path).length,
          vscode.workspace.getConfiguration('logAnalysisGamma').get<boolean>('showProjectFilePaths', false));
      }
    }
    return undefined;
  }

  private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined> = new vscode.EventEmitter<vscode.TreeItem | undefined>();
  readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined> = this._onDidChangeTreeData.event;

  refresh(element?: vscode.TreeItem): void {
    if (element === undefined) {
      console.log("[project]: refresh all");
    } else {
      console.log("[project]: refresh item");
    }
    this._onDidChangeTreeData.fire(element);
  }

  update(projects: Project[]) {
    this.projects = projects;
    this.refresh();
  }
}

export class ProjectItem extends vscode.TreeItem {
  public project: Project;
  
  constructor(project: Project, showPaths = false) {
    super(project.name, vscode.TreeItemCollapsibleState.None);
    this.id = project.id;
    this.project = project;
    this.contextValue = 'project';
    this.description = showPaths ? project.sourcePath : undefined;
    this.tooltip = project.sourcePath ? `${project.name}\n${project.sourcePath}` : project.name;
    this.command = {
      command: 'log-analysis-gamma.selectProject',
      title: 'Select Project',
      arguments: [project.id]
    } as vscode.Command;
    if (project.selected) {
      this.iconPath = new vscode.ThemeIcon("arrow-small-right");
    }
  }
}

export class ProjectSourceItem extends vscode.TreeItem {
  readonly filePath: string;

  constructor(file: StorageFile, count: number, showPaths: boolean) {
    super(`${file.internal ? 'Internal' : path.basename(file.path)}${file.dirty ? ' *' : ''}`, vscode.TreeItemCollapsibleState.Expanded);
    this.filePath = file.path;
    this.id = `source:${file.path}`;
    this.description = showPaths ? file.path : `${count} project${count === 1 ? '' : 's'}`;
    this.tooltip = `${file.path}\n${file.error || (file.dirty ? 'Unsaved filter changes' : (file.loaded ? 'Loaded' : 'Not loaded'))}`;
    this.iconPath = new vscode.ThemeIcon(file.error ? 'warning' : (file.internal ? 'database' : 'json'));
    this.contextValue = `source-${file.internal ? 'internal' : 'external'}-${file.loaded ? 'loaded' : 'unavailable'}`;
  }
}
