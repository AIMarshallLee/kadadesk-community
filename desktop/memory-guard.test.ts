import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pruneMap, getMemoryMetrics, maybeCollectGarbage, requestGarbageCollection } from './memory-guard';

describe('memory-guard', () => {
  it('pruneMap trims map to requested size in FIFO order', () => {
    const map = new Map<string, number>();
    for (let i = 0; i < 10; i++) map.set(`k${i}`, i);
    assert.equal(map.size, 10);

    pruneMap(map, 5);
    assert.equal(map.size, 5);
    assert.equal(map.has('k0'), false);
    assert.equal(map.has('k4'), false);
    assert.equal(map.has('k5'), true);
    assert.equal(map.has('k9'), true);
  });

  it('pruneMap does nothing when size is within limit', () => {
    const map = new Map<string, number>();
    map.set('a', 1);
    map.set('b', 2);
    pruneMap(map, 5);
    assert.equal(map.size, 2);
  });

  it('getMemoryMetrics returns non-negative numbers', () => {
    const metrics = getMemoryMetrics();
    assert.ok(typeof metrics.rssMb === 'number');
    assert.ok(metrics.rssMb > 0);
    assert.ok(typeof metrics.heapUsedMb === 'number');
  });

  it('requestGarbageCollection runs without throwing', () => {
    assert.doesNotThrow(() => {
      requestGarbageCollection();
    });
  });

  it('maybeCollectGarbage handles threshold checks safely', () => {
    const executed = maybeCollectGarbage({ minIntervalMs: 0, rssThresholdMb: 1 });
    assert.ok(typeof executed === 'boolean');
  });
});
