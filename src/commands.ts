import * as vscode from "vscode";
import * as path from "path";
import { State, applyNoUnderlineDecoration } from "./extension";
import { generateRandomColor, generateSvgUri, setStatusBarMessage, getProjectSelectedIndex, setProjectSelectedFlag, getPredefinedColors, generateSmartRandomColor, generateTrulyRandomColor, UserColorMemory } from "./utils";
import { readSettings, saveSettings } from "./settings";
import { DocumentCacheManager } from "./documentCache";
import { PerformanceUtils } from "./performanceUtils";
import { EditorManager, EditorSelectionStrategy } from "./editorManager";
import { ProjectSettingsManager, SaveSection } from "./projectSettingsManager";
import { askRegex } from "./regexPreview";
import { recordFilterChange } from './filterHistory';
import { logProcessing } from './processing';

function hasHighlightedFilter(state: State): boolean {
  let hasHighlighted: boolean = false;

  for (const group of state.groups) {
    for (const filter of group.filters) {
      if (filter.isHighlighted) {
        hasHighlighted = true;
        break;
      }
    }
  }

  return hasHighlighted;
}

export async function applyHighlight(
  state: State,
  editors?: readonly vscode.TextEditor[]
): Promise<void> {
  const generation = (state.highlightGeneration || 0) + 1;
  state.highlightGeneration = generation;
  // Get editor selection strategy from configuration
  const config = vscode.workspace.getConfiguration('logAnalysisGamma');
  const strategy = config.get<EditorSelectionStrategy>('editorSelectionStrategy', EditorSelectionStrategy.ADAPTIVE);
  const maxEditors = config.get<number>('maxEditorsToProcess', 3);

  // Select editors based on strategy (if not provided)
  let targetEditors: vscode.TextEditor[];
  
  if (editors) {
    targetEditors = [...editors];
  } else {
    // Use performance measurement
    targetEditors = EditorManager.measurePerformance(() => {
      switch (strategy) {
        case EditorSelectionStrategy.ACTIVE_ONLY:
          return EditorManager.getActiveEditorOnly();
        case EditorSelectionStrategy.VISIBLE_ONLY:
          return EditorManager.getVisibleEditorsOnly();
        case EditorSelectionStrategy.RELEVANT_ONLY:
          return EditorManager.getRelevantEditors();
        case EditorSelectionStrategy.ADAPTIVE:
          return EditorManager.getAdaptiveEditors(maxEditors);
        default:
          return EditorManager.getAdaptiveEditors(maxEditors);
      }
    }, `Editor Selection (${strategy})`);
  }

  console.log(`[Performance] Processing ${targetEditors.length} editors using ${strategy} strategy`);

  // Performance optimization: dispose old decorations
  PerformanceUtils.disposeDecorations(state.decorations);
  state.decorations = [];

  // Performance optimization: early exit if no highlighted filters
  const activeFilters = PerformanceUtils.getActiveFilters(state.groups);
  if (activeFilters.length === 0 || logProcessing.paused) {
    console.log("no highlight - no active filters");
    return;
  }

  const cacheManager = DocumentCacheManager.getInstance();

  for (const editor of targetEditors) {
    try {
      const documentCache = cacheManager.getCache(editor.document);
      const filters = activeFilters.filter(filter => filter.isHighlighted && (!PerformanceUtils.isFocusModeEditor(editor) || filter.isShown));
      const matches = await documentCache.getMatchingLinesBatch(filters.map(filter => filter.regex));
      if (state.highlightGeneration !== generation || logProcessing.paused || editor.document.isClosed || !documentCache.isValid()) {
        return;
      }
      const filterRanges = filters.map((filter, index) => {
        const ranges = matches[index].map(line => new vscode.Range(line, 0, line, 0));
        if (editor === vscode.window.activeTextEditor) { filter.count = ranges.length; }
        return { filter, ranges };
      });
      const batches = PerformanceUtils.batchDecorationsByColor(filterRanges);
      state.decorations.push(...PerformanceUtils.applyBatchedDecorations(editor, batches, state.decorations));
    } catch (error) {
      if (!(error instanceof vscode.CancellationError)) {
        vscode.window.showWarningMessage(`Highlight processing stopped: ${error}`);
      }
      return;
    }
  }
  state.filterTreeViewProvider.refresh();
}

//set bool for whether the lines matched the given filter will be kept for focus mode
export function setVisibility(
  isShown: boolean,
  treeItem: vscode.TreeItem,
  state: State
) {
  recordFilterChange(state, 'Change visibility');
  const id = treeItem.id;
  const group = state.groups.find(group => (group.id === id));
  if (group !== undefined) {
    group.isShown = isShown;
    group.filters.map(filter => (filter.isShown = isShown));
  } else {
    const filter = state.exFilters.find(filter => (filter.id === id));
    if (filter !== undefined) {
      filter.isShown = isShown;
    }

    state.groups.map(group => {
      const filter = group.filters.find(filter => (filter.id === id));
      if (filter !== undefined) {
        filter.isShown = isShown;
      }
    });
  }
  
  // Update focus provider with visibility changes
  state.focusProvider.update(state.groups);
  
  // Performance optimization: use debounced refresh for rapid changes
  refreshEditorsDebounced(state, treeItem, 50);
}

//turn on focus mode for the active editor. Will create a new tab if not already for the virtual document
export function turnOnFocusMode(state: State) {
  let editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }
  let escapedUri = editor.document.uri.toString();
  if (escapedUri.startsWith("focus-gamma:")) {
    //avoid creating nested focus mode documents
    vscode.window.showInformationMessage(
      "You are on focus mode virtual document already!"
    );
    return;
  } else {
    //set special schema
    let virtualUri = vscode.Uri.parse("focus-gamma:" + escapedUri);
    //because of the special schema, openTextDocument will use the focusProvider
    vscode.workspace
      .openTextDocument(virtualUri)
      .then((doc) => vscode.window.showTextDocument(doc));
  }
}

export function deleteFilter(treeItem: vscode.TreeItem, state: State) {
  if (!state.exFilters.some(filter => filter.id === treeItem.id)
    && !state.groups.some(group => group.filters.some(filter => filter.id === treeItem.id))) {
    return;
  }
  recordFilterChange(state, 'Delete filter');
  const deleteIndex = state.exFilters.findIndex(filter => (filter.id === treeItem.id));
  if (deleteIndex !== -1) {
    // delete ex filter
    state.exFilters.splice(deleteIndex, 1);
    // Update focus provider after deleting exclusion filter
    state.focusProvider.update(state.groups);
    refreshEditorsDebounced(state, undefined, 50);
  } else {
    // delete filter
    const parentItem = state.filterTreeViewProvider.getParentItem(treeItem);
    state.groups.map(group => {
      const deleteIndex = group.filters.findIndex(filter => (filter.id === treeItem.id));
      if (deleteIndex !== -1) {
        group.filters.splice(deleteIndex, 1);
      }
    });
    // Update focus provider after deleting filter
    state.focusProvider.update(state.groups);
    refreshEditorsDebounced(state, parentItem, 50);
  }
}

export function changeFilterColor(treeItem: vscode.TreeItem, state: State) {
  const predefinedColors = getPredefinedColors();
  
  // Create quick pick items with better VS Code 1.85.1 compatibility
  const colorItems: vscode.QuickPickItem[] = predefinedColors.map(colorOption => ({
    label: `${colorOption.label} ${colorOption.name}`,
    description: colorOption.color,
    detail: `Use ${colorOption.name.toLowerCase()} color for highlighting (${colorOption.color})`,
    iconPath: new vscode.ThemeIcon("symbol-color")
  }));

  // Add smart random color option
  colorItems.push({
    label: "🎲 Smart Random Color",
    description: "Random from curated palette",
    detail: "Get a random color from predefined and additional good-looking colors",
    iconPath: new vscode.ThemeIcon("symbol-color")
  });

  // Add truly random color option
  colorItems.push({
    label: "Truly Random Color",
    description: "Generate completely random color",
    detail: "Generate a completely random color with good saturation and lightness",
    iconPath: new vscode.ThemeIcon("symbol-color", new vscode.ThemeColor("charts.foreground"))
  });

  // Add recently used colors if available
  const rememberedColors = UserColorMemory.getRememberedColors();
  if (rememberedColors.length > 0) {
    // Add recently used colors
    rememberedColors.forEach((color, index) => {
      colorItems.push({
        label: `Recently Used #${index + 1}`,
        description: color,
        detail: `Previously used color (${color})`,
        iconPath: new vscode.ThemeIcon("clock", new vscode.ThemeColor("charts.blue"))
      });
      
      // Add remove option for each recently used color
      colorItems.push({
        label: `Remove Color #${index + 1}`,
        description: color,
        detail: `Remove ${color} from recently used colors`,
        iconPath: new vscode.ThemeIcon("close", new vscode.ThemeColor("charts.red"))
      });
    });
  }

  // Add a custom color option
  colorItems.push({
    label: "Custom Color",
    description: "Enter custom hex color",
    detail: "Define your own color using hex code (e.g., #ff5733)",
    iconPath: new vscode.ThemeIcon("edit", new vscode.ThemeColor("charts.green"))
  });

  vscode.window.showQuickPick(colorItems, {
    placeHolder: "Select a color for the filter (scroll to see all options)",
    matchOnDescription: true,
    matchOnDetail: true,
    title: "Filter Color Selection",
    canPickMany: false,
    ignoreFocusOut: false
  }).then((selectedItem) => {
    if (selectedItem === undefined) {
      return;
    }

    let selectedColor: string;

    // Handle different color selection options
    if (selectedItem.label === "🎲 Smart Random Color") {
      selectedColor = generateSmartRandomColor();
      UserColorMemory.addColorToMemory(selectedColor);
      applyColorToFilter(selectedColor, treeItem, state);
      if (UserColorMemory.shouldShowNotifications()) {
        vscode.window.showInformationMessage(`🎲 Applied smart random color: ${selectedColor}`);
      }
      return;
    }

    if (selectedItem.label === "Truly Random Color") {
      selectedColor = generateTrulyRandomColor();
      UserColorMemory.addColorToMemory(selectedColor);
      applyColorToFilter(selectedColor, treeItem, state);
      if (UserColorMemory.shouldShowNotifications()) {
        vscode.window.showInformationMessage(`🌈 Applied truly random color: ${selectedColor}`);
      }
      return;
    }

    if (selectedItem.label === "Custom Color") {
      vscode.window.showInputBox({
        prompt: "Enter a custom hex color (e.g., #ff5733, #3498db, #27ae60)",
        placeHolder: "#ff5733",
        validateInput: (value) => {
          const hexColorRegex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
          return hexColorRegex.test(value) ? null : "Please enter a valid hex color (e.g., #ff5733)";
        }
      }).then((customColor) => {
        if (customColor) {
          UserColorMemory.addColorToMemory(customColor);
          applyColorToFilter(customColor, treeItem, state);
        }
      });
      return;
    }

    // Handle remove color actions
    if (selectedItem.label.startsWith("Remove Color")) {
      const colorToRemove = selectedItem.description;
      if (colorToRemove) {
        UserColorMemory.removeColorFromMemory(colorToRemove);
        vscode.window.showInformationMessage(`$(trash) Removed ${colorToRemove} from recently used colors`);
        // Reopen the color picker to show updated list
        changeFilterColor(treeItem, state);
      }
      return;
    }

    // Handle predefined colors and recently used colors
    if (selectedItem.description && selectedItem.description.startsWith('#')) {
      selectedColor = selectedItem.description;
      // Add to memory if it's not a predefined color
      const isPredefined = predefinedColors.some(c => c.color === selectedColor);
      if (!isPredefined) {
        UserColorMemory.addColorToMemory(selectedColor);
      }
      applyColorToFilter(selectedColor, treeItem, state);
    }
  });
}

// Helper function to apply color to filter
export function applyColorToFilter(newColor: string, treeItem: vscode.TreeItem, state: State) {
  recordFilterChange(state, 'Change filter color');
  const id = treeItem.id;

  // Update the filter color in both regular filters and exclusion filters
  const exFilter = state.exFilters.find(filter => (filter.id === id));
  if (exFilter !== undefined) {
    exFilter.color = newColor;
    exFilter.iconPath = generateSvgUri(newColor, exFilter.isHighlighted);
  }

  state.groups.map(group => {
    const filter = group.filters.find(filter => (filter.id === id));
    if (filter !== undefined) {
      filter.color = newColor;
      filter.iconPath = generateSvgUri(newColor, filter.isHighlighted);
    }
  });

  // Update focus provider and refresh displays
  state.focusProvider.update(state.groups);
  refreshEditorsDebounced(state, treeItem, 50);
}

export function clearColorMemory() {
  UserColorMemory.clearColorMemory();
  vscode.window.showInformationMessage('$(clear-all) Recently used colors cleared!');
}

export function openPerformanceSettings() {
  // Create quick pick interface for performance settings with detailed information
  const strategyItems: vscode.QuickPickItem[] = [
    {
      label: "Active Only",
      description: "Maximum Performance (90% improvement)",
      detail: "Processes ONLY the active editor. Best for: Large projects (10+ files), single-file focus, maximum speed. Trade-off: No highlights in background files until clicked.",
      iconPath: new vscode.ThemeIcon("rocket", new vscode.ThemeColor("charts.red"))
    },
    {
      label: "Visible Only", 
      description: "Balanced Performance (30-50% improvement)",
      detail: "Processes ALL visible editors in split-view. Best for: Split workflows (2-4 panes), multi-file comparison. Trade-off: Hidden tabs not processed.",
      iconPath: new vscode.ThemeIcon("eye", new vscode.ThemeColor("charts.blue"))
    },
    {
      label: "Relevant Only",
      description: "Smart Selection (70% improvement)", 
      detail: "Auto-detects log files (.log, .txt, .out, .err, .trace). Best for: Mixed projects (code + logs), automatic smart detection. Configurable file types.",
      iconPath: new vscode.ThemeIcon("file-text", new vscode.ThemeColor("charts.green"))
    },
    {
      label: "Adaptive",
      description: "Intelligent (60% improvement, Default)",
      detail: "Auto-adjusts: Few files (≤3) = all processed, Many files (>3) = smart selection up to limit. Best for: Variable workflows, 'set and forget'.",
      iconPath: new vscode.ThemeIcon("lightbulb", new vscode.ThemeColor("charts.purple"))
    },
    {
      label: "Configure File Types",
      description: "Customize Relevant File Extensions",
      detail: "Add/remove file types for 'Relevant Only' strategy. Choose from 13+ common log extensions or add custom ones via settings.",
      iconPath: new vscode.ThemeIcon("gear", new vscode.ThemeColor("charts.orange"))
    },
    {
      label: "Open Full Settings",
      description: "Advanced Configuration",
      detail: "Access complete VS Code settings: max editors limit (1-10), auto-detect options, color memory, notifications, and more.",
      iconPath: new vscode.ThemeIcon("settings", new vscode.ThemeColor("charts.gray"))
    }
  ];

  vscode.window.showQuickPick(strategyItems, {
    placeHolder: "Choose performance strategy - hover over options for detailed guidance",
    title: "Smart Log Highlighter - Performance Settings (Select based on your workflow)",
    matchOnDescription: true,
    matchOnDetail: true,
    ignoreFocusOut: false
  }).then((selectedItem) => {
    if (!selectedItem) return;

    const config = vscode.workspace.getConfiguration('logAnalysisGamma');
    
    switch (selectedItem.label) {
      case "Active Only":
        config.update('editorSelectionStrategy', 'active', vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage('$(rocket) Performance: Active Only - Maximum speed! Only active editor processed (90% improvement)');
        break;
      case "Visible Only":
        config.update('editorSelectionStrategy', 'visible', vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage('$(eye) Performance: Visible Only - Balanced for split-view workflows (30-50% improvement)');
        break;
      case "Relevant Only":
        config.update('editorSelectionStrategy', 'relevant', vscode.ConfigurationTarget.Global);
        const currentExtensions = config.get<string[]>('relevantFileExtensions', ['.log', '.txt', '.out', '.err', '.trace']);
        vscode.window.showInformationMessage(`$(file-text) Performance: Relevant Only - Smart log detection (70% improvement). Processing: ${currentExtensions.join(', ')}`);
        break;
      case "Adaptive":
        config.update('editorSelectionStrategy', 'adaptive', vscode.ConfigurationTarget.Global);
        const maxEditors = config.get<number>('maxEditorsToProcess', 3);
        vscode.window.showInformationMessage(`$(lightbulb) Performance: Adaptive - Intelligent auto-adjustment (60% improvement). Max editors: ${maxEditors}`);
        break;
      case "Configure File Types":
        configureRelevantFileTypes();
        break;
      case "Open Full Settings":
        vscode.commands.executeCommand('workbench.action.openSettings', 'logAnalysisGamma');
        break;
    }
  });
}

export function configureRelevantFileTypes() {
  const config = vscode.workspace.getConfiguration('logAnalysisGamma');
  const currentExtensions = config.get<string[]>('relevantFileExtensions', ['.log', '.txt', '.out', '.err', '.trace']);
  
  const quickPick = vscode.window.createQuickPick();
  quickPick.title = 'Configure Relevant File Types - Select extensions for "Relevant Only" strategy';
  quickPick.placeholder = 'Check/uncheck file types that should be processed by filters';
  quickPick.canSelectMany = true;
  
  // Common file extensions for logs with descriptions
  const extensionGroups = [
    { category: 'Primary Log Files', extensions: [
      { ext: '.log', desc: 'Standard application logs' },
      { ext: '.txt', desc: 'Text-based log files' },
      { ext: '.out', desc: 'Output/stdout files' },
      { ext: '.err', desc: 'Error/stderr files' },
      { ext: '.trace', desc: 'Stack trace files' }
    ]},
    { category: 'Log Levels', extensions: [
      { ext: '.debug', desc: 'Debug level logs' },
      { ext: '.info', desc: 'Info level logs' },
      { ext: '.warn', desc: 'Warning level logs' },
      { ext: '.error', desc: 'Error level logs' },
      { ext: '.fatal', desc: 'Fatal error logs' }
    ]},
    { category: 'Specialized Logs', extensions: [
      { ext: '.access', desc: 'Web server access logs' },
      { ext: '.audit', desc: 'Security audit logs' },
      { ext: '.security', desc: 'Security event logs' },
      { ext: '.perf', desc: 'Performance metrics' },
      { ext: '.metrics', desc: 'Application metrics' }
    ]},
    { category: 'System Logs', extensions: [
      { ext: '.console', desc: 'Console output' },
      { ext: '.output', desc: 'System output files' },
      { ext: '.dump', desc: 'Memory/thread dumps' },
      { ext: '.crash', desc: 'Crash report files' }
    ]}
  ];
  
  // Flatten all extensions with category info
  const allItems: vscode.QuickPickItem[] = [];
  extensionGroups.forEach(group => {
    // Add category header (non-selectable)
    allItems.push({
      label: group.category,
      kind: vscode.QuickPickItemKind.Separator
    });
    
    // Add extensions in this category
    group.extensions.forEach(({ext, desc}) => {
      const isEnabled = currentExtensions.includes(ext);
      allItems.push({
        label: ext,
        description: desc,
        detail: isEnabled ? '$(check) Currently enabled - will be processed' : '$(circle-outline) Click to enable for processing',
        picked: isEnabled
      });
    });
  });
  
  quickPick.items = allItems;
  quickPick.selectedItems = quickPick.items.filter(item => 
    item.label && currentExtensions.includes(item.label)
  );
  
  quickPick.onDidAccept(() => {
    const selectedExtensions = quickPick.selectedItems
      .map(item => item.label)
      .filter(label => label && !['Primary Log Files', 'Log Levels', 'Specialized Logs', 'System Logs'].includes(label)); // Filter out category headers
    
    config.update('relevantFileExtensions', selectedExtensions, vscode.ConfigurationTarget.Global);
    
    const message = selectedExtensions.length > 0 
      ? `$(file-text) Updated relevant file types (${selectedExtensions.length}): ${selectedExtensions.join(', ')}`
      : '$(warning) No file types selected - "Relevant Only" strategy will process no files';
      
    vscode.window.showInformationMessage(message);
    quickPick.hide();
  });
  
  quickPick.onDidHide(() => quickPick.dispose());
  quickPick.show();
}

export async function addFilter(treeItem: vscode.TreeItem, state: State, chooseAnotherFile = false) {
  let group = state.groups.find(candidate => candidate.id === treeItem.id);
  if (!group) {
    return;
  }
  const destination = state.settingsManager
    ? (chooseAnotherFile ? await chooseStorageFile(state, 'Store Filter in Which File?')
      : group.sourcePath || await chooseStorageFile(state, 'Store Filter in Which File?', false, true))
    : undefined;
  if (state.settingsManager && !destination) {
    return;
  }
  const regexStr = await askRegex({
    prompt: "[FILTER] Type a regex to filter",
    ignoreFocusOut: false
  });
  if (regexStr === undefined) {
    return;
  }
  recordFilterChange(state, 'Add filter');
  if (destination && state.settingsManager && group.sourcePath !== destination) {
    const project = state.settingsManager.selectedProject(destination, state);
    const groupName = group.name;
    const existingGroup = project.groups.find(candidate => candidate.name === groupName);
    if (existingGroup) {
      group = existingGroup;
    } else {
      group = { ...group, id: `${Math.random()}`, sourcePath: destination, filters: [] };
      project.groups.push(group);
    }
  }
  const id = `${Math.random()}`;
  const color = generateRandomColor();
  const filter = {
    sourcePath: destination,
    isHighlighted: true,
    isShown: true,
    regex: new RegExp(regexStr),
    color: color,
    id,
    iconPath: generateSvgUri(color, true),
    count: 0,
  };
  group.filters.push(filter);
  state.settingsManager?.updateState(state);
  state.focusProvider.update(state.groups);
  refreshEditorsDebounced(state, undefined, 50);
}

export async function editFilter(treeItem: vscode.TreeItem, state: State) {
  const filter = state.exFilters.find(candidate => candidate.id === treeItem.id)
    || state.groups.reduce<import('./utils').Filter[]>((filters, group) => filters.concat(group.filters), [])
      .find(candidate => candidate.id === treeItem.id);
  if (!filter) {
    return;
  }
  const regexStr = await askRegex({ title: 'Edit Regex', value: filter.regex.source }, filter.regex.flags);
  if (regexStr === undefined || regexStr === filter.regex.source) {
    return;
  }
  recordFilterChange(state, 'Edit regex');
  filter.regex = new RegExp(regexStr, filter.regex.flags);
  state.focusProvider.update(state.groups);
  refreshEditorsDebounced(state, treeItem, 50);
}

export function setHighlight(
  isHighlighted: boolean,
  treeItem: vscode.TreeItem,
  state: State
) {
  recordFilterChange(state, 'Change highlighting');
  const id = treeItem.id;
  const group = state.groups.find(group => (group.id === id));
  if (group !== undefined) {
    group.isHighlighted = isHighlighted;
    group.filters.map(filter => {
      filter.isHighlighted = isHighlighted;
      filter.iconPath = generateSvgUri(filter.color, filter.isHighlighted);
    });
  } else {
    state.groups.map(group => {
      const filter = group.filters.find(filter => (filter.id === id));
      if (filter !== undefined) {
        filter.isHighlighted = isHighlighted;
        filter.iconPath = generateSvgUri(filter.color, filter.isHighlighted);;
      }
    });
  }
  applyHighlight(state); // Use smart editor selection
  refreshEditorsDebounced(state, treeItem, 50);
}

//refresh every visible component, including:
//document content of the visible focus mode virtual document,
//decoration of the visible focus mode virtual document,
//highlight decoration of visible editors
//treeview on the side bar
export function refreshEditors(state: State, treeItem?: vscode.TreeItem) {
  vscode.window.visibleTextEditors.forEach((editor) => {
    let escapedUri = editor.document.uri.toString();
    if (escapedUri.startsWith("focus-gamma:")) {
      state.focusProvider.refresh(editor.document.uri);
      let focusDecorationType = vscode.window.createTextEditorDecorationType({
        before: {
          contentText: ">>>>>>>focus gamma mode<<<<<<<",
          color: "#888888",
        },
      });
      let focusDecorationRangeArray = [
        new vscode.Range(new vscode.Position(0, 0), new vscode.Position(1, 0)),
      ];
      editor.setDecorations(focusDecorationType, focusDecorationRangeArray);
      
      // Apply no-underline decorations to remove underlines from links
      applyNoUnderlineDecoration(state, editor);
    }
  });
  applyHighlight(state); // Use smart editor selection
  console.log("refreshEditors");
  state.filterTreeViewProvider.refresh(treeItem);
  state.exFilterTreeViewProvider.refresh(treeItem);
  state.settingsManager?.refreshFiles();
}

// Performance optimized debounced version for rapid changes
export function refreshEditorsDebounced(state: State, treeItem?: vscode.TreeItem, delay: number = 100) {
  PerformanceUtils.debouncedRefreshEditors(() => {
    refreshEditors(state, treeItem);
  }, delay);
}

export function refreshFilterTreeView(state: State, treeItem?: vscode.TreeItem) {
  console.log("refresh only tree view");
  state.filterTreeViewProvider.refresh(treeItem);
  state.settingsManager?.refreshFiles();
}

export function updateFilterTreeViewAndFocusProvider(state: State) {
  console.log("update filter and tree view");
  state.filterTreeViewProvider.update(state.groups);
  state.focusProvider.update(state.groups);
}

export function updateProjectTreeView(state: State) {
  console.log("update project tree view");
  state.projectTreeViewProvider.update(state.projects);
  state.settingsManager?.refreshFiles();
}

export async function addGroup(state: State) {
  const destination = state.settingsManager ? await chooseStorageFile(state, 'Store Group in Which File?', false, true) : undefined;
  if (state.settingsManager && !destination) {
    return;
  }
  const name = await vscode.window.showInputBox({
    prompt: '[GROUP] Type a new group name',
    ignoreFocusOut: false
  });
  if (name === undefined) {
    return;
  }
  recordFilterChange(state, 'Add group');
  const id = `${Math.random()}`;
  const group = {
    sourcePath: destination,
    filters: [],
    isHighlighted: true,
    isShown: true,
    name: name,
    id
  };
  if (destination && state.settingsManager) {
    state.settingsManager.selectedProject(destination, state).groups.push(group);
    state.settingsManager.updateState(state);
  } else {
    state.groups.push(group);
  }
  refreshFilterTreeView(state);
}

export function editGroup(treeItem: vscode.TreeItem, state: State) {
  vscode.window.showInputBox({
    prompt: "[GROUP] Type a new group name",
    ignoreFocusOut: false,
    value: treeItem.label ? treeItem.label.toString() : ""
  }).then(name => {
    if (name === undefined) {
      return;
    }
    const id = treeItem.id;
    const group = state.groups.find(group => (group.id === id));
    recordFilterChange(state, 'Rename group');
    group!.name = name;
    refreshFilterTreeView(state, treeItem);
  });
}

export function deleteGroup(treeItem: vscode.TreeItem, state: State) {
  recordFilterChange(state, 'Delete group');
  if (state.settingsManager) {
    for (const project of state.projects) {
      const groupIndex = project.groups.findIndex(group => group.id === treeItem.id);
      if (groupIndex !== -1) {
        project.groups.splice(groupIndex, 1);
      }
    }
    state.settingsManager.updateState(state);
    refreshEditors(state);
    return;
  }
  const deleteIndex = state.groups.findIndex(group => (group.id === treeItem.id));
  if (deleteIndex !== -1) {
    state.groups.splice(deleteIndex, 1);
  }
  refreshEditors(state);
}

export function saveProject(state: State) {
  if (state.settingsManager) {
    return saveProjectSettings(undefined, state);
  }
  const selected = state.projects.find(p => (p.selected === true));
  if (selected === undefined) {
    vscode.window.showErrorMessage('There is no selected project');
    return;
  }

  selected.groups = state.groups;
  saveSettings(state.globalStorageUri, state.projects, state.exFilters);

  setStatusBarMessage(`Project(${selected.name}) is saved.`);
}

export async function addProject(state: State) {
  const destination = state.settingsManager ? await chooseStorageFile(state, 'Store Project in Which File?', false, true) : undefined;
  if (state.settingsManager && !destination) {
    return;
  }
  const name = await vscode.window.showInputBox({
    prompt: "[PROJECT] Type a new project name",
    ignoreFocusOut: false
  });
  if (name === undefined) {
    return;
  }
  recordFilterChange(state, 'Add project');

  const project = {
    sourcePath: destination,
    groups: [],
    name,
    id: `${Math.random()}`,
    selected: false
  };

  state.projects.push(project);
  if (!state.settingsManager) {
    saveSettings(state.globalStorageUri, state.projects, state.exFilters);
  }
  updateProjectTreeView(state);
}

export function editProject(treeItem: vscode.TreeItem, state: State, callback: () => void) {
  vscode.window
    .showInputBox({
      prompt: "[PROJECT] Type a new name",
      ignoreFocusOut: false,
      value: treeItem.label ? treeItem.label.toString() : ""
    })
    .then((name) => {
      if (name === undefined) {
        return;
      }
      const findIndex = state.projects.findIndex(project => (project.id === treeItem.id));
      if (findIndex !== -1) {
        recordFilterChange(state, 'Rename project');
        state.projects[findIndex].name = name;
        if (!state.settingsManager) {
          saveSettings(state.globalStorageUri, state.projects, state.exFilters);
        }
        updateProjectTreeView(state);

        callback();
      }
    });
}

export async function handleLastProjectDeletion(treeItem: vscode.TreeItem, state: State) {
  if (state.settingsManager) {
    const choice = await vscode.window.showWarningMessage('Delete this project and its filters?', { modal: true }, 'Delete');
    if (choice === 'Delete') {
      deleteProject(treeItem, state);
    }
    return;
  }
  if (state.projects.length !== 1) {
    deleteProject(treeItem, state);
    return;
  }

  const userResponse = await vscode.window.showWarningMessage(
    'This is the last item. Are you sure you want to delete it? If you delete it, an initialized NONAME project will be created.',
    { modal: true },
    'Yes',
    'No'
);

  if (userResponse === 'Yes') {
      vscode.window.showInformationMessage('Item deleted successfully.');
      deleteProject(treeItem, state);
      refreshSettings(state);
    } else if (userResponse === 'No') {
      vscode.window.showInformationMessage('Item deletion canceled.');
  }
}

export function deleteProject(treeItem: vscode.TreeItem, state: State) {
  if (state.settingsManager) {
    const project = state.projects.find(candidate => candidate.id === treeItem.id);
    if (!project) {
      return;
    }
    recordFilterChange(state, 'Delete project');
    state.projects.splice(state.projects.indexOf(project), 1);
    const remaining = state.projects.filter(candidate => candidate.sourcePath === project.sourcePath);
    if (remaining.length === 0) {
      state.projects.push({ name: 'NONAME', id: `${Math.random()}`, selected: true, groups: [], sourcePath: project.sourcePath });
    } else if (project.selected) {
      remaining[0].selected = true;
    }
    state.settingsManager.updateState(state);
    refreshEditors(state);
    return;
  }
  const selectedIndex = getProjectSelectedIndex(state.projects);
  const deleteIndex = state.projects.findIndex(project => (project.id === treeItem.id));
  if (deleteIndex !== -1) {
    if (deleteIndex === selectedIndex) {
      state.groups = [];
      updateFilterTreeViewAndFocusProvider(state);
      refreshEditors(state);
    }
    state.projects.splice(deleteIndex, 1);
    saveSettings(state.globalStorageUri, state.projects, state.exFilters);
    updateProjectTreeView(state);
  }
}

function createDefaultProject(state: State) {
  const name = "NONAME";

  if (state.projects.length === 0 || state.projects[0].name !== name) {
    const project = {
      groups: [],
      name,
      id: `${Math.random()}`,
      selected: false
    };

    state.projects.unshift(project);
  }
}

export function refreshSettings(state: State) {
  try {
    state.projects = readSettings(state.globalStorageUri, state.exFilters);
  } catch {
    return false;
  }
  var selectedIndex = getProjectSelectedIndex(state.projects);

  // Automatically activate the project if there is only one
  if (state.projects.length === 1) {
    selectedIndex = 0;
  }

  // Add a project named "NONAMED" in the following cases:
  // - A default project is generated for users who do not use the project feature.
  // - If multiple projects are available but none is selected, an empty project is created and selected.
  if (state.projects.length === 0) {
    createDefaultProject(state);
    saveSettings(state.globalStorageUri, state.projects, state.exFilters);
    selectedIndex = 0;
  }

  if (selectedIndex === -1) {
    createDefaultProject(state);
    selectedIndex = 0;
  }

  setProjectSelectedFlag(state.projects, selectedIndex);
  state.groups = state.projects[selectedIndex].groups;

  updateProjectTreeView(state);
  updateFilterTreeViewAndFocusProvider(state);
  refreshEditors(state);
  return true;
}

export function selectProject(treeItem: vscode.TreeItem, state: State): boolean {
  if (state.settingsManager) {
    const project = state.projects.find(candidate => candidate.id === treeItem.id);
    if (!project) {
      return false;
    }
    state.projects.filter(candidate => candidate.sourcePath === project.sourcePath)
      .forEach(candidate => candidate.selected = candidate === project);
    state.settingsManager.updateState(state);
    refreshEditors(state);
    return true;
  }
  const prevSelectedIndex = getProjectSelectedIndex(state.projects);
  const newSelectedIndex = state.projects.findIndex(p => p.id === treeItem.id);
  if (newSelectedIndex !== -1) {
    if (prevSelectedIndex === newSelectedIndex) {
      vscode.window.showInformationMessage('This project is already selected');
      return true;
    }
    state.projects.forEach(p => {
      p.selected = false;
      p.groups.forEach(g => {
        g.isHighlighted = false;
        g.isShown = false;
        g.filters.forEach(f => {
          f.isHighlighted = false;
          f.isShown = false;
          f.iconPath = generateSvgUri(f.color, f.isHighlighted);
        });
      });
    });

    const project = state.projects[newSelectedIndex];
    state.groups = project.groups;
    setProjectSelectedFlag(state.projects, newSelectedIndex);
    updateProjectTreeView(state);
    updateFilterTreeViewAndFocusProvider(state);
    refreshEditors(state);
    return true;
  }
  return false;
}

export function updateExplorerTitle(view: vscode.TreeView<vscode.TreeItem>, state: State) {
  if (state.settingsManager) {
    const count = state.settingsManager.getFiles(state).filter(file => file.loaded).length;
    view.title = `Filters+ (${count} files)`;
    return;
  }
  const selectedIndex = getProjectSelectedIndex(state.projects);
  if (selectedIndex === -1) {
    view.title = 'Filters+';
  } else {
    view.title = 'Filters+ (' + state.projects[selectedIndex].name + ')';
  }
}

export async function addExFilter(state: State) {
  const destination = state.settingsManager ? await chooseStorageFile(state, 'Store Exclusion in Which File?', false, true) : undefined;
  if (state.settingsManager && !destination) {
    return;
  }
  const regexStr = await askRegex({
    prompt: "[FILTER] Type a regex to exclusion filter",
    ignoreFocusOut: false
  });
  if (regexStr === undefined) {
    return;
  }
  recordFilterChange(state, 'Add exclusion');
  const id = `${Math.random()}`;
  const color = generateRandomColor();
  const exFilter = {
    sourcePath: destination,
    isHighlighted: false,
    isShown: true,
    regex: new RegExp(regexStr),
    color,
    id,
    iconPath: generateSvgUri(color, false),
    count: 0
  };

  state.exFilters.push(exFilter);
  refreshEditors(state);
}

export async function deleteExGroup(state: State) {
  const destination = state.settingsManager ? await chooseStorageFile(state, 'Clear Exclusions from Which File?') : undefined;
  if (state.settingsManager && !destination) {
    return;
  }
  recordFilterChange(state, 'Clear exclusions');
  state.exFilters.splice(0, state.exFilters.length, ...state.exFilters.filter(filter => destination && filter.sourcePath !== destination));
  refreshEditors(state);
}

// Project Settings Management Commands

export function setFilterSearch(state: State, query: string): void {
  state.filterTreeViewProvider.setSearchQuery(query);
  state.exFilterTreeViewProvider.setSearchQuery(query);
  vscode.commands.executeCommand('setContext', 'logAnalysisGamma.filterSearchActive', query.trim().length > 0);
}

export async function searchFilters(state: State): Promise<void> {
  const query = await vscode.window.showInputBox({
    title: 'Search Filters', prompt: 'Group, regex, or source file',
    value: state.filterTreeViewProvider.getSearchQuery(), ignoreFocusOut: true
  });
  if (query !== undefined) {
    setFilterSearch(state, query);
  }
}

export async function chooseStorageFile(state: State, title: string, externalOnly = false, useSingleFile = false): Promise<string | undefined> {
  const files = state.settingsManager?.getFiles(state).filter(file => file.loaded && (!externalOnly || !file.internal)) || [];
  if (useSingleFile && files.length === 1) {
    return files[0].path;
  }
  const options = files.map(file => ({
    label: file.internal ? 'Internal Settings' : path.basename(file.path),
    description: file.path,
    detail: file.dirty ? 'Unsaved filter changes' : (file.internal ? 'Internal storage' : 'Loaded external file'),
    filePath: file.path
  }));
  const choice = await vscode.window.showQuickPick(options, { title, matchOnDescription: true, ignoreFocusOut: true });
  return choice?.filePath;
}

async function confirmFileReplacement(filePath: string, state: State, action: string): Promise<boolean> {
  if (!state.settingsManager?.isDirty(filePath, state)) {
    return true;
  }
  const choice = await vscode.window.showWarningMessage(`Unsaved filters in ${filePath}`, { modal: true },
    `Save and ${action}`, `Discard and ${action}`, 'Cancel');
  if (choice === `Save and ${action}`) {
    return state.settingsManager.saveFile(filePath, state);
  }
  return choice === `Discard and ${action}`;
}

export async function loadProjectSettings(context: vscode.ExtensionContext, state: State) {
  const manager = state.settingsManager || ProjectSettingsManager.getInstance(context);
  
  const options: vscode.OpenDialogOptions = {
    canSelectMany: true,
    openLabel: 'Load Settings Files',
    filters: {
      'JSON Files': ['json'],
      'All Files': ['*']
    }
  };

  const fileUris = await vscode.window.showOpenDialog(options);
  for (const fileUri of fileUris || []) {
    if (manager.getFiles(state).some(file => file.path === fileUri.fsPath && file.loaded)) {
      continue;
    }
    await manager.loadFile(fileUri.fsPath, state);
  }
  refreshEditors(state);
}

export async function saveProjectSettings(context: vscode.ExtensionContext | undefined, state: State, filePath?: string) {
  const manager = state.settingsManager || ProjectSettingsManager.getInstance(context);
  const destination = filePath || await chooseStorageFile(state, 'Save to Which File?');
  if (!destination) {
    return;
  }
  const options: Array<vscode.QuickPickItem & { section: SaveSection }> = [
    { label: 'Filters, Exclusions and Settings', section: 'all' },
    { label: 'Filters Only', section: 'filters' },
    { label: 'Exclusion Filters Only', section: 'exclusions' },
    { label: 'Settings Only', section: 'settings' }
  ];
  const choice = await vscode.window.showQuickPick(options, {
    title: `Save to ${destination}`, placeHolder: 'What should be saved?', ignoreFocusOut: true
  });
  if (choice) {
    await manager.saveFile(destination, state, choice.section);
  }
}

export async function createProjectSettings(context: vscode.ExtensionContext, state?: State) {
  const manager = state?.settingsManager || ProjectSettingsManager.getInstance(context);
  
  const options: vscode.SaveDialogOptions = {
    defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri,
    filters: {
      'JSON Files': ['json'],
      'All Files': ['*']
    },
    saveLabel: 'Create Empty Settings File'
  };

  const fileUri = await vscode.window.showSaveDialog(options);
  if (fileUri && state) {
    await manager.createFile(fileUri.fsPath, state);
    refreshEditors(state);
  }
}

export async function unloadSharedFilterFile(context: vscode.ExtensionContext, state: State, filePath?: string) {
  const manager = state.settingsManager || ProjectSettingsManager.getInstance(context);
  const destination = filePath || await chooseStorageFile(state, 'Unload Which File?', true);
  if (destination && await confirmFileReplacement(destination, state, 'Unload')) {
    await manager.unloadFile(destination, state);
    refreshEditors(state);
  }
}

export async function openSharedFilterFile(context: vscode.ExtensionContext, state?: State, filePath?: string) {
  const settingsPath = filePath || (state ? await chooseStorageFile(state, 'Open Settings File')
    : ProjectSettingsManager.getInstance(context).getCurrentSettingsPath());

  if (!settingsPath) {
    vscode.window.showWarningMessage('No shared filter file loaded. Use "Load Shared Filter File" first.');
    return;
  }

  try {
    const doc = await vscode.workspace.openTextDocument(settingsPath);
    await vscode.window.showTextDocument(doc);
  } catch {
    vscode.window.showErrorMessage(`Could not open shared filter file: ${settingsPath}`);
  }
}

export async function refreshProjectSettings(context: vscode.ExtensionContext, state: State, filePath?: string) {
  const manager = state.settingsManager || ProjectSettingsManager.getInstance(context);
  const paths = filePath ? [filePath] : manager.getFiles(state).map(file => file.path);
  for (const sourcePath of paths) {
    if (await confirmFileReplacement(sourcePath, state, 'Reload')) {
      await manager.loadFile(sourcePath, state);
    }
  }
  refreshEditors(state);
}

export async function importInternalProjects(context: vscode.ExtensionContext, state: State) {
  const manager = ProjectSettingsManager.getInstance(context);
  await manager.importInternalProjects(state);
}

export async function showProjectSettingsInfo(context: vscode.ExtensionContext) {
  const manager = ProjectSettingsManager.getInstance(context);
  const info = manager.getSettingsFileInfo();
  
  if (!info.path) {
    vscode.window.showInformationMessage('$(info) No project settings file configured');
    return;
  }
  
  const status = info.exists ? '$(check) Active' : '$(error) Missing';
  const lastModified = info.lastModified ? info.lastModified.toLocaleString() : 'Unknown';
  
  const message = `Project Settings:\n${status}\nPath: ${info.path}\nLast Modified: ${lastModified}`;
  
  const actions = ['Open File', 'Refresh', 'Load Different File'];
  const action = await vscode.window.showInformationMessage(message, ...actions);
  
  if (action === 'Open File' && info.exists) {
    const doc = await vscode.workspace.openTextDocument(info.path);
    await vscode.window.showTextDocument(doc);
  } else if (action === 'Refresh') {
    await refreshProjectSettings(context, {} as State); // We'll need to pass proper state
  } else if (action === 'Load Different File') {
    await loadProjectSettings(context, {} as State); // We'll need to pass proper state
  }
}

// Helper function to update ProjectSettingsManager with current filters
async function updateProjectSettingsWithCurrentState(manager: ProjectSettingsManager, state: State) {
  // TODO: We need to integrate this with the ProjectSettingsManager
  // For now, this is a placeholder that shows the structure we need
  
  // The ProjectSettingsManager.saveProjectSettings method needs to be updated
  // to accept current filter state as a parameter
}

// Enhanced project settings management with QuickPick interface
export async function openProjectSettingsManager(context: vscode.ExtensionContext, state: State) {
  const manager = ProjectSettingsManager.getInstance(context);
  const quickPick = vscode.window.createQuickPick();
  
  quickPick.title = 'Project Settings Manager';
  quickPick.placeholder = 'Choose an action for project settings management';
  
  const currentFile = manager.getCurrentSettingsPath();
  const fileStatus = manager.getSettingsFileInfo();
  
  const items = [
    {
      label: "Load Project Settings",
      description: "Load settings from file",
      detail: "Open and apply settings from a project file",
      iconPath: new vscode.ThemeIcon("folder-opened", new vscode.ThemeColor("charts.blue"))
    },
    {
      label: "Save Current Settings",
      description: "Save to project file", 
      detail: currentFile ? `Save to: ${currentFile}` : "Create new project settings file",
      iconPath: new vscode.ThemeIcon("save", new vscode.ThemeColor("charts.green"))
    },
    {
      label: "Create New Settings File",
      description: "Create new project file",
      detail: "Create a new project settings file with current configuration",
      iconPath: new vscode.ThemeIcon("file-add", new vscode.ThemeColor("charts.purple"))
    }
  ];
  
  if (currentFile) {
    items.push({
      label: "Refresh Current Settings",
      description: fileStatus.exists ? "Reload from file" : "File missing",
      detail: `Refresh from: ${currentFile}`,
      iconPath: new vscode.ThemeIcon("refresh", new vscode.ThemeColor("charts.orange"))
    });
    
    items.push({
      label: "Settings File Info",
      description: fileStatus.exists ? "Show file details" : "File not found",
      detail: `Status: ${fileStatus.exists ? 'Active' : 'Missing'}`,
      iconPath: new vscode.ThemeIcon("info", new vscode.ThemeColor("charts.foreground"))
    });
  }
  
  quickPick.items = items;
  
  quickPick.onDidChangeSelection(async (selectedItems) => {
    if (selectedItems.length === 0) return;
    
    const selectedItem = selectedItems[0];
    quickPick.hide();
    
    switch (selectedItem.label) {
      case "Load Project Settings":
        await loadProjectSettings(context, state);
        break;
      case "Save Current Settings":
        await saveProjectSettings(context, state);
        break;
      case "Create New Settings File":
        await createProjectSettings(context);
        break;
      case "Refresh Current Settings":
        await refreshProjectSettings(context, state);
        break;
      case "Settings File Info":
        await showProjectSettingsInfo(context);
        break;
    }
  });
  
  quickPick.show();
}
