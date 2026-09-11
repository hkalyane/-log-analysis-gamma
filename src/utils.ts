import * as vscode from "vscode";

// One filter corresponds to one line in the configuration file
export type Filter = {
  sourcePath?: string;
  isHighlighted: boolean; // if the matching lines will be highlighted
  isShown: boolean; //if the matching lines will be kept in focus mode
  regex: RegExp;
  color: string;
  id: string; //random generated number
  iconPath: vscode.Uri; //dataUri representing the isHighlighted/isNotHighlighted svg icon
  count: number; //count of lines which match the filter in the active editor
};

export type Group = {
  sourcePath?: string;
  filters: Filter[];
  isHighlighted: boolean; // if the matching lines will be highlighted
  isShown: boolean; //if the matching lines will be kept in focus mode
  name: string;
  id: string; //random generated number
};

export type Project = {
  sourcePath?: string;
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

// Random color generation with smart selection
export function generateSmartRandomColor(): string {
  const predefinedColors = getPredefinedColors().map(c => c.color);
  const additionalRandomColors = [
    "#ff6b6b", "#4ecdc4", "#45b7d1", "#96ceb4", "#feca57",
    "#ff9ff3", "#54a0ff", "#5f27cd", "#0abde3", "#00d2d3",
    "#ff9f43", "#feca57", "#ff6348", "#ff4757", "#c44569",
    "#f8b500", "#e17055", "#81ecec", "#74b9ff", "#a29bfe"
  ];
  
  // Combine predefined and additional random colors
  const allColors = [...predefinedColors, ...additionalRandomColors];
  
  // Select random color from the combined pool
  const randomIndex = Math.floor(Math.random() * allColors.length);
  return allColors[randomIndex];
}

// Generate truly random color
export function generateTrulyRandomColor(): string {
  // Generate random HSL color with good saturation and lightness
  const hue = Math.floor(Math.random() * 360);
  const saturation = Math.floor(Math.random() * 40) + 40; // 40-80%
  const lightness = Math.floor(Math.random() * 30) + 35;  // 35-65%
  
  // Convert HSL to hex
  const hslToHex = (h: number, s: number, l: number) => {
    l /= 100;
    const a = s * Math.min(l, 1 - l) / 100;
    const f = (n: number) => {
      const k = (n + h / 30) % 12;
      const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
      return Math.round(255 * color).toString(16).padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
  };
  
  return hslToHex(hue, saturation, lightness);
}

// User color memory system
export class UserColorMemory {
  private static readonly STORAGE_KEY = 'logAnalysisGamma.userColors';
  private static readonly MAX_COLORS_KEY = 'logAnalysisGamma.maxRememberedColors';
  private static readonly NOTIFICATIONS_KEY = 'logAnalysisGamma.showRandomColorNotifications';
  
  static getRememberedColors(): string[] {
    const stored = vscode.workspace.getConfiguration().get<string[]>(this.STORAGE_KEY, []);
    return stored.filter(color => this.isValidHexColor(color));
  }
  
  static addColorToMemory(color: string): void {
    if (!this.isValidHexColor(color)) return;
    
    const maxColors = vscode.workspace.getConfiguration().get<number>(this.MAX_COLORS_KEY, 10);
    const remembered = this.getRememberedColors();
    
    // Remove if already exists to avoid duplicates
    const filtered = remembered.filter(c => c.toLowerCase() !== color.toLowerCase());
    // Add to beginning of array
    const updated = [color, ...filtered].slice(0, maxColors);
    
    // Store in workspace configuration
    vscode.workspace.getConfiguration().update(this.STORAGE_KEY, updated, vscode.ConfigurationTarget.Global);
  }
  
  static clearColorMemory(): void {
    vscode.workspace.getConfiguration().update(this.STORAGE_KEY, [], vscode.ConfigurationTarget.Global);
  }
  
  static removeColorFromMemory(colorToRemove: string): void {
    if (!this.isValidHexColor(colorToRemove)) return;
    
    const remembered = this.getRememberedColors();
    const filtered = remembered.filter(c => c.toLowerCase() !== colorToRemove.toLowerCase());
    
    // Update storage with the color removed
    vscode.workspace.getConfiguration().update(this.STORAGE_KEY, filtered, vscode.ConfigurationTarget.Global);
  }
  
  static shouldShowNotifications(): boolean {
    return vscode.workspace.getConfiguration().get<boolean>(this.NOTIFICATIONS_KEY, true);
  }
  
  static getMaxRememberedColors(): number {
    return vscode.workspace.getConfiguration().get<number>(this.MAX_COLORS_KEY, 10);
  }
  
  private static isValidHexColor(color: string): boolean {
    return /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(color);
  }
}
