import * as vscode from "vscode";
import { logProcessing } from './processing';

/**
 * Document cache to avoid repeated text splitting and regex processing
 * Provides significant performance improvements for large files with multiple filters
 */
export class DocumentCache {
  private lineCache: string[] | null = null;
  private regexResultCache = new Map<string, number[]>();
  private version: number;

  constructor(private document: vscode.TextDocument) {
    this.version = document.version;
  }

  /**
   * Check if cache is still valid (document hasn't changed)
   */
  isValid(): boolean {
    return this.version === this.document.version;
  }

  /**
   * Get document lines with caching to avoid repeated split operations
   */
  getLines(): string[] {
    if (!this.lineCache) {
      this.lineCache = this.document.getText().split('\n');
    }
    return this.lineCache;
  }

  /**
   * Get line numbers that match a regex pattern with caching
   */
  getMatchingLines(regex: RegExp): number[] {
    const regexKey = regex.source + '|' + regex.flags;
    
    if (!this.regexResultCache.has(regexKey)) {
      const lines = this.getLines();
      const matchingLines: number[] = [];
      
      for (let i = 0; i < lines.length; i++) {
        regex.lastIndex = 0;
        if (regex.test(lines[i])) {
          matchingLines.push(i);
        }
      }
      
      this.regexResultCache.set(regexKey, matchingLines);
    }
    
    return this.regexResultCache.get(regexKey)!;
  }

  async getMatchingLinesBatch(regexes: RegExp[]): Promise<number[][]> {
    if (!this.isValid()) {
      throw new vscode.CancellationError();
    }
    const keys = regexes.map(regex => regex.source + '|' + regex.flags);
    const missing = regexes.filter((_regex, index) => !this.regexResultCache.has(keys[index]));
    if (missing.length) {
      const results = await logProcessing.run<number[][]>('highlight:' + this.document.uri.toString(), 'highlights', {
        lines: this.getLines(), filters: missing.map((regex, index) => ({ id: String(index), regex: regex.source, flags: regex.flags }))
      });
      if (!this.isValid()) {
        throw new vscode.CancellationError();
      }
      results.forEach((matches, index) => this.regexResultCache.set(missing[index].source + '|' + missing[index].flags, matches));
    }
    return keys.map(key => this.regexResultCache.get(key)!);
  }

  /**
   * Get VSCode ranges for matching lines
   */
  getMatchingRanges(regex: RegExp): vscode.Range[] {
    const matchingLines = this.getMatchingLines(regex);
    return matchingLines.map(lineIdx => 
      new vscode.Range(
        new vscode.Position(lineIdx, 0),
        new vscode.Position(lineIdx, 0)
      )
    );
  }

  /**
   * Clear all caches when document changes
   */
  invalidate(): void {
    this.lineCache = null;
    this.regexResultCache.clear();
    this.version = this.document.version;
  }
}

/**
 * Global document cache manager to avoid repeated processing
 */
export class DocumentCacheManager {
  private static instance: DocumentCacheManager;
  private caches = new WeakMap<vscode.TextDocument, DocumentCache>();

  public static getInstance(): DocumentCacheManager {
    if (!DocumentCacheManager.instance) {
      DocumentCacheManager.instance = new DocumentCacheManager();
    }
    return DocumentCacheManager.instance;
  }

  /**
   * Get or create cache for a document
   */
  getCache(document: vscode.TextDocument): DocumentCache {
    let cache = this.caches.get(document);
    
    if (!cache || !cache.isValid()) {
      cache = new DocumentCache(document);
      this.caches.set(document, cache);
    }
    
    return cache;
  }

  /**
   * Clear cache for a specific document
   */
  clearCache(document: vscode.TextDocument): void {
    this.caches.delete(document);
  }

  /**
   * Clear all caches (useful for testing or memory cleanup)
   */
  clearAllCaches(): void {
    this.caches = new WeakMap();
  }
}