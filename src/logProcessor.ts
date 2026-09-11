import { isMainThread, parentPort, workerData } from 'worker_threads';
import { evaluateTimeRange, TimeProfile, TimeSummary } from './timeFilter';

export type Pattern = { regex: string; flags: string; id: string };
export type FocusInput = {
    lines: string[]; filters: Pattern[]; exclusions: Pattern[];
    before: number; after: number; timeProfile?: TimeProfile;
};
export type FocusResult = { indices: number[]; counts: number[]; timeline?: TimeSummary };

export function processFocus(input: FocusInput): FocusResult {
    const filters = input.filters.map(filter => new RegExp(filter.regex, filter.flags));
    const exclusions = input.exclusions.map(filter => new RegExp(filter.regex, filter.flags));
    const times = input.timeProfile ? evaluateTimeRange(input.lines, input.timeProfile) : undefined;
    const counts = exclusions.map(() => 0);
    const test = (regex: RegExp, line: string) => {
        regex.lastIndex = 0;
        return regex.test(line);
    };
    const eligible = input.lines.map((line, index) => {
        if (times && !times.allowed[index]) {
            return false;
        }
        const excluded = exclusions.findIndex(regex => test(regex, line));
        if (excluded !== -1) {
            counts[excluded]++;
            return false;
        }
        return true;
    });
    const covered = new Int32Array(input.lines.length + 1);
    input.lines.forEach((line, index) => {
        if (eligible[index] && (filters.some(regex => test(regex, line)) || (filters.length === 0 && times))) {
            covered[Math.max(0, index - input.before)]++;
            covered[Math.min(input.lines.length, index + input.after + 1)]--;
        }
    });
    const indices: number[] = [];
    let depth = 0;
    input.lines.forEach((_line, index) => {
        depth += covered[index];
        if (depth > 0 && eligible[index]) {
            indices.push(index);
        }
    });
    return { indices, counts, timeline: times?.summary };
}

export function processHighlights(input: { lines: string[]; filters: Pattern[] }): number[][] {
    return input.filters.map(filter => {
        const regex = new RegExp(filter.regex, filter.flags);
        const indices: number[] = [];
        input.lines.forEach((line, index) => {
            regex.lastIndex = 0;
            if (regex.test(line)) {
                indices.push(index);
            }
        });
        return indices;
    });
}

if (!isMainThread) {
    try {
        const result = workerData.operation === 'focus' ? processFocus(workerData.input)
            : workerData.operation === 'timeline' ? evaluateTimeRange(workerData.input.lines, workerData.input.profile)
                : processHighlights(workerData.input);
        parentPort!.postMessage({ result });
    } catch (error) {
        parentPort!.postMessage({ error: String(error) });
    }
}