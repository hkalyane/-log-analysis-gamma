// Enhanced Editor Management System for Smart Log Highlighter
// This module provides selective editor processing for optimal performance

import * as vscode from 'vscode';
import { State } from './extension';

export class EditorManager {
    private static instance: EditorManager;
    private targetedEditors: Set<vscode.TextEditor> = new Set();
    private editorFileTypes: Map<string, string[]> = new Map();
    
    static getInstance(): EditorManager {
        if (!EditorManager.instance) {
            EditorManager.instance = new EditorManager();
        }
        return EditorManager.instance;
    }

    /**
     * Strategy 1: Apply filters only to ACTIVE editor (best performance)
     */
    static getActiveEditorOnly(): vscode.TextEditor[] {
        const activeEditor = vscode.window.activeTextEditor;
        return activeEditor ? [activeEditor] : [];
    }

    /**
     * Strategy 2: Apply filters to VISIBLE editors in viewport (balanced)
     */
    static getVisibleEditorsOnly(): vscode.TextEditor[] {
        return vscode.window.visibleTextEditors.filter(editor => {
            // Only process editors that are actually visible to user
            return editor.viewColumn !== undefined;
        });
    }

    /**
     * Strategy 3: Smart editor selection based on file type (intelligent)
     */
    static getRelevantEditors(): vscode.TextEditor[] {
        // Get configurable file extensions from VS Code settings
        const config = vscode.workspace.getConfiguration('logAnalysisGamma');
        const logFileExtensions = config.get<string[]>('relevantFileExtensions', ['.log', '.txt', '.out', '.err', '.trace']);
        
        return vscode.window.visibleTextEditors.filter(editor => {
            const fileName = editor.document.fileName.toLowerCase();
            return logFileExtensions.some(ext => fileName.endsWith(ext.toLowerCase())) ||
                   editor.document.languageId === 'log' ||
                   editor.document.uri.scheme === 'output';
        });
    }

    /**
     * Strategy 4: User-controlled targeting (manual selection)
     */
    toggleEditorTargeting(editor: vscode.TextEditor): void {
        if (this.targetedEditors.has(editor)) {
            this.targetedEditors.delete(editor);
        } else {
            this.targetedEditors.add(editor);
        }
    }

    getTargetedEditors(): vscode.TextEditor[] {
        // Clean up closed editors
        this.targetedEditors.forEach(editor => {
            if (editor.document.isClosed) {
                this.targetedEditors.delete(editor);
            }
        });
        
        return Array.from(this.targetedEditors);
    }

    /**
     * Strategy 5: Adaptive selection based on performance
     */
    static getAdaptiveEditors(maxEditors: number = 3): vscode.TextEditor[] {
        const visibleEditors = vscode.window.visibleTextEditors;
        
        // If few editors, process all
        if (visibleEditors.length <= maxEditors) {
            return [...visibleEditors];
        }
        
        // Prioritize: Active > Recently used > Visible
        const activeEditor = vscode.window.activeTextEditor;
        const result: vscode.TextEditor[] = [];
        
        if (activeEditor) {
            result.push(activeEditor);
        }
        
        // Add other visible editors up to limit
        const remaining = visibleEditors
            .filter(e => e !== activeEditor)
            .slice(0, maxEditors - 1);
            
        return result.concat(remaining);
    }

    /**
     * Performance metrics and monitoring
     */
    static measurePerformance<T>(fn: () => T, label: string): T {
        const start = Date.now();
        const result = fn();
        const duration = Date.now() - start;
        console.log(`[EditorManager] ${label}: ${duration}ms`);
        return result;
    }
}

// Configuration for different strategies
export enum EditorSelectionStrategy {
    ACTIVE_ONLY = 'active',           // Best performance - only active editor
    VISIBLE_ONLY = 'visible',         // Balanced - all visible editors  
    RELEVANT_ONLY = 'relevant',       // Smart - only log files
    TARGETED_MANUAL = 'targeted',     // Manual - user selected editors
    ADAPTIVE = 'adaptive'             // Intelligent - adaptive based on load
}

export interface EditorConfig {
    strategy: EditorSelectionStrategy;
    maxEditors?: number;
    fileTypes?: string[];
    autoDetectLogFiles?: boolean;
    performanceMode?: boolean;
}