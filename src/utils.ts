import * as vscode from "vscode";

// One filter corresponds to one line in the configuration file
export type Filter = {
  isHighlighted: boolean; // if the matching lines will be highlighted
  isShown: boolean; //if the matching lines will be kept in focus mode
  regex: RegExp;
  color: string;
  id: string; //random generated number
  iconPath: vscode.Uri; //dataUri representing the isHighlighted/isNotHighlighted svg icon
  count: number; //count of lines which match the filter in the active editor
};

export type Group = {
  filters: Filter[];
  isHighlighted: boolean; // if the matching lines will be highlighted
  isShown: boolean; //if the matching lines will be kept in focus mode
  name: string;
  id: string; //random generated number
};

export type Project = {
  groups: Group[];
  name: string;
  id: string;
  selected: boolean;
};

export function generateRandomColor(): string {
  return `hsl(${Math.floor(360 * Math.random())}, 40%, 40%)`;
}

export function getPredefinedColors(): { label: string; color: string; name: string }[] {
  return [
    { label: "🔴", color: "#e74c3c", name: "Red" },
    { label: "🟠", color: "#e67e22", name: "Orange" },  
    { label: "🟡", color: "#f1c40f", name: "Yellow" },
    { label: "🟢", color: "#27ae60", name: "Green" },
    { label: "🔵", color: "#3498db", name: "Blue" },
    { label: "🟣", color: "#9b59b6", name: "Purple" },
    { label: "🟤", color: "#8b4513", name: "Brown" },
    { label: "⚫", color: "#2c3e50", name: "Dark Gray" },
    { label: "⚪", color: "#95a5a6", name: "Light Gray" },
    { label: "🟥", color: "#c0392b", name: "Dark Red" },
    { label: "🟧", color: "#d35400", name: "Dark Orange" },
    { label: "🟨", color: "#f39c12", name: "Dark Yellow" },
    { label: "🟩", color: "#16a085", name: "Teal" },
    { label: "🟦", color: "#2980b9", name: "Dark Blue" },
    { label: "🟪", color: "#8e44ad", name: "Dark Purple" },
  ];
}

// Creates an svg icon representing a filter: a filled circle if the filter is highlighted, or an empty circle otherwise.
// this icon is stored as a dataUri.
export function generateSvgUri(
  color: string,
  isHighlighted: boolean
): vscode.Uri {
  const fullSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle fill="${color}" cx="50" cy="50" r="50"/></svg>`;
  const emptySvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle stroke="${color}" fill="transparent" stroke-width="10" cx="50" cy="50" r="45"/></svg>`;
  const svgContent = isHighlighted ? fullSvg : emptySvg;
  const dataUri = `data:image/svg+xml;base64,${btoa(svgContent)}`;
  return vscode.Uri.parse(dataUri);
}

export function setStatusBarMessage(message: string) {
  vscode.window.setStatusBarMessage(`LOG ANALYSIS: ${message}`, 5000);
}

export function getProjectSelectedIndex(projects: Project[]): number {
  const selectedIndex = projects.findIndex(p => p.selected);
  return selectedIndex;
}

export function setProjectSelectedFlag(projects: Project[], index: number) {
  projects.forEach(p => p.selected = false);

  if (index >= 0 && index < projects.length) {
    projects[index].selected = true;
  } else {
    console.log(`Invalid index: ${index}`);
  }
}
