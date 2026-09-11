import * as vscode from 'vscode';
import type { State } from './extension';
import { Filter, Group, Project } from './utils';

type Snapshot = { projects: Project[]; groups: Group[]; exclusions: Filter[] };
type Entry = { label: string; snapshot: Snapshot };

function cloneFilter(filter: Filter): Filter {
    return { ...filter, regex: new RegExp(filter.regex.source, filter.regex.flags), count: 0 };
}

function cloneGroups(groups: Group[]): Group[] {
    return groups.map(group => ({ ...group, filters: group.filters.map(cloneFilter) }));
}

function capture(state: State): Snapshot {
    return {
        projects: state.projects.map(project => ({ ...project, groups: cloneGroups(project.groups) })),
        groups: cloneGroups(state.groups),
        exclusions: state.exFilters.map(cloneFilter)
    };
}

export class FilterHistory {
    private past: Entry[] = [];
    private future: Entry[] = [];

    get canUndo(): boolean { return this.past.length > 0; }
    get canRedo(): boolean { return this.future.length > 0; }

    record(state: State, label: string): void {
        this.past.push({ label, snapshot: capture(state) });
        if (this.past.length > 30) {
            this.past.shift();
        }
        this.future = [];
        this.updateContext();
    }

    clear(): void {
        this.past = [];
        this.future = [];
        this.updateContext();
    }

    undo(state: State): string | undefined {
        return this.move(state, this.past, this.future);
    }

    redo(state: State): string | undefined {
        return this.move(state, this.future, this.past);
    }

    private move(state: State, from: Entry[], to: Entry[]): string | undefined {
        const entry = from.pop();
        if (!entry) {
            return undefined;
        }
        to.push({ label: entry.label, snapshot: capture(state) });
        const snapshot = entry.snapshot;
        state.projects.splice(0, state.projects.length, ...snapshot.projects);
        state.exFilters.splice(0, state.exFilters.length, ...snapshot.exclusions);
        if (state.settingsManager) {
            state.settingsManager.updateState(state);
        } else {
            state.groups = state.projects.find(project => project.selected)?.groups || snapshot.groups;
            state.projectTreeViewProvider.update(state.projects);
            state.filterTreeViewProvider.update(state.groups);
            state.focusProvider.update(state.groups);
            state.exFilterTreeViewProvider.refresh();
        }
        this.updateContext();
        return entry.label;
    }

    private updateContext(): void {
        vscode.commands.executeCommand('setContext', 'logAnalysisGamma.canUndoFilters', this.canUndo);
        vscode.commands.executeCommand('setContext', 'logAnalysisGamma.canRedoFilters', this.canRedo);
    }
}

export function recordFilterChange(state: State, label: string): void {
    if (!state.filterHistory) {
        state.filterHistory = new FilterHistory();
    }
    state.filterHistory.record(state, label);
}