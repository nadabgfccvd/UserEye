'use strict';

const os = require('os');

function adaptiveWorkerCount(requested, mode = 'standard') {
  if (Number.isFinite(Number(requested)) && Number(requested) > 0) {
    return Math.max(1, Math.min(16, Number(requested)));
  }
  const modeCap = { quick: 3, standard: 6, deep: 10 }[mode] || 6;
  // Browser protocol scenarios are predominantly I/O-bound. Two workers per
  // logical CPU improve throughput without oversubscribing rendering work.
  const cpuCap = Math.max(2, os.cpus().length * 2);
  const memoryCap = Math.max(1, Math.floor(os.freemem() / (256 * 1024 * 1024)));
  return Math.max(1, Math.min(modeCap, cpuCap, memoryCap, 16));
}

function withTimeout(promise, timeoutMs, label, onTimeout = () => {}) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        onTimeout();
        reject(new Error(`Timeout after ${timeoutMs} ms: ${label}`));
      }, timeoutMs);
    }),
  ]);
}

class ParallelScheduler {
  constructor(options = {}) {
    this.maxWorkers = adaptiveWorkerCount(options.workers, options.mode);
    this.timeoutMs = options.timeoutMs || 15_000;
    this.retries = options.retries ?? 1;
    this.active = 0;
    this.peakConcurrency = 0;
    this.timeline = [];
    this.startedAt = null;
    this.finishedAt = null;
  }

  async run(tasks, handler) {
    this.startedAt = new Date().toISOString();
    const results = new Array(tasks.length);
    let cursor = 0;
    const serialQueue = [];
    const parallelTasks = [];
    tasks.forEach((task, index) => (task.serial ? serialQueue : parallelTasks).push({ task, index }));

    const worker = async workerId => {
      while (true) {
        const position = cursor++;
        if (position >= parallelTasks.length) {
          break;
        }
        const { task, index } = parallelTasks[position];
        results[index] = await this._execute(task, index, workerId, handler);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(this.maxWorkers, parallelTasks.length || 1) }, (_, index) =>
        worker(index + 1),
      ),
    );

    // Mutating/destructive protocols are intentionally serialized after all
    // isolated read-only work, preserving determinism and data quality.
    for (const { task, index } of serialQueue) {
      results[index] = await this._execute(task, index, 0, handler);
    }
    this.finishedAt = new Date().toISOString();
    return {
      results,
      metrics: {
        configuredWorkers: this.maxWorkers,
        peakConcurrency: this.peakConcurrency,
        totalTasks: tasks.length,
        parallelTasks: parallelTasks.length,
        serializedTasks: serialQueue.length,
        startedAt: this.startedAt,
        finishedAt: this.finishedAt,
        durationMs: Date.parse(this.finishedAt) - Date.parse(this.startedAt),
        timeline: this.timeline,
      },
    };
  }

  async _execute(task, index, workerId, handler) {
    const started = Date.now();
    this.active += 1;
    this.peakConcurrency = Math.max(this.peakConcurrency, this.active);
    const event = {
      id: task.id,
      index,
      workerId,
      startedAt: new Date().toISOString(),
      serial: Boolean(task.serial),
      attempts: 0,
    };
    this.timeline.push(event);
    let lastError;
    try {
      const retries = task.retries ?? this.retries;
      for (let attempt = 0; attempt <= retries; attempt++) {
        event.attempts = attempt + 1;
        try {
          const controller = new AbortController();
          const execution = { workerId, attempt, signal: controller.signal };
          const value = await withTimeout(
            Promise.resolve(handler(task, execution)),
            task.timeoutMs || this.timeoutMs,
            task.id,
            () => controller.abort(new Error(`Timeout: ${task.id}`)),
          );
          event.finishedAt = new Date().toISOString();
          event.durationMs = Date.now() - started;
          event.status = value?.status === 'failed' ? 'failed' : 'completed';
          return { taskId: task.id, workerId, attempts: attempt + 1, durationMs: event.durationMs, ...value };
        } catch (error) {
          lastError = error;
          if (attempt < retries) {
            await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
          }
        }
      }
      event.finishedAt = new Date().toISOString();
      event.durationMs = Date.now() - started;
      event.status = 'failed';
      return {
        taskId: task.id,
        workerId,
        attempts: event.attempts,
        durationMs: event.durationMs,
        status: 'failed',
        error: lastError?.message || String(lastError),
      };
    } finally {
      this.active -= 1;
    }
  }
}

module.exports = { ParallelScheduler, adaptiveWorkerCount, withTimeout };
