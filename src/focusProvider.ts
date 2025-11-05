import * as vscode from "vscode";
import { Filter, Group } from "./utils";

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

    // start the string with an empty line to make room for the focus mode text decoration
    let resultArr: string[] = [""];
    let resultLineArr: number[] = [0];

    this.exFilters.forEach(exFilter => {
      exFilter.count = 0;
    });

    for (let lineIdx = 0; lineIdx < sourceCode.lineCount; lineIdx++) {
      const line = sourceCode.lineAt(lineIdx).text;
      for (const group of this.groups) {
        for (const filter of group.filters) {
          if (!filter.isShown) {
            continue;
          }
          let regex = filter.regex;
          if (regex.test(line)) {
            let isExcluded = false;
            this.exFilters.forEach(exFilter => {
              if (exFilter.isShown && exFilter.regex.test(line)) {
                isExcluded = true;
                if (exFilter.count === undefined) {
                  exFilter.count = 0;
                }
                exFilter.count++;
              }
            });
            if (!isExcluded) {
              resultArr.push(line);
              resultLineArr.push(lineIdx);
            }
            break;
          }
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
}
