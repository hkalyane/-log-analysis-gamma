import * as vscode from "vscode";
import { Filter, Group } from "./utils";
import { DocumentCacheManager } from "./documentCache";

//Provide virtual documents as a strings that only contain lines matching shown filters.
//These virtual documents have uris of the form "focus-gamma:<original uri>" where
//<original uri> is the escaped uri of the original, unfocused document.
//VSCode uses this provider to generate virtual read-only files based on real files
export class FocusProvider implements vscode.TextDocumentContentProvider {
  constructor(private groups: Group[], private exFilters: Filter[]) {
  }

  /**
   * documentLineMap stores an array of line numbers for each original file's path (fsPath).
   * The key is the fsPath of the original file, and the value is an array of line numbers
   * that match the filtering criteria.
   */
  public documentLineMap: Map<string, number[]> = new Map();

  //open the original document specified by the uri and return the focused version of its text
  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    let originalUri = vscode.Uri.parse(uri.path);
    let sourceCode = await vscode.workspace.openTextDocument(originalUri);

    // Performance optimization: use document cache
    const cacheManager = DocumentCacheManager.getInstance();
    const documentCache = cacheManager.getCache(sourceCode);
    const lines = documentCache.getLines();

    // start the string with an empty line to make room for the focus mode text decoration
    let resultArr: string[] = [""];
    let resultLineArr: number[] = [0];

    // Performance optimization: reset exclusion filter counts efficiently
    this.exFilters.forEach(exFilter => {
      exFilter.count = 0;
    });

    // Performance optimization: collect all active shown filters first
    const activeShownFilters: Filter[] = [];
    for (const group of this.groups) {
      for (const filter of group.filters) {
        if (filter.isShown) {
          activeShownFilters.push(filter);
        }
      }
    }

    // Early exit if no active filters
    if (activeShownFilters.length === 0) {
      return resultArr.join("\n");
    }

    // Performance optimization: process each line only once
    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx];
      let lineMatched = false;

      // Check if line matches any active shown filter
      for (const filter of activeShownFilters) {
        if (filter.regex.test(line)) {
          // Check exclusion filters
          let isExcluded = false;
          for (const exFilter of this.exFilters) {
            if (exFilter.isShown && exFilter.regex.test(line)) {
              isExcluded = true;
              if (exFilter.count === undefined) {
                exFilter.count = 0;
              }
              exFilter.count++;
              break; // Exit early from exclusion check
            }
          }
          
          if (!isExcluded) {
            resultArr.push(line);
            resultLineArr.push(lineIdx);
          }
          lineMatched = true;
          break; // Exit early from filter check since line is already matched
        }
      }
    }

    if (resultLineArr.length) {
      this.documentLineMap.set(originalUri.fsPath, resultLineArr);
    }
    return resultArr.join("\n");
  }

  private onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.onDidChangeEmitter.event;

  //when this function gets called, the provideTextDocumentContent will be called again
  refresh(uri: vscode.Uri): void {
    console.log("provider: refresh all");
    this.onDidChangeEmitter.fire(uri);
  }

  update(groups: Group[]) {
    this.groups = groups;
  }

  getOriginalUri(focusUri: vscode.Uri): vscode.Uri {
    return vscode.Uri.parse(focusUri.path);
  }

  getOriginalLineNumber(focusUriString: string, focusLineNumber: number): number | undefined {
    const focusUri = vscode.Uri.parse(focusUriString);
    const originalUri = vscode.Uri.parse(focusUri.path);
    const lineMap = this.documentLineMap.get(originalUri.fsPath);
    if (lineMap && focusLineNumber < lineMap.length) {
      return lineMap[focusLineNumber];
    }
    return undefined;
  }
}
