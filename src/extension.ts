import * as vscode from "vscode";
import {
  addFilter,
  applyHighlight,
  changeFilterColor,
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
  deleteExGroup,
  clearColorMemory,
  openPerformanceSettings,
  createProjectSettings,
  loadProjectSettings,
  saveProjectSettings,
  refreshProjectSettings,
  openSharedFilterFile,
  unloadSharedFilterFile,
  showProjectSettingsInfo,
  openProjectSettingsManager,
  importInternalProjects,
  chooseStorageFile,
  searchFilters,
  setFilterSearch
} from "./commands";
import { FilterTreeViewProvider } from "./filterTreeViewProvider";
import { ProjectTreeViewProvider } from "./projectTreeViewProvider";
import { ExFilterTreeViewProvider } from "./exFilterTreeViewProvider";
import { FocusProvider } from "./focusProvider";
import { Project, Group, Filter } from "./utils";
import { openSettings } from "./settings";
import { DocumentCacheManager } from "./documentCache";
import { ProjectSettingsManager } from "./projectSettingsManager";
import { FilterHistory } from './filterHistory';
import { StorageFileItem, StorageFilesTreeViewProvider } from "./storageFilesTreeViewProvider";
import { clearTimeRange, configureContext, configureTimeRange, exportFocused, filterFromSelection, showTimeSummary } from './investigationCommands';
import { BookmarkItem, BookmarkManager } from './bookmarks';
import { logProcessing } from './processing';
import { TimeProfile } from './timeFilter';

export type State = {
  highlightGeneration?: number;
  filterHistory?: FilterHistory;
  settingsManager?: ProjectSettingsManager;
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
  noUnderlineDecorationType: vscode.TextEditorDecorationType;
};

// Apply the no-underline decoration to all focus mode documents
export function applyNoUnderlineDecoration(state: State, editor: vscode.TextEditor) {
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
    
    editor.setDecorations(state.noUnderlineDecorationType, ranges);
  }
}

export async function activate(context: vscode.ExtensionContext) {
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
    globalStorageUri: context.globalStorageUri,
    noUnderlineDecorationType: vscode.window.createTextEditorDecorationType({
      textDecoration: 'none !important',
      cursor: 'pointer',
      border: 'none',
      outline: 'none'
    })
  };

  const settingsManager = ProjectSettingsManager.getInstance(context);
  await settingsManager.initializeFiles(state);
  refreshEditors(state);

  const filePathFromItem = (item?: StorageFileItem | string) => typeof item === 'string' ? item : item?.filePath;
  const bookmarks = new BookmarkManager(context.workspaceState);
  bookmarks.attachDecorations(state.focusProvider);
  const processingStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 50);
  const timeStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 49);
  const updateProcessingStatus = () => {
    processingStatus.text = logProcessing.paused ? '$(debug-pause) Logs paused' : logProcessing.activeJobs ? `$(sync~spin) Logs: ${logProcessing.activeJobs}` : '$(check) Logs';
    processingStatus.tooltip = logProcessing.activeJobs ? 'Cancel active log processing' : logProcessing.paused ? 'Resume log processing' : 'Pause log processing';
    processingStatus.command = logProcessing.activeJobs ? 'log-analysis-gamma.cancelProcessing' : 'log-analysis-gamma.toggleProcessing';
    processingStatus.show();
    vscode.commands.executeCommand('setContext', 'logAnalysisGamma.processingPaused', logProcessing.paused);
  };
  const updateTimeStatus = () => {
    const active = vscode.window.activeTextEditor?.document.uri;
    const uri = active?.scheme === 'focus-gamma' ? state.focusProvider.getOriginalUri(active) : active;
    const profile = uri && vscode.workspace.getConfiguration('logAnalysisGamma').get<Record<string, TimeProfile>>('timeProfiles', {})[uri.toString()];
    if (profile) {
      timeStatus.text = `$(clock) ${profile.kind}: ${profile.start || '*'} .. ${profile.end || '*'}`;
      timeStatus.tooltip = `${uri!.fsPath}\n${profile.pattern}\nConfigure time / cycle range`;
      timeStatus.command = 'log-analysis-gamma.timeRange';
      timeStatus.show();
    } else {
      timeStatus.hide();
    }
  };
  updateProcessingStatus();
  updateTimeStatus();
  context.subscriptions.push(
    processingStatus, timeStatus, logProcessing,
    logProcessing.onDidChange(updateProcessingStatus),
    vscode.window.onDidChangeActiveTextEditor(updateTimeStatus),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('logAnalysisGamma.timeProfiles')) { updateTimeStatus(); }
    }),
    vscode.commands.registerCommand('log-analysis-gamma.toggleProcessing', () => {
      logProcessing.setPaused(!logProcessing.paused);
      if (logProcessing.paused) {
        state.highlightGeneration = (state.highlightGeneration || 0) + 1;
        state.decorations.forEach(decoration => decoration.dispose());
        state.decorations = [];
      } else { refreshEditors(state); }
    }),
    vscode.commands.registerCommand('log-analysis-gamma.cancelProcessing', () => logProcessing.cancelAll()),
    bookmarks,
    vscode.window.createTreeView('filters-gamma.bookmarks', { treeDataProvider: bookmarks }),
    vscode.commands.registerCommand('log-analysis-gamma.addBookmark', () => bookmarks.addFromEditor(state.focusProvider)),
    vscode.commands.registerCommand('log-analysis-gamma.openBookmark', (item: BookmarkItem) => item && bookmarks.open(item)),
    vscode.commands.registerCommand('log-analysis-gamma.editBookmark', (item: BookmarkItem) => item && bookmarks.editNote(item)),
    vscode.commands.registerCommand('log-analysis-gamma.changeBookmarkColor', async (item?: BookmarkItem) => {
      const selected = item || await vscode.window.showQuickPick(bookmarks.getChildren().map(bookmarkItem => ({
        label: String(bookmarkItem.label), description: String(bookmarkItem.description), item: bookmarkItem
      })), { title: 'Choose Bookmark' }).then(choice => choice?.item);
      if (selected) { await bookmarks.changeColor(selected); }
    }),
    vscode.commands.registerCommand('log-analysis-gamma.deleteBookmark', (item: BookmarkItem) => item && bookmarks.remove(item.bookmark.id)),
    vscode.commands.registerCommand('log-analysis-gamma.nextBookmark', () => bookmarks.navigate(1, state.focusProvider)),
    vscode.commands.registerCommand('log-analysis-gamma.previousBookmark', () => bookmarks.navigate(-1, state.focusProvider)),
    vscode.commands.registerCommand('log-analysis-gamma.timeRange', () => configureTimeRange(state)),
    vscode.commands.registerCommand('log-analysis-gamma.clearTimeRange', () => clearTimeRange(state)),
    vscode.commands.registerCommand('log-analysis-gamma.timeSummary', () => showTimeSummary(state)),
    vscode.commands.registerCommand('log-analysis-gamma.contextLines', configureContext),
    vscode.commands.registerCommand('log-analysis-gamma.highlightSelection', () => filterFromSelection(state, false)),
    vscode.commands.registerCommand('log-analysis-gamma.excludeSelection', () => filterFromSelection(state, true)),
    vscode.commands.registerCommand('log-analysis-gamma.regexSelection', async () => {
      const action = await vscode.window.showQuickPick(['Highlight', 'Exclude'], { title: 'Regex Selection Filter' });
      if (action) {
        await filterFromSelection(state, action === 'Exclude', true);
      }
    }),
    vscode.commands.registerCommand('log-analysis-gamma.exportFocused', () => exportFocused(state, false)),
    vscode.commands.registerCommand('log-analysis-gamma.copyFocused', () => exportFocused(state, true)),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('logAnalysisGamma.contextBefore') || event.affectsConfiguration('logAnalysisGamma.contextAfter') || event.affectsConfiguration('logAnalysisGamma.timeProfiles')) {
        refreshEditors(state);
      }
    }),
    vscode.commands.registerCommand('log-analysis-gamma.undoFilterChange', () => {
      const label = state.filterHistory?.undo(state);
      if (label) {
        refreshEditors(state);
        vscode.window.setStatusBarMessage(`Undid: ${label}`, 3000);
      }
    }),
    vscode.commands.registerCommand('log-analysis-gamma.redoFilterChange', () => {
      const label = state.filterHistory?.redo(state);
      if (label) {
        refreshEditors(state);
        vscode.window.setStatusBarMessage(`Redid: ${label}`, 3000);
      }
    }),
    vscode.commands.registerCommand('log-analysis-gamma.addFilterToFile', (item: vscode.TreeItem) => item && addFilter(item, state, true)),
    vscode.commands.registerCommand('log-analysis-gamma.searchFilters', () => searchFilters(state)),
    vscode.commands.registerCommand('log-analysis-gamma.clearFilterSearch', () => setFilterSearch(state, '')),
    vscode.commands.registerCommand('log-analysis-gamma.saveAllFilters', async () => {
      const result = await settingsManager.saveAllChangedFiles(state);
      if (result.failed.length) {
        vscode.window.showWarningMessage(`Saved ${result.saved.length} files; failed: ${result.failed.join(', ')}`);
      } else {
        vscode.window.showInformationMessage(result.saved.length ? `Saved filters in ${result.saved.length} files` : 'No unsaved filter changes');
      }
    }),
    vscode.window.createTreeView('filters-gamma.files', { treeDataProvider: new StorageFilesTreeViewProvider(settingsManager, state) }),
    vscode.commands.registerCommand('log-analysis-gamma.openStorageFile', (item?: StorageFileItem | string) =>
      openSharedFilterFile(context, state, filePathFromItem(item))),
    vscode.commands.registerCommand('log-analysis-gamma.saveStorageFile', (item?: StorageFileItem | string) =>
      saveProjectSettings(context, state, filePathFromItem(item))),
    vscode.commands.registerCommand('log-analysis-gamma.reloadStorageFile', (item?: StorageFileItem | string) =>
      refreshProjectSettings(context, state, filePathFromItem(item))),
    vscode.commands.registerCommand('log-analysis-gamma.copyStoragePath', async (item?: StorageFileItem | string) => {
      const filePath = filePathFromItem(item) || await chooseStorageFile(state, 'Copy Which File Path?');
      if (filePath) {
        await vscode.env.clipboard.writeText(filePath);
      }
    }),
    vscode.commands.registerCommand('log-analysis-gamma.createStorageFile', () => createProjectSettings(context, state)),
    vscode.commands.registerCommand('log-analysis-gamma.applyStorageSettings', async (item?: StorageFileItem | string) => {
      const filePath = filePathFromItem(item) || await chooseStorageFile(state, 'Apply Settings from Which File?');
      if (filePath && await settingsManager.applyFileConfiguration(filePath)) {
        refreshEditors(state);
        vscode.window.showInformationMessage(`Applied settings from ${filePath}`);
      }
    })
  );

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
      const originalLine = state.focusProvider.getOriginalLineNumber(virtualUri.toString(), virtualLineIndex);
      if (originalLine === undefined || virtualLineIndex === 0) {
        vscode.window.showWarningMessage('The source changed; refresh Focus Mode before navigating.');
        return;
      }

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

  // Apply the no-underline decoration to all focus mode documents
  const applyNoUnderlineDecorationLocal = (editor: vscode.TextEditor) => {
    applyNoUnderlineDecoration(state, editor);
  };

  // Apply decoration when editor becomes active
  vscode.window.onDidChangeActiveTextEditor((editor) => {
    if (editor) {
      applyNoUnderlineDecorationLocal(editor);
    }
  });

  // Apply decoration when text document is opened
  vscode.workspace.onDidOpenTextDocument((document) => {
    const editor = vscode.window.activeTextEditor;
    if (editor && editor.document === document) {
      applyNoUnderlineDecorationLocal(editor);
    }
  });

  // Apply decoration to currently active editor if it's a focus mode document
  if (vscode.window.activeTextEditor) {
    applyNoUnderlineDecorationLocal(vscode.window.activeTextEditor);
  }

  //register filterTreeViewProvider under id 'filters-gamma' which gets attached
  //to the Smart Log Highlighter activity bar according to package.json's contributes>views>filter_gamma_project_setting
  const view = vscode.window.createTreeView(
    "filters-gamma",
    { treeDataProvider: state.filterTreeViewProvider, showCollapseAll: true }
  );
  context.subscriptions.push(view);

  //register exFilterTreeViewProvider under id 'filters-gamma.minus' which gets attached
  //to the Smart Log Highlighter activity bar according to package.json's contributes>views>filter_gamma_project_setting
  vscode.window.registerTreeDataProvider('filters-gamma.minus', state.exFilterTreeViewProvider);

  //register projectTreeViewProvider under id 'filters-gamma.settings' which gets attached
  //to the Smart Log Highlighter activity bar according to package.json's contributes>views>filter_gamma_project_setting
  vscode.window.registerTreeDataProvider(
    "filters-gamma.settings",
    state.projectTreeViewProvider);

  updateExplorerTitle(view, state);
  context.subscriptions.push(settingsManager.onDidChangeFiles(() => {
    updateExplorerTitle(view, state);
    state.projectTreeViewProvider.refresh();
  }));

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
      
      // Performance optimization: clear cache when document changes
      const cacheManager = DocumentCacheManager.getInstance();
      cacheManager.clearCache(event.document);
      
      refreshEditors(state);
    });
  context.subscriptions.push(disposableOnDidChangeTextDocument);

  var disposableOnDidChangeActiveTextEditor =
    vscode.window.onDidChangeActiveTextEditor((event) => {
      //update the filter counts for the current activate editor
      applyHighlight(state); // Use smart editor selection
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
        vscode.window.showErrorMessage('This command is excuted with button in Smart Log Highlighter Projects');
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
        vscode.window.showErrorMessage('This command is excuted with button in Smart Log Highlighter Projects');
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
    async () => {
      await refreshProjectSettings(context, state);
      updateExplorerTitle(view, state);
    });
  context.subscriptions.push(disposableRefreshSettings);

  let disposableSelectProject = vscode.commands.registerCommand(
    "log-analysis-gamma.selectProject",
    (projectIdOrTreeItem: string | vscode.TreeItem) => {
      if (projectIdOrTreeItem === undefined) {
        vscode.window.showErrorMessage('This command is excuted with button in Smart Log Highlighter Projects');
        return;
      }
      
      // Handle both project ID string and tree item
      let projectId: string;
      if (typeof projectIdOrTreeItem === 'string') {
        projectId = projectIdOrTreeItem;
      } else {
        projectId = projectIdOrTreeItem.id || '';
      }
      
      // Create a minimal tree item with just the ID
      const treeItem = { id: projectId } as vscode.TreeItem;
      
      if (selectProject(treeItem, state)) {
        updateExplorerTitle(view, state);
        // Stay in the current Smart Log Highlighter view instead of switching to Explorer
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

  let disposibleChangeFilterColor = vscode.commands.registerCommand(
    "log-analysis-gamma.changeFilterColor",
    (treeItem: vscode.TreeItem) => {
      if (treeItem === undefined) {
        vscode.window.showErrorMessage('This command is excuted with button in FILTERS');
        return;
      }
      changeFilterColor(treeItem, state);
    }
  );
  context.subscriptions.push(disposibleChangeFilterColor);

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

  let disposableClearColorMemory = vscode.commands.registerCommand(
    "log-analysis-gamma.clearColorMemory",
    () => clearColorMemory());
  context.subscriptions.push(disposableClearColorMemory);

  let disposableOpenPerformanceSettings = vscode.commands.registerCommand(
    "log-analysis-gamma.openPerformanceSettings",
    () => openPerformanceSettings());
  context.subscriptions.push(disposableOpenPerformanceSettings);

  context.subscriptions.push(
    vscode.commands.registerCommand('log-analysis-gamma.showProjectFilePaths', () =>
      vscode.workspace.getConfiguration('logAnalysisGamma').update('showProjectFilePaths', true, vscode.ConfigurationTarget.Global)),
    vscode.commands.registerCommand('log-analysis-gamma.hideProjectFilePaths', () =>
      vscode.workspace.getConfiguration('logAnalysisGamma').update('showProjectFilePaths', false, vscode.ConfigurationTarget.Global)),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('logAnalysisGamma.showProjectFilePaths')) {
        state.projectTreeViewProvider.refresh();
      }
    })
  );

  // Unified Project Settings Management Commands
  let disposableLoadUnifiedSettings = vscode.commands.registerCommand(
    "log-analysis-gamma.loadUnifiedSettings", 
    () => loadProjectSettings(context, state));
  context.subscriptions.push(disposableLoadUnifiedSettings);

  let disposableSaveUnifiedSettings = vscode.commands.registerCommand(
    "log-analysis-gamma.saveUnifiedSettings",
    () => saveProjectSettings(context, state));
  context.subscriptions.push(disposableSaveUnifiedSettings);

  let disposableRefreshUnifiedSettings = vscode.commands.registerCommand(
    "log-analysis-gamma.refreshUnifiedSettings",
    () => refreshProjectSettings(context, state));
  context.subscriptions.push(disposableRefreshUnifiedSettings);

  let disposableOpenSharedFilterFile = vscode.commands.registerCommand(
    "log-analysis-gamma.openUnifiedSettings",
    () => openSharedFilterFile(context, state));
  context.subscriptions.push(disposableOpenSharedFilterFile);

  let disposableUnloadSharedFilterFile = vscode.commands.registerCommand(
    "log-analysis-gamma.unloadUnifiedSettings",
    (item?: StorageFileItem | string) => unloadSharedFilterFile(context, state, filePathFromItem(item)));
  context.subscriptions.push(disposableUnloadSharedFilterFile);
}

// this method is called when your extension is deactivated
export function deactivate() { }
