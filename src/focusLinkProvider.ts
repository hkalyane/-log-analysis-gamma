import * as vscode from "vscode";
import { FocusProvider } from "./focusProvider";

export class FocusLinkProvider implements vscode.DocumentLinkProvider {
  private focusProvider: FocusProvider;

  constructor(focusProvider: FocusProvider) {
    this.focusProvider = focusProvider;
  }

  provideDocumentLinks(
    document: vscode.TextDocument,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.DocumentLink[]> {
    // Only provide links for focus: scheme documents
    if (!document.uri.scheme.startsWith("focus")) {
      return [];
    }

    const links: vscode.DocumentLink[] = [];
    const originalUri = this.focusProvider.getOriginalUri(document.uri);

    // Create a link for each line in the focus document (except the header line)
    for (let lineNumber = 1; lineNumber < document.lineCount; lineNumber++) {
      const line = document.lineAt(lineNumber);
      if (line.text.trim().length === 0) {
        continue; // Skip empty lines
      }

      const originalLineNumber = this.focusProvider.getOriginalLineNumber(
        document.uri.toString(),
        lineNumber
      );

      if (originalLineNumber !== undefined) {
        // Create a range that covers the entire line
        const range = new vscode.Range(lineNumber, 0, lineNumber, line.text.length);
        
        // Create a URI that will open the original file at the specific line
        const targetUri = originalUri.with({
          fragment: `${originalLineNumber}`
        });

        const link = new vscode.DocumentLink(range, targetUri);
        link.tooltip = `Go to line ${originalLineNumber} in original file`;
        links.push(link);
      }
    }

    return links;
  }
}