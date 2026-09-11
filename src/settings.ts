import * as vscode from "vscode";
import * as path from 'path';
import * as fs from 'fs';
import { Project, Filter, generateSvgUri } from './utils';

export interface StoredFilter {
    id?: string;
    name?: string;
    regex?: string;
    pattern?: string;
    flags?: string;
    color: string;
    isHighlighted?: boolean;
    isShown?: boolean;
    enabled?: boolean;
    isExclusionFilter?: boolean;
}

export interface StoredGroup {
    id?: string;
    name: string;
    isHighlighted?: boolean;
    isShown?: boolean;
    filters: StoredFilter[];
}

export interface StoredProject {
    id?: string;
    name: string;
    selected?: boolean;
    groups: StoredGroup[];
}

export function serializeFilter(filter: Filter): StoredFilter {
    return {
        id: filter.id,
        regex: filter.regex.source,
        flags: filter.regex.flags,
        color: filter.color,
        isHighlighted: filter.isHighlighted,
        isShown: filter.isShown
    };
}

export function deserializeFilter(filter: StoredFilter, isExclusionFilter = false): Filter {
    const pattern = typeof filter.regex === 'string' ? filter.regex : filter.pattern;
    if (typeof pattern !== 'string') {
        throw new Error('A saved filter has no valid regex pattern. Restore it from a backup or re-enter it.');
    }
    const isHighlighted = filter.isHighlighted ?? filter.enabled ?? false;
    return {
        id: filter.id ?? `${Math.random()}`,
        regex: new RegExp(pattern, filter.flags),
        color: filter.color,
        isHighlighted,
        isShown: filter.isShown ?? filter.enabled ?? isExclusionFilter,
        iconPath: generateSvgUri(filter.color, isHighlighted),
        count: 0
    };
}

export function serializeProject(project: Project): StoredProject {
    return {
        id: project.id,
        name: project.name,
        selected: project.selected,
        groups: project.groups.map(group => ({
            id: group.id,
            name: group.name,
            isHighlighted: group.isHighlighted,
            isShown: group.isShown,
            filters: group.filters.map(serializeFilter)
        }))
    };
}

export function deserializeProject(project: StoredProject): Project {
    return {
        id: project.id ?? `${Math.random()}`,
        name: project.name,
        selected: project.selected ?? false,
        groups: project.groups.map(group => {
            const filters = group.filters.map(filter => deserializeFilter(filter));
            return {
                id: group.id ?? `${Math.random()}`,
                name: group.name,
                isHighlighted: group.isHighlighted ?? filters.some(filter => filter.isHighlighted),
                isShown: group.isShown ?? filters.some(filter => filter.isShown),
                filters
            };
        })
    };
}

function getSettingFile(storageUri: vscode.Uri): string {
    const storagePath: string = storageUri.fsPath;

    // Create the directory if it does not exist
    if (!fs.existsSync(storagePath)) {
        fs.mkdirSync(storagePath, { recursive: true });
    }

    return path.join(storagePath, 'vscode_log_analysis.json');
}

export function openSettings(storageUri: vscode.Uri) {
    const settingFile = getSettingFile(storageUri);

    vscode.workspace.openTextDocument(settingFile).then((doc) => {
        vscode.window.showTextDocument(doc);
    });
}

export function readSettings(storageUri: vscode.Uri, exFilters: Filter[] = []): Project[] {
    const settingFile = getSettingFile(storageUri);
    const projects: Project[] = [];

    if (fs.existsSync(settingFile)) {
        try {
            const text = fs.readFileSync(settingFile, 'utf8');
            const parsed = JSON.parse(text);

            const restoredProjects = parsed.projects.map(deserializeProject);
            const exclusions = (parsed.exclusionFilters || []).map((filter: StoredFilter) => deserializeFilter(filter, true));
            projects.push(...restoredProjects);
            exFilters.splice(0, exFilters.length, ...exclusions);
        } catch (e) {
            vscode.window.showErrorMessage(`The settings file is broken: ${e}`);
            throw e;
        }
    } else {
        exFilters.splice(0, exFilters.length);
    }
    return projects;
}

export function saveSettings(storageUri: vscode.Uri, projects: Project[], exFilters: Filter[] = []) {
    const settingFile = getSettingFile(storageUri);

    const content = JSON.stringify({
        projects: projects.map(serializeProject),
        exclusionFilters: exFilters.map(serializeFilter)
    }, null, 2);

    fs.writeFileSync(settingFile, content, 'utf8');
}
