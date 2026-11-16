import { describe, expect, it } from 'vitest';
import {
  type ApprovalHandler,
  ApprovalHandlerError,
  createApprovalRegistry,
} from '../../../src/modules/approvals/approval-registry.js';

const handler: ApprovalHandler = {
  onApproved: async () => {},
  onRejected: async () => {},
  describe: async () => new Map(),
};

describe('approval registry', () => {
  it('returns the handler registered for a type', () => {
    const registry = createApprovalRegistry();
    registry.register('role_assignment', handler);
    expect(registry.get('role_assignment')).toBe(handler);
    expect(registry.find('role_assignment')).toBe(handler);
    expect(registry.types()).toEqual(['role_assignment']);
  });

  it('allows one handler per type', () => {
    const registry = createApprovalRegistry();
    registry.register('rate', handler);
    expect(() => registry.register('rate', handler)).toThrow(ApprovalHandlerError);
  });

  it('fails loudly for a type without handler', () => {
    const registry = createApprovalRegistry();
    expect(registry.find('adjustment')).toBeUndefined();
    expect(() => registry.get('adjustment')).toThrow('approval type adjustment has no handler');
  });

  it('keeps registries independent', () => {
    const a = createApprovalRegistry();
    const b = createApprovalRegistry();
    a.register('rate', handler);
    expect(b.find('rate')).toBeUndefined();
  });
});
