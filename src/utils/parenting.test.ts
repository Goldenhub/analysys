import { describe, it, expect } from 'vitest';
import { NodeType } from '@/types/nodes';
import { PARENTABLE_NODE_TYPES, canBeParent } from './parenting';

describe('canBeParent', () => {
  it('allows component-like service nodes to own a layer', () => {
    expect(canBeParent(NodeType.ApiGateway)).toBe(true);
    expect(canBeParent(NodeType.AppServer)).toBe(true);
    expect(canBeParent(NodeType.WorkerPool)).toBe(true);
    expect(canBeParent(NodeType.AuthService)).toBe(true);
    expect(canBeParent(NodeType.AuthzService)).toBe(true);
  });

  it('rejects pure data-plane primitives and the generator', () => {
    expect(canBeParent(NodeType.TrafficGenerator)).toBe(false);
    expect(canBeParent(NodeType.Cache)).toBe(false);
    expect(canBeParent(NodeType.Database)).toBe(false);
    expect(canBeParent(NodeType.MessageQueue)).toBe(false);
    expect(canBeParent(NodeType.DeadLetterQueue)).toBe(false);
    expect(canBeParent(NodeType.ObjectStore)).toBe(false);
    expect(canBeParent(NodeType.RateLimiter)).toBe(false);
    expect(canBeParent(NodeType.LoadBalancer)).toBe(false);
    expect(canBeParent(NodeType.CircuitBreaker)).toBe(false);
    expect(canBeParent(NodeType.Scheduler)).toBe(false);
  });

  it('the parentable set is non-empty and matches its helper', () => {
    for (const type of PARENTABLE_NODE_TYPES) {
      expect(canBeParent(type)).toBe(true);
    }
    expect(PARENTABLE_NODE_TYPES.size).toBe(5);
  });
});