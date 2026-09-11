import * as vscode from 'vscode';
import { Worker } from 'worker_threads';

export type RegexPreview = { count: number; samples: string[]; error?: string };

export function scanRegex(pattern: string, flags: string, lines: string[]): RegexPreview {
    try {
        const regex = new RegExp(pattern, flags);
        const result: RegexPreview = { count: 0, samples: [] };
        lines.forEach((line, index) => {
            regex.lastIndex = 0;
            if (regex.test(line)) {
                result.count++;
                if (result.samples.length < 3) {
                    result.samples.push(`${index + 1}: ${line.slice(0, 100)}`);
                }
            }
        });
        return result;
    } catch (error) {
        return { count: 0, samples: [], error: String(error) };
    }
}

export function startRegexPreview(pattern: string, flags: string, lines: string[], timeout = 500): {
    result: Promise<RegexPreview>; cancel: () => void;
} {
    let cancel = () => {};
    const result = new Promise<RegexPreview>(resolve => {
        let worker: Worker;
        try {
            worker = new Worker(`const { parentPort, workerData } = require('worker_threads');
                parentPort.postMessage((${scanRegex.toString()})(...workerData));`, { eval: true, workerData: [pattern, flags, lines] });
        } catch (error) {
            resolve({ count: 0, samples: [], error: String(error) });
            return;
        }
        let finished = false;
        const finish = (preview: RegexPreview) => {
            if (finished) {
                return;
            }
            finished = true;
            clearTimeout(timer);
            worker.removeAllListeners();
            void worker.terminate();
            resolve(preview);
        };
        const timer = setTimeout(() => finish({ count: 0, samples: [], error: 'Preview timed out; simplify the pattern' }), timeout);
        cancel = () => finish({ count: 0, samples: [], error: 'Preview canceled' });
        worker.once('message', finish);
        worker.once('error', error => finish({ count: 0, samples: [], error: error.message }));
        worker.once('exit', () => finish({ count: 0, samples: [], error: 'Preview worker exited' }));
    });
    return { result, cancel: () => cancel() };
}

export function askRegex(options: vscode.InputBoxOptions, flags = ''): Promise<string | undefined> {
    const document = vscode.window.activeTextEditor?.document;
    const lines: string[] = [];
    let characters = 0;
    if (document) {
        for (let index = 0; index < Math.min(document.lineCount, 10000); index++) {
            const line = document.lineAt(index).text;
            if (characters + line.length > 1000000) {
                break;
            }
            lines.push(line);
            characters += line.length;
        }
    }
    return new Promise(resolve => {
        const input = vscode.window.createInputBox();
        input.title = options.title || 'Regex Preview';
        input.placeholder = 'Regex pattern';
        input.ignoreFocusOut = options.ignoreFocusOut || false;
        input.value = options.value || '';
        let generation = 0;
        let ready = false;
        let settled = false;
        let timer: NodeJS.Timeout | undefined;
        let task: ReturnType<typeof startRegexPreview> | undefined;
        const subscriptions: vscode.Disposable[] = [];
        const finish = (value?: string) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timer!);
            task?.cancel();
            subscriptions.forEach(subscription => subscription.dispose());
            input.dispose();
            resolve(value);
        };
        const update = () => {
            const current = ++generation;
            ready = false;
            clearTimeout(timer!);
            task?.cancel();
            input.validationMessage = undefined;
            input.prompt = 'Checking matches...';
            input.busy = true;
            timer = setTimeout(async () => {
                task = startRegexPreview(input.value, flags, lines);
                const preview = await task.result;
                if (settled || current !== generation) {
                    return;
                }
                input.busy = false;
                input.validationMessage = preview.error;
                ready = !preview.error;
                const scope = document && lines.length < document.lineCount ? ` (first ${lines.length} of ${document.lineCount} lines)` : '';
                input.prompt = document ? `${preview.count} matching lines${scope}${preview.samples.length ? ' | ' + preview.samples.join(' | ') : ''}` : 'No active document; syntax checked';
            }, 150);
        };
        subscriptions.push(input.onDidChangeValue(update), input.onDidAccept(() => {
            if (ready) {
                finish(input.value);
            }
        }), input.onDidHide(() => finish()));
        update();
        input.show();
    });
}