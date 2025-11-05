import * as vscode from "vscode";
import { State, applyNoUnderlineDecoration } from "./extension";
import { generateRandomColor, generateSvgUri, setStatusBarMessage, getProjectSelectedIndex, setProjectSelectedFlag, getPredefinedColors, generateSmartRandomColor, generateTrulyRandomColor, UserColorMemory } from "./utils";
import { readSettings, saveSettings } from "./settings";
import { DocumentCacheManager } from "./documentCache";
import { PerformanceUtils } from "./performanceUtils";

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
  editors: readonly vscode.TextEditor[]
): void {
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

  editors.forEach((editor) => {
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
    label: "🌈 Truly Random Color",
    description: "Generate completely random color",
    detail: "Generate a completely random color with good saturation and lightness",
    iconPath: new vscode.ThemeIcon("color-mode")
  });

  // Add recently used colors if available
  const rememberedColors = UserColorMemory.getRememberedColors();
  if (rememberedColors.length > 0) {
    // Add recently used colors
    rememberedColors.forEach((color, index) => {
      colorItems.push({
        label: `🕒 Recently Used #${index + 1}`,
        description: color,
        detail: `Previously used color (${color})`,
        iconPath: new vscode.ThemeIcon("history")
      });
    });
  }

  // Add a custom color option
  colorItems.push({
    label: "Custom Color",
    description: "Enter custom hex color",
    detail: "Define your own color using hex code (e.g., #ff5733)",
    iconPath: new vscode.ThemeIcon("edit")
  });

  vscode.window.showQuickPick(colorItems, {
    placeHolder: "Select a color for the filter (scroll to see all options)",
    matchOnDescription: true,
    matchOnDetail: true,
    title: "🎨 Filter Color Selection",
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

    if (selectedItem.label === "🌈 Truly Random Color") {
      selectedColor = generateTrulyRandomColor();
      UserColorMemory.addColorToMemory(selectedColor);
      applyColorToFilter(selectedColor, treeItem, state);
      if (UserColorMemory.shouldShowNotifications()) {
        vscode.window.showInformationMessage(`🌈 Applied truly random color: ${selectedColor}`);
      }
      return;
    }

    if (selectedItem.label === "Custom Color") {
      console.log("Custom color selected - showing input box");
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
  vscode.window.showInformationMessage('🧹 Recently used colors cleared!');
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
  applyHighlight(state, vscode.window.visibleTextEditors);
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
  applyHighlight(state, vscode.window.visibleTextEditors);
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
