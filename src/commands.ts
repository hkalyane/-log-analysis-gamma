import * as vscode from "vscode";
import { State, applyNoUnderlineDecoration } from "./extension";
import { generateRandomColor, generateSvgUri, setStatusBarMessage, getProjectSelectedIndex, setProjectSelectedFlag, getPredefinedColors, generateSmartRandomColor, generateTrulyRandomColor, UserColorMemory } from "./utils";
import { readSettings, saveSettings } from "./settings";
import { DocumentCacheManager } from "./documentCache";
import { PerformanceUtils } from "./performanceUtils";
import { EditorManager, EditorSelectionStrategy } from "./editorManager";
import { ProjectSettingsManager } from "./projectSettingsManager";

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

export function applyHighlight(
  state: State,
  editors?: readonly vscode.TextEditor[]
): void {
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
  if (activeFilters.length === 0) {
    console.log("no highlight - no active filters");
    return;
  }

  const cacheManager = DocumentCacheManager.getInstance();

  // Performance measurement for the entire highlighting process
  EditorManager.measurePerformance(() => {
    targetEditors.forEach((editor) => {
      // Performance optimization: get cached document processing
      const documentCache = cacheManager.getCache(editor.document);
      const isFocusMode = PerformanceUtils.isFocusModeEditor(editor);

      // Collect all filter ranges for batching
      const filterRanges: Array<{ filter: any; ranges: vscode.Range[] }> = [];

      // Process each active filter once per editor
      activeFilters.forEach((filter) => {
        // Skip if filter should not be highlighted in current context
        if (!filter.isHighlighted || (isFocusMode && !filter.isShown)) {
          return;
        }

        // Performance optimization: use cached regex results
        const ranges = documentCache.getMatchingRanges(filter.regex);
        filterRanges.push({ filter, ranges });

        // Update filter count for active editor only
        if (editor === vscode.window.activeTextEditor) {
          filter.count = ranges.length;
        }
      });

      // Performance optimization: batch decorations by color
      const colorBatches = PerformanceUtils.batchDecorationsByColor(filterRanges);
      
      // Apply all decorations for this editor in batches
      const newDecorations = PerformanceUtils.applyBatchedDecorations(
        editor, 
        colorBatches, 
        state.decorations
      );
      
      // Store decorations for later cleanup
      state.decorations.push(...newDecorations);
    });
  }, `Highlight Processing (${targetEditors.length} editors)`);
}

//set bool for whether the lines matched the given filter will be kept for focus mode
export function setVisibility(
  isShown: boolean,
  treeItem: vscode.TreeItem,
  state: State
) {
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
function applyColorToFilter(newColor: string, treeItem: vscode.TreeItem, state: State) {
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
    title: "Log Analysis Gamma - Performance Settings (Select based on your workflow)",
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

export function addFilter(treeItem: vscode.TreeItem, state: State) {
  vscode.window
    .showInputBox({
      prompt: "[FILTER] Type a regex to filter",
      ignoreFocusOut: false,
    })
    .then((regexStr) => {
      if (regexStr === undefined) {
        return;
      }
      const group = state.groups.find(group => (group.id === treeItem.id));
      const id = `${Math.random()}`;
      const color = generateRandomColor();
      const filter = {
        isHighlighted: true,
        isShown: true,
        regex: new RegExp(regexStr),
        color: color,
        id,
        iconPath: generateSvgUri(color, true),
        count: 0,
      };
      group!.filters.push(filter);

      // Update the focus provider with the new filter groups
      state.focusProvider.update(state.groups);
      
      const parentItem = state.filterTreeViewProvider.getParentItem(treeItem);
      refreshEditorsDebounced(state, parentItem, 50);
    });
}

export function editFilter(treeItem: vscode.TreeItem, state: State) {
  vscode.window
    .showInputBox({
      prompt: "[FILTER] Type a new regex",
      ignoreFocusOut: false,
      value: treeItem.label ? treeItem.label.toString().replace(/^\/|\/$/g, '') : ""
    })
    .then((regexStr) => {
      if (regexStr === undefined) {
        return;
      }
      const id = treeItem.id;
      const exFilter = state.exFilters.find(filter => (filter.id === id));
      if (exFilter !== undefined) {
        exFilter.regex = new RegExp(regexStr);
      }
      state.groups.map(group => {
        const filter = group.filters.find(filter => (filter.id === id));
        if (filter !== undefined) {
          filter.regex = new RegExp(regexStr);
        }
      });
      
      // Update the focus provider with the modified filters
      state.focusProvider.update(state.groups);
      
      refreshEditorsDebounced(state, treeItem, 50);
    });
}

export function setHighlight(
  isHighlighted: boolean,
  treeItem: vscode.TreeItem,
  state: State
) {
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
}

export function updateFilterTreeViewAndFocusProvider(state: State) {
  console.log("update filter and tree view");
  state.filterTreeViewProvider.update(state.groups);
  state.focusProvider.update(state.groups);
}

export function updateProjectTreeView(state: State) {
  console.log("update project tree view");
  state.projectTreeViewProvider.update(state.projects);
}

export function addGroup(state: State) {
  vscode.window.showInputBox({
    prompt: '[GROUP] Type a new group name',
    ignoreFocusOut: false
  }).then(name => {
    if (name === undefined) {
      return;
    }
    const id = `${Math.random()}`;
    const group = {
      filters: [],
      isHighlighted: true,
      isShown: true,
      name: name,
      id
    };
    state.groups.push(group);
    refreshFilterTreeView(state);
  });
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
    group!.name = name;
    refreshFilterTreeView(state, treeItem);
  });
}

export function deleteGroup(treeItem: vscode.TreeItem, state: State) {
  const deleteIndex = state.groups.findIndex(group => (group.id === treeItem.id));
  if (deleteIndex !== -1) {
    state.groups.splice(deleteIndex, 1);
  }
  refreshEditors(state);
}

export function saveProject(state: State) {
  if (state.groups.length === 0) {
    vscode.window.showErrorMessage('There is no filter groups');
    return;
  }

  const selected = state.projects.find(p => (p.selected === true));
  if (selected === undefined) {
    vscode.window.showErrorMessage('There is no selected project');
    return;
  }

  selected.groups = state.groups;
  saveSettings(state.globalStorageUri, state.projects);

  setStatusBarMessage(`Project(${selected.name}) is saved.`);
}

export function addProject(state: State) {
  vscode.window.showInputBox({
    prompt: "[PROJECT] Type a new project name",
    ignoreFocusOut: false
  }).then(name => {
    if (name === undefined) {
      return;
    }

    const project = {
      groups: [],
      name,
      id: `${Math.random()}`,
      selected: false
    };

    state.projects.push(project);
    saveSettings(state.globalStorageUri, state.projects);
    updateProjectTreeView(state);
  });
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
        state.projects[findIndex].name = name;
        saveSettings(state.globalStorageUri, state.projects);
        updateProjectTreeView(state);

        callback();
      }
    });
}

export async function handleLastProjectDeletion(treeItem: vscode.TreeItem, state: State) {
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
  const selectedIndex = getProjectSelectedIndex(state.projects);
  const deleteIndex = state.projects.findIndex(project => (project.id === treeItem.id));
  if (deleteIndex !== -1) {
    if (deleteIndex === selectedIndex) {
      state.groups = [];
      updateFilterTreeViewAndFocusProvider(state);
      refreshEditors(state);
    }
    state.projects.splice(deleteIndex, 1);
    saveSettings(state.globalStorageUri, state.projects);
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
  state.projects = readSettings(state.globalStorageUri);
  var selectedIndex = -1;

  // Automatically activate the project if there is only one
  if (state.projects.length === 1) {
    selectedIndex = 0;
  }

  // Add a project named "NONAMED" in the following cases:
  // - A default project is generated for users who do not use the project feature.
  // - If multiple projects are available but none is selected, an empty project is created and selected.
  if (state.projects.length === 0) {
    createDefaultProject(state);
    saveSettings(state.globalStorageUri, state.projects);
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
}

export function selectProject(treeItem: vscode.TreeItem, state: State): boolean {
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
  const selectedIndex = getProjectSelectedIndex(state.projects);
  if (selectedIndex === -1) {
    view.title = 'Filters+';
  } else {
    view.title = 'Filters+ (' + state.projects[selectedIndex].name + ')';
  }
}

export function addExFilter(state: State) {
  vscode.window.showInputBox({
    prompt: "[FILTER] Type a regex to exclusion filter",
    ignoreFocusOut: false
  }).then(regexStr => {
    if (regexStr === undefined) {
      return;
    }
    const id = `${Math.random()}`;
    const exFilter = {
      isHighlighted: false, // don't care
      isShown: true,
      regex: new RegExp(regexStr),
      color: generateRandomColor(), // don't care
      id,
      iconPath: generateSvgUri(generateRandomColor(), false),
      count: 0 // don't care
    };

    state.exFilters.push(exFilter);
    refreshEditors(state);
  });
}

export function deleteExGroup(state: State) {
  state.exFilters.splice(0, state.exFilters.length);
  refreshEditors(state);
}

// Project Settings Management Commands

export async function loadProjectSettings(context: vscode.ExtensionContext, state: State) {
  const manager = ProjectSettingsManager.getInstance(context);
  
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
    const settings = await manager.loadProjectSettings(fileUri[0].fsPath);
    if (settings) {
      await manager.applyProjectSettings(settings, state);
      // Refresh the UI to reflect filter changes
      refreshEditors(state);
    }
  }
}

export async function saveProjectSettings(context: vscode.ExtensionContext, state: State) {
  const manager = ProjectSettingsManager.getInstance(context);
  
  // If we have a current project settings file, save to it
  if (manager.getCurrentSettingsPath()) {
    await manager.saveProjectSettings(undefined, state);
  } else {
    // If no external project settings file, offer choice between internal and external save
    const choice = await vscode.window.showQuickPick([
      {
        label: "Save to External Project File",
        description: "Create shareable JSON settings file",
        detail: "Save filters and settings to external file for team sharing"
      },
      {
        label: "Save to Internal Project",
        description: "Save to VS Code extension storage",  
        detail: "Save filter groups to currently selected internal project"
      }
    ], {
      placeHolder: "Choose how to save your project settings",
      title: "Project Settings Save Options"
    });

    if (choice?.label === "Save to External Project File") {
      await createProjectSettings(context, state);
    } else if (choice?.label === "Save to Internal Project") {
      // Call the original saveProject functionality
      saveProject(state);
    }
  }
}

export async function createProjectSettings(context: vscode.ExtensionContext, state?: State) {
  const manager = ProjectSettingsManager.getInstance(context);
  
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
    await manager.saveProjectSettings(fileUri.fsPath, state);
  }
}

export async function refreshProjectSettings(context: vscode.ExtensionContext, state: State) {
  const manager = ProjectSettingsManager.getInstance(context);
  
  if (!manager.getCurrentSettingsPath()) {
    vscode.window.showWarningMessage('No project settings file to refresh');
    return;
  }

  const settings = await manager.loadProjectSettings();
  if (settings) {
    await manager.applyProjectSettings(settings, state);
    refreshEditors(state);
    vscode.window.showInformationMessage(`$(refresh) Refreshed project settings from: ${manager.getCurrentSettingsPath()}`);
  }
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
