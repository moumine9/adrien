import type { MetaResponse, Status } from '@adrien/api/contract';
import {
  bindingOf,
  contrastRatio,
  INK,
  isRetired,
  isReviewDue,
  localToday,
  STATUS_ORDER,
  STATUS_STYLES,
  verificationOf,
} from './status.ts';

const meta = (over: Partial<MetaResponse> = {}): Pick<MetaResponse, 'mode' | 'baseUnresolved' | 'forkUnresolved'> => ({
  mode: 'git',
  baseUnresolved: false,
  forkUnresolved: false,
  ...over,
});

describe('status styles', () => {
  it('covers every status once, in a stable order', () => {
    expect([...STATUS_ORDER].sort()).toEqual(['accepted', 'deprecated', 'proposed', 'rejected', 'superseded']);
    for (const s of STATUS_ORDER) expect(STATUS_STYLES[s].label).toBeTruthy();
  });

  it('keeps ink text on every status fill at WCAG AA (4.5:1) or better', () => {
    for (const s of STATUS_ORDER) {
      expect(contrastRatio(INK, STATUS_STYLES[s].fill), s).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('computes contrast ratios like WCAG does', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 1);
  });

  it('tells retired statuses apart', () => {
    const retired = (['accepted', 'proposed', 'superseded', 'deprecated', 'rejected'] as Status[]).filter(isRetired);
    expect(retired).toEqual(['superseded', 'deprecated', 'rejected']);
  });
});

describe('verificationOf', () => {
  it('is verified only in git mode with a resolved base and fork', () => {
    expect(verificationOf(meta())).toBe('verified');
    expect(verificationOf(meta({ baseUnresolved: true }))).toBe('unverified');
    expect(verificationOf(meta({ forkUnresolved: true }))).toBe('unverified');
    expect(verificationOf(meta({ mode: 'files', baseRef: null } as Partial<MetaResponse>))).toBe('unverified');
    expect(verificationOf(undefined)).toBe('unverified');
  });
});

describe('bindingOf', () => {
  it('binds only an accepted decision on the base layer', () => {
    expect(bindingOf({ status: 'accepted', layer: 'base' }, 'verified')).toBe('binding');
    for (const status of ['proposed', 'superseded', 'deprecated', 'rejected'] as Status[]) {
      expect(bindingOf({ status, layer: 'base' }, 'verified')).toBe('not-binding');
    }
  });

  it('never binds a pending change, whatever its status says', () => {
    expect(bindingOf({ status: 'accepted', layer: 'pending' }, 'verified')).toBe('pending');
    expect(bindingOf({ status: 'proposed', layer: 'pending' }, 'unverified')).toBe('pending');
  });

  it('marks an accepted base decision as unverified when no default branch backs it', () => {
    expect(bindingOf({ status: 'accepted', layer: 'base' }, 'unverified')).toBe('unverified');
  });
});

describe('isReviewDue', () => {
  it('is due on and after the review date', () => {
    expect(isReviewDue({ review_on: '2026-11-18', status: 'accepted' }, '2026-11-18')).toBe(true);
    expect(isReviewDue({ review_on: '2026-01-01', status: 'accepted' }, '2026-11-18')).toBe(true);
    expect(isReviewDue({ review_on: '2026-11-19', status: 'accepted' }, '2026-11-18')).toBe(false);
  });

  it('is never due without a date, or for a retired decision', () => {
    expect(isReviewDue({ status: 'accepted' }, '2026-11-18')).toBe(false);
    expect(isReviewDue({ review_on: '2020-01-01', status: 'superseded' }, '2026-11-18')).toBe(false);
  });

  it('formats today from local date parts, not UTC', () => {
    expect(localToday(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    expect(localToday(new Date(2026, 11, 31, 0, 1))).toBe('2026-12-31');
  });
});
