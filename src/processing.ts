import * as vscode from 'vscode';
import * as path from 'path';
import { Worker } from 'worker_threads';

export class ProcessingController implements vscode.Disposable {
    private jobs = new Map<string, () => void>();
    private emitter = new vscode.EventEmitter<void>();
    readonly onDidChange = this.emitter.event;
    paused = false;
    get activeJobs(): number { return this.jobs.size; }

    setPaused(paused: boolean): void {
        this.paused = paused;
        if (paused) {
            this.cancelAll();
        }
        this.emitter.fire();
    }

    cancelAll(): void {
        [...this.jobs.values()].forEach(cancel => cancel());
    }

    cancel(key: string): void {
        this.jobs.get(key)?.();
    }

    run<T>(key: string, operation: 'focus' | 'highlights' | 'timeline', input: unknown,
        token?: vscode.CancellationToken, deadline?: number): Promise<T> {
        this.jobs.get(key)?.();
        if (this.paused || token?.isCancellationRequested) {
            return Promise.reject(new vscode.CancellationError());
        }
        if (this.jobs.size >= 4) {
            this.jobs.values().next().value!();
        }
        return new Promise<T>((resolve, reject) => {
            let worker: Worker;
            try {
                worker = new Worker(path.join(__dirname, 'logProcessor.js'), { workerData: { operation, input } });
            } catch (error) {
                reject(error);
                return;
            }
            let done = false;
            let listener: vscode.Disposable | undefined;
            const finish = (error?: Error, result?: T) => {
                if (done) {
                    return;
                }
                done = true;
                clearTimeout(timer);
                listener?.dispose();
                worker.removeAllListeners();
                void worker.terminate();
                this.jobs.delete(key);
                this.emitter.fire();
                if (error) {
                    reject(error);
                } else {
                    resolve(result!);
                }
            };
            const timeout = deadline ?? vscode.workspace.getConfiguration('logAnalysisGamma').get<number>('processingTimeoutMs', 10000);
            const timer = setTimeout(() => finish(new Error('Log processing timed out. Simplify the regex or narrow the input.')), timeout);
            const cancel = () => finish(new vscode.CancellationError());
            this.jobs.set(key, cancel);
            listener = token?.onCancellationRequested(cancel);
            worker.once('message', message => message.error ? finish(new Error(message.error)) : finish(undefined, message.result));
            worker.once('error', error => finish(error));
            worker.once('exit', code => finish(new Error(`Log worker exited (${code})`)));
            this.emitter.fire();
        });
    }

    dispose(): void {
        this.cancelAll();
        this.emitter.dispose();
    }
}

export const logProcessing = new ProcessingController();