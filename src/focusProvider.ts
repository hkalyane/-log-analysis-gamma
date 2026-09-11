import * as vscode from "vscode";
import { Filter, Group } from "./utils";
import { DocumentCacheManager } from "./documentCache";
import { FocusResult } from './logProcessor';
import { logProcessing } from './processing';
import { TimeProfile, TimeSummary } from './timeFilter';

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
  public timelines = new Map<string, TimeSummary>();
  private generations = new Map<string, number>();
  private documentVersions = new Map<string, number>();
  private lineMapEmitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidUpdateLineMap = this.lineMapEmitter.event;

  //open the original document specified by the uri and return the focused version of its text
  async provideTextDocumentContent(uri: vscode.Uri, token?: vscode.CancellationToken): Promise<string> {
    let originalUri = vscode.Uri.parse(uri.path);
    const key = originalUri.toString();
    const generation = (this.generations.get(key) || 0) + 1;
    this.generations.set(key, generation);
    logProcessing.cancel('focus:' + key);
    let sourceCode = await vscode.workspace.openTextDocument(originalUri);
    const version = sourceCode.version;
    if (this.generations.get(key) !== generation || logProcessing.paused) {
      throw new vscode.CancellationError();
    }

    // Performance optimization: use document cache
    const cacheManager = DocumentCacheManager.getInstance();
    const documentCache = cacheManager.getCache(sourceCode);
    const lines = documentCache.getLines();
    const config = vscode.workspace.getConfiguration('logAnalysisGamma');
    const before = Math.max(0, Math.min(100, config.get<number>('contextBefore', 0)));
    const after = Math.max(0, Math.min(100, config.get<number>('contextAfter', 0)));
    const timeProfile = config.get<Record<string, TimeProfile>>('timeProfiles', {})[originalUri.toString()];

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
    if (activeShownFilters.length === 0 && !timeProfile) {
      this.documentLineMap.set(originalUri.fsPath, resultLineArr);
      this.documentVersions.set(key, version);
      this.timelines.delete(originalUri.toString());
      this.lineMapEmitter.fire(uri);
      return resultArr.join("\n");
    }

    const exclusions = this.exFilters.filter(filter => filter.isShown);
    const pattern = (filter: Filter) => ({ regex: filter.regex.source, flags: filter.regex.flags, id: filter.id });
    const result = await logProcessing.run<FocusResult>('focus:' + originalUri.toString(), 'focus', {
      lines, before, after, timeProfile: timeProfile ? { ...timeProfile } : undefined,
      filters: activeShownFilters.map(pattern), exclusions: exclusions.map(pattern)
    }, token);
    if (sourceCode.version !== version || this.generations.get(key) !== generation) {
      throw new vscode.CancellationError();
    }
    result.counts.forEach((count, index) => exclusions[index].count = count);
    if (result.timeline) {
      this.timelines.set(originalUri.toString(), result.timeline);
    } else {
      this.timelines.delete(originalUri.toString());
    }
    result.indices.forEach(index => {
      resultArr.push(lines[index]);
      resultLineArr.push(index);
    });

    if (resultLineArr.length) {
      this.documentLineMap.set(originalUri.fsPath, resultLineArr);
      this.documentVersions.set(key, version);
      this.lineMapEmitter.fire(uri);
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
    const version = this.documentVersions.get(originalUri.toString());
    const original = vscode.workspace.textDocuments.find(document => document.uri.toString() === originalUri.toString());
    if (version !== undefined && original && original.version !== version) {
      return undefined;
    }
    const lineMap = this.documentLineMap.get(originalUri.fsPath);
    if (lineMap && focusLineNumber < lineMap.length) {
      return lineMap[focusLineNumber];
    }
    return undefined;
  }
}
