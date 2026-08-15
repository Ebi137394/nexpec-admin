import { describe, expect, it } from 'vitest';

import { deliveryStatusCopy, invoiceStatusLabel } from './deliveryPolicy';

const base = {
  remainingCents: 80_000,
  netTermDays: 30 as const,
  invoiceDueAt: '2026-09-14T00:00:00.000Z',
};

describe('deliveryStatusCopy', () => {
  it('blocks delivery only when the tranche actually gates it', () => {
    const copy = deliveryStatusCopy({
      ...base,
      gatesDelivery: true,
      netTermDays: null,
      invoiceDueAt: null,
      invoiceStatus: null,
    });
    expect(copy.tone).toBe('blocked');
    expect(copy.headline).toBe(
      'Final delivery blocked until remaining funding is received.',
    );
  });

  it('never says "blocked" for a released job on Net terms', () => {
    const copy = deliveryStatusCopy({
      ...base,
      gatesDelivery: false,
      invoiceStatus: 'open',
    });
    expect(copy.tone).toBe('released');
    expect(copy.headline).toBe('Final report released on approved credit terms.');
    expect(copy.headline).not.toMatch(/blocked/i);
    expect(copy.detail).toMatch(/due by/i);
  });

  //  The regression that matters most: an overdue invoice is a collections
  //  matter, not a delivery block. Telling a paying client their report is
  //  withheld when it is not is the defect this module exists to prevent.
  it('does NOT block, and reassures, when the invoice is overdue', () => {
    const copy = deliveryStatusCopy({
      ...base,
      gatesDelivery: false,
      invoiceStatus: 'overdue',
    });
    expect(copy.tone).toBe('released');
    expect(copy.headline).not.toMatch(/blocked/i);
    expect(copy.detail).toMatch(/overdue/i);
    expect(copy.detail).toMatch(/remains available/i);
  });

  it('reports settled states without a balance sentence', () => {
    for (const s of ['paid', 'waived'] as const) {
      const copy = deliveryStatusCopy({ ...base, gatesDelivery: false, invoiceStatus: s });
      expect(copy.tone).toBe('settled');
      expect(copy.detail).toBeNull();
    }
  });

  it('labels every invoice status for Client Finance', () => {
    expect(invoiceStatusLabel('open')).toBe('Open');
    expect(invoiceStatusLabel('due_soon')).toBe('Due Soon');
    expect(invoiceStatusLabel('overdue')).toBe('Overdue');
    expect(invoiceStatusLabel('paid')).toBe('Paid');
    expect(invoiceStatusLabel('waived')).toBe('Waived');
  });
});
