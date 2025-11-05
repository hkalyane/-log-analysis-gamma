import * as vscode from "vscode";

/**
 * Performance utilities for debouncing and batching operations
 */
export class PerformanceUtils {
  private static refreshTimeout: NodeJS.Timeout | null = null;
  private static pendingRefresh = false;

  /**
   * Debounced refresh to prevent excessive calls during rapid changes
   */
  static debouncedRefreshEditors(
    refreshFunction: () => void, 
    delay: number = 100
  ): void {
    if (this.refreshTimeout) {
      clearTimeout(this.refreshTimeout);
    }

    this.refreshTimeout = setTimeout(() => {
      if (this.pendingRefresh) {
        refreshFunction();
        this.pendingRefresh = false;
      }
    }, delay);
    
    this.pendingRefresh = true;
  }

  /**
   * Get active filters to avoid processing when no filters are highlighted
   */
  static getActiveFilters(groups: any[]): any[] {
    const activeFilters: any[] = [];
    
    for (const group of groups) {
      for (const filter of group.filters) {
        if (filter.isHighlighted) {
          activeFilters.push(filter);
        }
      }
    }
    
    return activeFilters;
  }

  /**
   * Batch decorations by color to reduce DOM operations
   */
  static batchDecorationsByColor(
    filterRanges: Array<{ filter: any; ranges: vscode.Range[] }>
  ): Map<string, { ranges: vscode.Range[]; filters: any[] }> {
    const colorBatches = new Map<string, { ranges: vscode.Range[]; filters: any[] }>();

    for (const { filter, ranges } of filterRanges) {
      if (ranges.length === 0) continue;

      const color = filter.color;
      if (!colorBatches.has(color)) {
        colorBatches.set(color, { ranges: [], filters: [] });
      }

      const batch = colorBatches.get(color)!;
      batch.ranges.push(...ranges);
      batch.filters.push(filter);
    }

    return colorBatches;
  }

  /**
   * Apply batched decorations efficiently
   */
  static applyBatchedDecorations(
    editor: vscode.TextEditor,
    colorBatches: Map<string, { ranges: vscode.Range[]; filters: any[] }>,
    decorations: vscode.TextEditorDecorationType[]
  ): vscode.TextEditorDecorationType[] {
    const newDecorations: vscode.TextEditorDecorationType[] = [];

    for (const [color, batch] of colorBatches) {
      if (batch.ranges.length === 0) continue;

      const decorationType = vscode.window.createTextEditorDecorationType({
        backgroundColor: color,
        isWholeLine: true,
      });

      newDecorations.push(decorationType);
      editor.setDecorations(decorationType, batch.ranges);
    }

    return newDecorations;
  }

  /**
   * Check if editor is in focus mode to avoid unnecessary processing
   */
  static isFocusModeEditor(editor: vscode.TextEditor): boolean {
    return editor.document.uri.toString().startsWith('focus-gamma:');
  }

  /**
   * Dispose decorations safely
   */
  static disposeDecorations(decorations: vscode.TextEditorDecorationType[]): void {
    decorations.forEach(decoration => {
      try {
        decoration.dispose();
      } catch (error) {
        console.warn('Error disposing decoration:', error);
      }
    });
  }
}