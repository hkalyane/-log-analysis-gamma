import * as vscode from 'vscode';
import type { State } from './extension';
import { chooseStorageFile, refreshEditors } from './commands';
import { deserializeFilter } from './settings';
import { recordFilterChange } from './filterHistory';
import { askRegex } from './regexPreview';
import { cyclePattern, isoPattern, normalizeTime, TimeProfile, TimeSummary, TimeUnit, uvmPattern, validateTimeProfile } from './timeFilter';
import { logProcessing } from './processing';

function sourceUri(state: State): vscode.Uri | undefined {
    const uri = vscode.window.activeTextEditor?.document.uri;
    return uri?.scheme === 'focus-gamma' ? state.focusProvider.getOriginalUri(uri) : uri;
}

export async function configureTimeRange(state: State): Promise<void> {
    const uri = sourceUri(state);
    if (!uri) {
        return;
    }
    const config = vscode.workspace.getConfiguration('logAnalysisGamma');
    const profiles = config.get<Record<string, TimeProfile>>('timeProfiles', {});
    const previous = profiles[uri.toString()];
    const chosen = await vscode.window.showQuickPick([
        { label: 'Cycle Count (RTL / DMAC)', kindValue: 'cycles' as const, pattern: cyclePattern },
        { label: 'UVM / Simulation Time', kindValue: 'simulation' as const, pattern: uvmPattern },
        { label: 'ISO Date and Time', kindValue: 'wall' as const, pattern: isoPattern },
        { label: 'Custom Date and Time', kindValue: 'wall' as const, pattern: '^\\[([^\\]]+)\\]', custom: true }
    ], { title: 'Time / Cycle Profile', placeHolder: uri.fsPath, ignoreFocusOut: true });
    if (!chosen) {
        return;
    }
    const pattern = await vscode.window.showInputBox({
        title: 'Timestamp Capture Regex', prompt: 'Capture 1: time or cycle count. Simulation capture 2: optional unit.',
        value: previous?.kind === chosen.kindValue ? previous.pattern : chosen.pattern,
        ignoreFocusOut: true,
        validateInput: value => {
            try {
                if (!value || value.length > 2000) {
                    return 'Enter a capture regex (up to 2000 characters)';
                }
                new RegExp(value, 'i');
                return undefined;
            } catch (error) { return String(error); }
        }
    });
    if (pattern === undefined) {
        return;
    }
    const profile: TimeProfile = { kind: chosen.kindValue, pattern, untimed: 'inherit' };
    if (profile.kind === 'simulation') {
        const unit = await vscode.window.showQuickPick(['fs', 'ps', 'ns', 'us', 'ms', 's'], { title: 'Unit for Timestamps Without a Unit', ignoreFocusOut: true });
        if (!unit) {
            return;
        }
        profile.unit = unit as TimeUnit;
        const scale = await vscode.window.showInputBox({
            title: `Duration of One Unitless Tick (${unit})`, value: previous?.scale || '1', ignoreFocusOut: true,
            validateInput: value => {
                try { normalizeTime('1', { ...profile, scale: value }); return value ? undefined : 'Enter a positive scale'; }
                catch (error) { return String(error); }
            }
        });
        if (scale === undefined) {
            return;
        }
        profile.scale = scale;
    } else if (profile.kind === 'wall') {
        const format = chosen.custom ? await vscode.window.showInputBox({
            title: 'Date Format (Luxon Tokens)', prompt: 'Include year, month, day and time; for example yyyy-MM-dd HH:mm:ss.SSS',
            value: previous?.format && previous.format !== 'ISO' ? previous.format : 'yyyy-MM-dd HH:mm:ss.SSS', ignoreFocusOut: true
        }) : 'ISO';
        if (format === undefined) {
            return;
        }
        const zone = await vscode.window.showInputBox({ title: 'Timezone for Timestamps Without an Offset', value: previous?.zone || 'UTC', ignoreFocusOut: true });
        if (zone === undefined) {
            return;
        }
        profile.format = format;
        profile.zone = zone;
    }
    for (const bound of ['start', 'end'] as const) {
        const value = await vscode.window.showInputBox({
            title: `${bound === 'start' ? 'Start' : 'End'} (${profile.kind === 'cycles' ? 'cycle count' : profile.kind === 'simulation' ? 'simulation time' : profile.format})`,
            prompt: 'Inclusive bound; leave empty for no limit', value: previous?.kind === profile.kind ? previous[bound] || '' : '', ignoreFocusOut: true,
            validateInput: text => {
                try { if (text) { normalizeTime(text, profile); } return undefined; }
                catch (error) { return String(error); }
            }
        });
        if (value === undefined) {
            return;
        }
        profile[bound] = value;
    }
    const continuation = await vscode.window.showQuickPick(['Inherit Previous Timestamp', 'Exclude Untimestamped Lines'], { title: 'Untimestamped Lines', ignoreFocusOut: true });
    if (!continuation) {
        return;
    }
    profile.untimed = continuation === 'Inherit Previous Timestamp' ? 'inherit' : 'exclude';
    try {
        validateTimeProfile(profile);
        const document = await vscode.workspace.openTextDocument(uri);
        const lines: string[] = [];
        let size = 0;
        for (let index = 0; index < Math.min(document.lineCount, 5000); index++) {
            const line = document.lineAt(index).text;
            if (size + line.length > 1000000) { break; }
            lines.push(line);
            size += line.length;
        }
        const result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Previewing time / cycle profile', cancellable: true },
            (_progress, token) => logProcessing.run<{ summary: TimeSummary }>('timeline-preview', 'timeline', { lines, profile }, token));
        if (!result.summary.timed) {
            vscode.window.showErrorMessage(`No valid timestamps in the first ${lines.length} lines. Check capture group 1, units, date format, and timezone.`);
            return;
        }
        const summary = result.summary;
        const apply = await vscode.window.showInformationMessage(
            `${uri.fsPath}\nPreview: first ${lines.length} of ${document.lineCount} lines\n${summary.timed} timestamps; ${summary.invalid} invalid; ${summary.resets} backward jumps\n${summary.minimum} to ${summary.maximum}\n${summary.samples.join('\n')}`,
            { modal: true }, 'Apply Range');
        if (apply === 'Apply Range') {
            const current = vscode.workspace.getConfiguration('logAnalysisGamma').get<Record<string, TimeProfile>>('timeProfiles', {});
            await config.update('timeProfiles', { ...current, [uri.toString()]: profile }, vscode.ConfigurationTarget.Global);
        }
    } catch (error) {
        if (!(error instanceof vscode.CancellationError)) {
            vscode.window.showErrorMessage(`Time profile was not applied: ${error}`);
        }
    }
}

export async function clearTimeRange(state: State): Promise<void> {
    const uri = sourceUri(state);
    if (!uri) { return; }
    const config = vscode.workspace.getConfiguration('logAnalysisGamma');
    const profiles = { ...config.get<Record<string, TimeProfile>>('timeProfiles', {}) };
    delete profiles[uri.toString()];
    state.focusProvider.timelines.delete(uri.toString());
    await config.update('timeProfiles', profiles, vscode.ConfigurationTarget.Global);
}

export async function showTimeSummary(state: State): Promise<void> {
    const uri = sourceUri(state);
    if (!uri) { return; }
    const profile = vscode.workspace.getConfiguration('logAnalysisGamma').get<Record<string, TimeProfile>>('timeProfiles', {})[uri.toString()];
    if (!profile) {
        await configureTimeRange(state);
        return;
    }
    try {
        const source = await vscode.workspace.openTextDocument(uri);
        const result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Scanning log timeline', cancellable: true },
            (_progress, token) => logProcessing.run<{ summary: TimeSummary }>('timeline-summary', 'timeline', { lines: source.getText().split('\n'), profile: { ...profile } }, token));
        const summary = result.summary;
        const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content:
            `Time / Cycle Summary\n${uri.toString()}\nClock: ${profile.kind}\nRange: ${profile.start || 'unbounded'} .. ${profile.end || 'unbounded'}\n` +
            `First: ${summary.first || 'none'}\nLast: ${summary.last || 'none'}\nMinimum: ${summary.minimum || 'none'}\nMaximum: ${summary.maximum || 'none'}\n` +
            `Timestamped: ${summary.timed}\nUntimestamped: ${summary.untimed}\nInvalid: ${summary.invalid}\nBackward jumps: ${summary.resets}\n\n${summary.samples.join('\n')}`
        });
        await vscode.window.showTextDocument(document);
    } catch (error) {
        if (!(error instanceof vscode.CancellationError)) { vscode.window.showErrorMessage(String(error)); }
    }
}

export function literalPattern(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function filterFromSelection(state: State, exclude: boolean, regexMode = false): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    const selection = editor?.document.getText(editor.selection);
    if (!selection || /[\r\n]/.test(selection) || selection.length > 10000) {
        vscode.window.showWarningMessage('Select nonempty text within one line (up to 10,000 characters).');
        return;
    }
    const pattern = regexMode ? await askRegex({ title: 'Regex from Selection', value: selection }) : literalPattern(selection);
    if (pattern === undefined) {
        return;
    }
    const sourcePath = await chooseStorageFile(state, 'Store Selection Filter in Which File?', false, true);
    if (!sourcePath || !state.settingsManager) {
        return;
    }
    const project = state.settingsManager.selectedProject(sourcePath, state);
    let group = project.groups[0];
    if (!exclude && project.groups.length > 1) {
        const chosen = await vscode.window.showQuickPick(project.groups.map(candidate => ({ label: candidate.name, group: candidate })), { title: 'Filter Group' });
        if (!chosen) {
            return;
        }
        group = chosen.group;
    }
    const filter = deserializeFilter({ regex: pattern, color: '#e74c3c', isShown: true, isHighlighted: !exclude });
    filter.sourcePath = sourcePath;
    recordFilterChange(state, exclude ? 'Exclude selection' : 'Highlight selection');
    if (exclude) {
        state.exFilters.push(filter);
    } else {
        if (!group) {
            group = { name: 'Selections', id: `${Math.random()}`, sourcePath, filters: [], isShown: true, isHighlighted: true };
            project.groups.push(group);
        }
        group.filters.push(filter);
    }
    state.settingsManager.updateState(state);
    refreshEditors(state);
}

export async function configureContext(): Promise<void> {
    const config = vscode.workspace.getConfiguration('logAnalysisGamma');
    const values: number[] = [];
    for (const key of ['contextBefore', 'contextAfter']) {
        const value = await vscode.window.showInputBox({
            title: key === 'contextBefore' ? 'Context Lines Before' : 'Context Lines After',
            value: String(config.get(key, 0)), ignoreFocusOut: true,
            validateInput: text => /^\d+$/.test(text) && Number(text) <= 100 ? undefined : 'Enter a whole number from 0 to 100'
        });
        if (value === undefined) {
            return;
        }
        values.push(Number(value));
    }
    await config.update('contextBefore', values[0], vscode.ConfigurationTarget.Global);
    await config.update('contextAfter', values[1], vscode.ConfigurationTarget.Global);
}

export function formatFocusedResult(content: string, sourceLines: number[], numbered: boolean): string {
    if (!content) {
        return '';
    }
    const lines = content.split('\n').slice(1);
    if (lines.length !== sourceLines.length - 1) {
        throw new Error('Focused result and original line mapping are out of sync');
    }
    return lines.map((line, index) => numbered ? `${sourceLines[index + 1] + 1}\t${line}` : line).join('\n');
}

export async function exportFocused(state: State, clipboard: boolean): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        return;
    }
    const original = editor.document.uri.scheme === 'focus-gamma'
        ? state.focusProvider.getOriginalUri(editor.document.uri) : editor.document.uri;
    const choice = await vscode.window.showQuickPick(['Text Only', 'Original Line Numbers'], { title: 'Export Format' });
    if (!choice) {
        return;
    }
    try {
        const content = await state.focusProvider.provideTextDocumentContent(vscode.Uri.parse('focus-gamma:' + original.toString()));
        const output = formatFocusedResult(content, state.focusProvider.documentLineMap.get(original.fsPath) || [0], choice === 'Original Line Numbers');
        if (clipboard) {
            await vscode.env.clipboard.writeText(output);
        } else {
            const destination = await vscode.window.showSaveDialog({ saveLabel: 'Export Focused Results', filters: { text: ['txt', 'log'] } });
            if (!destination) {
                return;
            }
            if (destination.toString() === original.toString()) {
                vscode.window.showErrorMessage('Choose a different file; the source log will not be overwritten.');
                return;
            }
            await vscode.workspace.fs.writeFile(destination, Buffer.from(output, 'utf8'));
        }
        vscode.window.showInformationMessage(clipboard ? 'Focused results copied' : 'Focused results exported');
    } catch (error) {
        vscode.window.showErrorMessage(`Export failed: ${error}`);
    }
}