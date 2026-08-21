import { describe, it, expect } from 'vitest';
import { MinHeap } from './eventQueue';

describe('MinHeap', () => {
  it('extracts elements in ascending order', () => {
    const heap = new MinHeap<number>((a, b) => a - b);
    const values = [5, 3, 8, 1, 9, 2, 7, 4, 6, 0];
    for (const v of values) heap.insert(v);

    const result: number[] = [];
    while (heap.size > 0) {
      result.push(heap.extractMin()!);
    }

    expect(result).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('peek returns the minimum without removing it', () => {
    const heap = new MinHeap<number>((a, b) => a - b);
    heap.insert(10);
    heap.insert(3);
    heap.insert(7);

    expect(heap.peek()).toBe(3);
    expect(heap.size).toBe(3);
  });

  it('returns undefined on empty heap', () => {
    const heap = new MinHeap<number>((a, b) => a - b);
    expect(heap.extractMin()).toBeUndefined();
    expect(heap.peek()).toBeUndefined();
  });

  it('handles single element correctly', () => {
    const heap = new MinHeap<number>((a, b) => a - b);
    heap.insert(42);
    expect(heap.extractMin()).toBe(42);
    expect(heap.size).toBe(0);
  });

  it('clear empties the heap', () => {
    const heap = new MinHeap<number>((a, b) => a - b);
    heap.insert(1);
    heap.insert(2);
    heap.insert(3);
    heap.clear();
    expect(heap.size).toBe(0);
    expect(heap.extractMin()).toBeUndefined();
  });

  it('works with object comparator (SimEvent-like)', () => {
    interface Event { timestamp: number; id: string }
    const heap = new MinHeap<Event>((a, b) => a.timestamp - b.timestamp);

    heap.insert({ timestamp: 100, id: 'c' });
    heap.insert({ timestamp: 50, id: 'a' });
    heap.insert({ timestamp: 75, id: 'b' });

    expect(heap.extractMin()!.id).toBe('a');
    expect(heap.extractMin()!.id).toBe('b');
    expect(heap.extractMin()!.id).toBe('c');
  });

  it('handles duplicates correctly', () => {
    const heap = new MinHeap<number>((a, b) => a - b);
    heap.insert(5);
    heap.insert(5);
    heap.insert(5);
    heap.insert(3);
    heap.insert(3);

    expect(heap.extractMin()).toBe(3);
    expect(heap.extractMin()).toBe(3);
    expect(heap.extractMin()).toBe(5);
    expect(heap.extractMin()).toBe(5);
    expect(heap.extractMin()).toBe(5);
  });

  it('maintains heap property with 10,000 elements (performance)', () => {
    const heap = new MinHeap<number>((a, b) => a - b);
    const start = performance.now();

    for (let i = 0; i < 10000; i++) {
      heap.insert(Math.random() * 100000);
    }

    let prev = -Infinity;
    while (heap.size > 0) {
      const val = heap.extractMin()!;
      expect(val).toBeGreaterThanOrEqual(prev);
      prev = val;
    }

    const elapsed = performance.now() - start;
    // Should complete in reasonable time (generous for CI/test environments with assertion overhead)
    expect(elapsed).toBeLessThan(2000);
  });
});
