import * as vscode from 'vscode';
import { Project } from "./utils";

export class ProjectTreeViewProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  constructor(private projects: Project[]) { }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem): Thenable<vscode.TreeItem[]> {
    if (element === undefined) {
      const showPaths = vscode.workspace.getConfiguration('logAnalysisGamma').get<boolean>('showProjectFilePaths', false);
      return Promise.resolve(this.projects.map(project => new ProjectItem(project, showPaths)));
    } else {
      return Promise.resolve([]);
    }
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
