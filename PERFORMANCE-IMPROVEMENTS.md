# Performance Optimization Plan for Log Analysis Gamma

## 🔥 Critical Performance Bottlenecks Identified

### 1. **`applyHighlight` Function - O(n³) Complexity**
**Location:** `src/commands.ts:20-74`

**Current Issues:**
- Triple nested loops: `editors × groups × filters × lines`
- Text splitting called multiple times for same document
- Regex testing every line against every filter
- Multiple decoration creations and applications

**Optimization Strategy:**
```typescript
// Instead of current approach:
editors.forEach(editor => {
  let sourceCode = editor.document.getText(); // ❌ Called multiple times
  const sourceCodeArr = sourceCode.split("\n"); // ❌ Expensive operation repeated
  
  state.groups.forEach(group => {
    group.filters.forEach(filter => { // ❌ O(n³) complexity
      for (let lineIdx = 0; lineIdx < sourceCodeArr.length; lineIdx++) {
        if (filter.regex.test(sourceCodeArr[lineIdx])) { // ❌ Regex test for every line
```

**Proposed Solution:**
```typescript
// ✅ Optimized approach:
export function applyHighlightOptimized(state: State, editors: readonly vscode.TextEditor[]): void {
  // 1. Early exit if no highlighted filters
  const activeFilters = getActiveFilters(state);
  if (activeFilters.length === 0) return;

  // 2. Process each editor once
  editors.forEach(editor => {
    const documentCache = getOrCreateDocumentCache(editor.document);
    
    // 3. Batch decorations by color to reduce DOM operations
    const decorationMap = new Map<string, vscode.Range[]>();
    
    // 4. Single pass through lines
    activeFilters.forEach(filter => {
      const ranges = documentCache.getMatchingRanges(filter.regex);
      if (ranges.length > 0) {
        decorationMap.set(filter.color, [...(decorationMap.get(filter.color) || []), ...ranges]);
      }
    });
    
    // 5. Apply decorations in batches
    applyBatchedDecorations(editor, decorationMap);
  });
}
```

### 2. **Document Text Processing - Repeated Operations**
**Current Issues:**
- `editor.document.getText()` called multiple times for same document
- `sourceCode.split("\n")` repeated per filter
- No caching of line-by-line analysis

**Solution - Document Caching:**
```typescript
class DocumentCache {
  private lineCache: string[] | null = null;
  private regexResultCache = new Map<string, number[]>();

  constructor(private document: vscode.TextDocument) {}

  getLines(): string[] {
    if (!this.lineCache) {
      this.lineCache = this.document.getText().split('\n');
    }
    return this.lineCache;
  }

  getMatchingRanges(regex: RegExp): vscode.Range[] {
    const regexKey = regex.source + regex.flags;
    
    if (!this.regexResultCache.has(regexKey)) {
      const lines = this.getLines();
      const matchingLines: number[] = [];
      
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
          matchingLines.push(i);
        }
      }
      
      this.regexResultCache.set(regexKey, matchingLines);
    }
    
    return this.regexResultCache.get(regexKey)!.map(lineIdx => 
      new vscode.Range(lineIdx, 0, lineIdx, 0)
    );
  }
}
```

### 3. **`refreshEditors` Function - Excessive Calls**
**Location:** `src/commands.ts:291-318`

**Issues:**
- Called on every filter change, even minor ones
- Creates new decoration types every time
- No debouncing for rapid changes

**Solution - Debounced Refresh:**
```typescript
class PerformanceOptimizer {
  private refreshTimeout: NodeJS.Timeout | null = null;
  private pendingRefresh = false;

  debouncedRefreshEditors(state: State, delay = 100) {
    if (this.refreshTimeout) {
      clearTimeout(this.refreshTimeout);
    }

    this.refreshTimeout = setTimeout(() => {
      if (this.pendingRefresh) {
        refreshEditors(state);
        this.pendingRefresh = false;
      }
    }, delay);
    
    this.pendingRefresh = true;
  }
}
```

### 4. **Focus Provider - Inefficient Line Processing**
**Location:** `src/focusProvider.ts:28-69`

**Issues:**
- Nested loops for every focus mode document generation
- No line caching between focus mode refreshes
- Exclusion filter processing not optimized

**Solution - Precomputed Line Mapping:**
```typescript
class OptimizedFocusProvider {
  private documentLineMapping = new Map<string, ProcessedDocument>();

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const originalUri = vscode.Uri.parse(uri.path);
    const cacheKey = originalUri.toString();
    
    // Check if we have cached results
    if (this.documentLineMapping.has(cacheKey)) {
      const cached = this.documentLineMapping.get(cacheKey)!;
      if (cached.isValid(this.groups, this.exFilters)) {
        return cached.getContent();
      }
    }
    
    // Process document and cache results
    const processed = await this.processDocument(originalUri);
    this.documentLineMapping.set(cacheKey, processed);
    
    return processed.getContent();
  }
}
```

### 5. **Tree View Updates - Unnecessary Refreshes**
**Location:** Multiple tree view providers

**Issues:**
- Full tree refresh on single item changes
- No incremental updates
- Cache not utilized effectively

**Solution - Incremental Updates:**
```typescript
// In FilterTreeViewProvider
refresh(element?: vscode.TreeItem): void {
  if (element) {
    // ✅ Update only specific element
    this.updateElement(element);
    this._onDidChangeTreeData.fire(element);
  } else {
    // ✅ Only do full refresh when absolutely necessary
    this._onDidChangeTreeData.fire(undefined);
  }
}
```

## 📊 Performance Metrics to Track

1. **Time to highlight** (target: <100ms for 10k lines)
2. **Focus mode generation time** (target: <200ms)
3. **Memory usage** (avoid memory leaks from decorations)
4. **Tree view update latency** (target: <50ms)

## 🛠️ Implementation Priority

### Phase 1 - Critical (High Impact, Low Risk)
1. **Document caching** - Cache split lines per document
2. **Decoration batching** - Group decorations by color
3. **Early exits** - Skip processing when no active filters

### Phase 2 - Major (High Impact, Medium Risk)
1. **Debounced updates** - Reduce excessive refresh calls
2. **Incremental tree updates** - Update specific elements only
3. **Regex optimization** - Cache regex results

### Phase 3 - Advanced (Medium Impact, Higher Risk)
1. **Web Worker processing** - Move heavy regex work off main thread
2. **Virtual scrolling** - For very large files
3. **Background processing** - Pre-compute common patterns

## 🔧 Quick Wins (Can implement immediately)

1. **Add early exits in applyHighlight**
2. **Cache document.getText().split('\n')**
3. **Batch decoration applications**
4. **Debounce refreshEditors calls**
5. **Use WeakMap for document caches**

## 📈 Expected Performance Gains

- **Highlighting**: 60-80% faster for large files
- **Focus mode**: 40-60% faster generation
- **Memory usage**: 30-50% reduction in decoration overhead
- **Responsiveness**: Eliminate UI freezing for files >1000 lines