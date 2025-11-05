import * as vscode from "vscode";
import {
  addFilter,
  applyHighlight,
  deleteFilter,
  editFilter,
  refreshEditors,
  setHighlight,
  setVisibility,
  turnOnFocusMode,
  addGroup,
  editGroup,
  deleteGroup,
  saveProject,
  addProject,
  editProject,
  handleLastProjectDeletion,
  refreshSettings,
  selectProject,
  updateExplorerTitle,
  addExFilter,
  deleteExGroup
} from "./commands";
import { FilterTreeViewProvider } from "./filterTreeViewProvider";
import { ProjectTreeViewProvider } from "./projectTreeViewProvider";
import { ExFilterTreeViewProvider } from "./exFilterTreeViewProvider";
import { FocusProvider } from "./focusProvider";
import { Project, Group, Filter } from "./utils";
import { openSettings } from "./settings";

export type State = {
  inFocusMode: boolean;
  projects: Project[];
  groups: Group[];
  exFilters: Filter[];
  decorations: vscode.TextEditorDecorationType[];
  disposableFoldingRange: vscode.Disposable | null;
  filterTreeViewProvider: FilterTreeViewProvider;
  exFilterTreeViewProvider: ExFilterTreeViewProvider;
  projectTreeViewProvider: ProjectTreeViewProvider;
  focusProvider: FocusProvider;
  globalStorageUri: vscode.Uri;
};

export function activate(context: vscode.ExtensionContext) {
  //internal globals
  const projects: Project[] = [];
  const groups: Group[] = [];
  const exFilters: Filter[] = [];
  const state: State = {
    inFocusMode: false,
    projects,
    groups,
    exFilters,
    decorations: [],
    disposableFoldingRange: null,
    filterTreeViewProvider: new FilterTreeViewProvider(groups),
    exFilterTreeViewProvider: new ExFilterTreeViewProvider(exFilters),
    projectTreeViewProvider: new ProjectTreeViewProvider(projects),
    focusProvider: new FocusProvider(groups, exFilters),
    globalStorageUri: context.globalStorageUri
  };

  refreshSettings(state);

  //tell vs code to open focus-gamma:... uris with state.focusProvider
  const disposableFocus = vscode.workspace.registerTextDocumentContentProvider(
    "focus-gamma",
    state.focusProvider
  );
  context.subscriptions.push(disposableFocus);

  // Command: On clicking a link in the virtual document, navigate to the corresponding line in the original file.
  const openOriginalLocation = vscode.commands.registerCommand(
    'log-analysis-gamma.openOriginalLocation',
    (virtualLineIndex: number) => {
      const activeEditor = vscode.window.activeTextEditor;
      if (!activeEditor) {
        vscode.window.showErrorMessage('No active editor.');
        return;
      }
      if (virtualLineIndex === undefined) {
        vscode.window.showErrorMessage('Invalid virtual line index provided.');
        return;
      }
      // Ensure we're operating from a virtual (focus mode) document.
      const virtualUri = activeEditor.document.uri;
      if (!virtualUri.toString().startsWith("focus-gamma:")) {
        vscode.window.showInformationMessage("The current document is not in focus mode.");
        return;
      }
      // Recover the original file's URI by removing the "focus-gamma:" prefix.
      const originalUri = vscode.Uri.parse(virtualUri.path.replace(/^focus-gamma:/, ''));
      const documentLineMap = state.focusProvider.documentLineMap.get(originalUri.fsPath);
      if (!documentLineMap || virtualLineIndex < 0 || virtualLineIndex >= documentLineMap.length) {
        vscode.window.showErrorMessage('Invalid index.');
        return;
      }
      const originalLine = documentLineMap[virtualLineIndex];

      // Check if the original file is already open (in any tab, including preview mode).
      let openEditor = vscode.window.visibleTextEditors.find(
        editor => editor.document.uri.fsPath === originalUri.fsPath
      );

      if (openEditor) {
        // Scenario 1, 2, or 3: Original file is open (preview, same tab, or different tab).
        // Focus the existing editor and navigate to the specified line.
        const pos = new vscode.Position(originalLine, 0);
        openEditor.selection = new vscode.Selection(pos, pos);
        openEditor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
        vscode.window.showTextDocument(openEditor.document, openEditor.viewColumn);
      } else {
        // Scenario 4: Original file is not open.
        // Open the original file in a new editor tab (non-preview) without affecting the virtual document.
        vscode.workspace.openTextDocument(originalUri)
          .then(doc => vscode.window.showTextDocument(doc, { preview: false }))
          .then(editor => {
            const pos = new vscode.Position(originalLine, 0);
            editor.selection = new vscode.Selection(pos, pos);
            editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
          });
      }
    }
  );
  context.subscriptions.push(openOriginalLocation);

  // DocumentLinkProvider: Add a link to each line (starting at line 1) that executes the openOriginalLocation command.
  const linkProvider = vscode.languages.registerDocumentLinkProvider(
    { scheme: 'focus-gamma' },
    {
      provideDocumentLinks(document: vscode.TextDocument) {
        const links: vscode.DocumentLink[] = [];
        const lines = document.getText().split('\n');
        for (let i = 1; i < lines.length; i++) {
          const lineText = lines[i];
          const linkRange = new vscode.Range(i, 0, i, lineText.length);
          console.log(`[${i}]: ${lineText}, ${linkRange}`);
          // Pass the line index as an argument to the command.
          const commandUri = vscode.Uri.parse(
            `command:log-analysis-gamma.openOriginalLocation?${encodeURIComponent(JSON.stringify([i]))}`
          );
          links.push(new vscode.DocumentLink(linkRange, commandUri));
        }
        return links;
      }
    }
  );
  context.subscriptions.push(linkProvider);

  // Create a text decoration type that removes underlines for focus mode links
  const noUnderlineDecorationType = vscode.window.createTextEditorDecorationType({
    textDecoration: 'none',
    cursor: 'pointer'
  });

  // Apply the no-underline decoration to all focus mode documents
  const applyNoUnderlineDecoration = (editor: vscode.TextEditor) => {
    if (editor.document.uri.scheme === 'focus-gamma') {
      const ranges: vscode.Range[] = [];
      const text = editor.document.getText();
      const lines = text.split('\n');
      
      // Create ranges for all lines except the first (which is empty)
      for (let i = 1; i < lines.length; i++) {
        if (lines[i].trim().length > 0) {
          const range = new vscode.Range(i, 0, i, lines[i].length);
          ranges.push(range);
        }
      }
      
      editor.setDecorations(noUnderlineDecorationType, ranges);
    }
  };

  // Apply decoration when editor becomes active
  vscode.window.onDidChangeActiveTextEditor((editor) => {
    if (editor) {
      applyNoUnderlineDecoration(editor);
    }
  });

  // Apply decoration when text document is opened
  vscode.workspace.onDidOpenTextDocument((document) => {
    const editor = vscode.window.activeTextEditor;
    if (editor && editor.document === document) {
      applyNoUnderlineDecoration(editor);
    }
  });

  // Apply decoration to currently active editor if it's a focus mode document
  if (vscode.window.activeTextEditor) {
    applyNoUnderlineDecoration(vscode.window.activeTextEditor);
  }

  //register filterTreeViewProvider under id 'filters' which gets attached
  //to the file explorer according to package.json's contributes>views>explorer
  const view = vscode.window.createTreeView(
    "filters-gamma",
    { treeDataProvider: state.filterTreeViewProvider, showCollapseAll: true }
  );
  context.subscriptions.push(view);

  //register filterTreeViewProvider under id 'filters.minus' which gets attached
  //to the file explorer according to package.json's contributes>views>explorer
  vscode.window.registerTreeDataProvider('filters-gamma.minus', state.exFilterTreeViewProvider);

  //register projectTreeViewProvider under id 'filters.settings' which gets attached
  //to filter_project_setting in the Activity Bar according to package.json's contributes>views>filter_project_settings
  vscode.window.registerTreeDataProvider(
    "filters-gamma.settings",
    state.projectTreeViewProvider);

  updateExplorerTitle(view, state);

  //Add events listener
  var disposableOnDidChangeVisibleTextEditors =
    vscode.window.onDidChangeVisibleTextEditors((event) => {
      if (vscode.window.visibleTextEditors.length === 0) {
        console.log("no visible editors");
        return;
      }
      console.log(`[${new Date().toISOString()}] onDidChangeVisibleTextEditors - ${vscode.window.visibleTextEditors.length}`);
      refreshEditors(state);
    });
  context.subscriptions.push(disposableOnDidChangeVisibleTextEditors);

  var disposableOnDidCloseTextDocument = vscode.workspace.onDidCloseTextDocument((document: vscode.TextDocument) => {
    console.log(`[${new Date().toISOString()}] disposableOnDidCloseTextDocument - ${document.uri.scheme}`);
    if (document.uri.scheme !== "focus-gamma") {
      return;
    }
    const originalUri = vscode.Uri.parse(document.uri.path.replace(/^focus-gamma:/, ''));
    const deleted = state.focusProvider.documentLineMap.delete(originalUri.fsPath);
    console.log(`Removed entry for ${originalUri.fsPath}: ${deleted}`);
  });
  context.subscriptions.push(disposableOnDidCloseTextDocument);

  var disposableOnDidChangeTextDocument =
    vscode.workspace.onDidChangeTextDocument((event) => {
      console.log(`[${new Date().toISOString()}] onDidChangeTextDocument - ${vscode.window.visibleTextEditors.length}`);
      refreshEditors(state);
    });
  context.subscriptions.push(disposableOnDidChangeTextDocument);

  var disposableOnDidChangeActiveTextEditor =
    vscode.window.onDidChangeActiveTextEditor((event) => {
      //update the filter counts for the current activate editor
      applyHighlight(state, vscode.window.visibleTextEditors);
      state.filterTreeViewProvider.refresh();
    });
  context.subscriptions.push(disposableOnDidChangeActiveTextEditor);

  //register commands
  let disposableAddProject = vscode.commands.registerCommand(
    "log-analysis-gamma.addProject",
    () => addProject(state));
  context.subscriptions.push(disposableAddProject);

  let disposibleEditProject = vscode.commands.registerCommand(
    "log-analysis-gamma.editProject",
    (treeItem: vscode.TreeItem) => {
      if (treeItem === undefined) {
        vscode.window.showErrorMessage('This command is excuted with button in Log Analysis Gamma Projects');
        return;
      }
      editProject(treeItem, state, () => {
        updateExplorerTitle(view, state);
      });
    }
  );
  context.subscriptions.push(disposibleEditProject);

  let disposableDeleteProject = vscode.commands.registerCommand(
    "log-analysis-gamma.deleteProject",
    (treeItem: vscode.TreeItem) => {
      if (treeItem === undefined) {
        vscode.window.showErrorMessage('This command is excuted with button in Log Analysis Gamma Projects');
        return;
      }
      handleLastProjectDeletion(treeItem, state)
        .then(() => {
          updateExplorerTitle(view, state);
        })
        .catch((err) => {
          vscode.window.showErrorMessage(`Error: ${err.message}`);
        });
    });
  context.subscriptions.push(disposableDeleteProject);

  let disposableOpenSettings = vscode.commands.registerCommand(
    "log-analysis-gamma.openSettings",
    () => openSettings(state.globalStorageUri));
  context.subscriptions.push(disposableOpenSettings);

  let disposableRefreshSettings = vscode.commands.registerCommand(
    "log-analysis-gamma.refreshSettings",
    () => {
      refreshSettings(state);
      updateExplorerTitle(view, state);
    });
  context.subscriptions.push(disposableRefreshSettings);

  let disposableSelectProject = vscode.commands.registerCommand(
    "log-analysis-gamma.selectProject",
    (treeItem: vscode.TreeItem) => {
      if (treeItem === undefined) {
        vscode.window.showErrorMessage('This command is excuted with button in Log Analysis Gamma Projects');
        return;
      }
      if (selectProject(treeItem, state)) {
        updateExplorerTitle(view, state);
        vscode.commands.executeCommand('workbench.view.explorer');
      }
    });
  context.subscriptions.push(disposableSelectProject);

  let disposableSaveProject = vscode.commands.registerCommand(
    "log-analysis-gamma.saveProject",
    () => saveProject(state));
  context.subscriptions.push(disposableSaveProject);

  let disposableEnableVisibility = vscode.commands.registerCommand(
    "log-analysis-gamma.enableVisibility",
    (treeItem: vscode.TreeItem) => {
      if (treeItem === undefined) {
        vscode.window.showErrorMessage('This command is excuted with button in FILTERS');
        return;
      }
      setVisibility(true, treeItem, state);
    }
  );
  context.subscriptions.push(disposableEnableVisibility);

  let disposableDisableVisibility = vscode.commands.registerCommand(
    "log-analysis-gamma.disableVisibility",
    (treeItem: vscode.TreeItem) => {
      if (treeItem === undefined) {
        vscode.window.showErrorMessage('This command is excuted with button in FILTERS');
        return;
      }
      setVisibility(false, treeItem, state);
    }
  );
  context.subscriptions.push(disposableDisableVisibility);

  let disposableTurnOnFocusMode = vscode.commands.registerCommand(
    "log-analysis-gamma.turnOnFocusMode",
    () => turnOnFocusMode(state)
  );
  context.subscriptions.push(disposableTurnOnFocusMode);

  let disposibleAddFilter = vscode.commands.registerCommand(
    "log-analysis-gamma.addFilter",
    (treeItem: vscode.TreeItem) => {
      if (treeItem === undefined) {
        vscode.window.showErrorMessage('This command is excuted with button in FILTERS');
        return;
      }
      addFilter(treeItem, state);
    }
  );
  context.subscriptions.push(disposibleAddFilter);

  let disposibleEditFilter = vscode.commands.registerCommand(
    "log-analysis-gamma.editFilter",
    (treeItem: vscode.TreeItem) => {
      if (treeItem === undefined) {
        vscode.window.showErrorMessage('This command is excuted with button in FILTERS');
        return;
      }
      editFilter(treeItem, state);
    }
  );
  context.subscriptions.push(disposibleEditFilter);

  let disposibleDeleteFilter = vscode.commands.registerCommand(
    "log-analysis-gamma.deleteFilter",
    (treeItem: vscode.TreeItem) => {
      if (treeItem === undefined) {
        vscode.window.showErrorMessage('This command is excuted with button in FILTERS');
        return;
      }
      deleteFilter(treeItem, state);
    }
  );
  context.subscriptions.push(disposibleDeleteFilter);

  let disposibleEnableHighlight = vscode.commands.registerCommand(
    "log-analysis-gamma.enableHighlight",
    (treeItem: vscode.TreeItem) => {
      if (treeItem === undefined) {
        vscode.window.showErrorMessage('This command is excuted with button in FILTERS');
        return;
      }
      setHighlight(true, treeItem, state);
    }
  );
  context.subscriptions.push(disposibleEnableHighlight);

  let disposibleDisableHighlight = vscode.commands.registerCommand(
    "log-analysis-gamma.disableHighlight",
    (treeItem: vscode.TreeItem) => {
      if (treeItem === undefined) {
        vscode.window.showErrorMessage('This command is excuted with button in FILTERS');
        return;
      }
      setHighlight(false, treeItem, state);
    }
  );
  context.subscriptions.push(disposibleDisableHighlight);

  let disposibleAddGroup = vscode.commands.registerCommand(
    "log-analysis-gamma.addGroup",
    () => {
      addGroup(state);
    }
  );
  context.subscriptions.push(disposibleAddGroup);

  let disposibleEditGroup = vscode.commands.registerCommand(
    "log-analysis-gamma.editGroup",
    (treeItem: vscode.TreeItem) => {
      if (treeItem === undefined) {
        vscode.window.showErrorMessage('This command is excuted with button in FILTERS');
        return;
      }
      editGroup(treeItem, state);
    }
  );
  context.subscriptions.push(disposibleEditGroup);

  let disposibleDeleteGroup = vscode.commands.registerCommand(
    "log-analysis-gamma.deleteGroup",
    (treeItem: vscode.TreeItem) => {
      if (treeItem === undefined) {
        vscode.window.showErrorMessage('This command is excuted with button in FILTERS');
        return;
      }
      deleteGroup(treeItem, state);
    }
  );
  context.subscriptions.push(disposibleDeleteGroup);

  let disposibleAddExFilter = vscode.commands.registerCommand(
    "log-analysis-gamma.addExFilter",
    () => addExFilter(state));
  context.subscriptions.push(disposibleAddExFilter);

  let disposibleDeleteExGroup = vscode.commands.registerCommand(
    "log-analysis-gamma.deleteExGroup",
    () => deleteExGroup(state));
  context.subscriptions.push(disposibleDeleteExGroup);
}

// this method is called when your extension is deactivated
export function deactivate() { }
