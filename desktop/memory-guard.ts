import v8 from 'node:v8';
import vm from 'node:vm';

try {
  v8.setFlagsFromString('--expose_gc');
} catch {
  /* best effort in case flags are already frozen */
}

let lastGcAt = 0;

/** Trigger V8 Full Garbage Collection safely if available. */
export function requestGarbageCollection(): boolean {
  try {
    if (typeof (globalThis as any).gc === 'function') {
      (globalThis as any).gc();
      lastGcAt = Date.now();
      return true;
    }
    const runGc = vm.runInNewContext('gc');
    if (typeof runGc === 'function') {
      runGc();
      lastGcAt = Date.now();
      return true;
    }
  } catch {
    /* GC unavailable or failed */
  }
  return false;
}

export function getMemoryMetrics(): { rssMb: number; heapUsedMb: number; externalMb: number } {
  try {
    const mem = process.memoryUsage();
    return {
      rssMb: Math.round(mem.rss / 1024 / 1024),
      heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
      externalMb: Math.round(mem.external / 1024 / 1024),
    };
  } catch {
    return { rssMb: 0, heapUsedMb: 0, externalMb: 0 };
  }
}

/** Proactively trigger GC if RSS exceeds threshold or enough time has elapsed under continuous load. */
export function maybeCollectGarbage(options?: { minIntervalMs?: number; rssThresholdMb?: number }): boolean {
  const minInterval = options?.minIntervalMs ?? 60_000;
  const rssThreshold = options?.rssThresholdMb ?? 350;
  const now = Date.now();
  if (now - lastGcAt < 10_000) return false; // Throttled minimum cooldown

  const metrics = getMemoryMetrics();
  const needsGcByMemory = metrics.rssMb >= rssThreshold;
  const needsGcByInterval = now - lastGcAt >= minInterval;

  if (needsGcByMemory || needsGcByInterval) {
    return requestGarbageCollection();
  }
  return false;
}

/** Enforce an LRU/FIFO upper bound on Map entries to avoid unbounded growth. */
export function pruneMap<K, V>(map: Map<K, V>, maxEntries: number): void {
  if (map.size <= maxEntries) return;
  const toDelete = map.size - maxEntries;
  let deleted = 0;
  for (const key of map.keys()) {
    map.delete(key);
    if (++deleted >= toDelete) break;
  }
}
