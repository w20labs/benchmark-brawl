import { describe, expect, it } from 'vitest';
import { judgeClaim } from '../src/claims.ts';
import type { Claim } from '../src/types.ts';

const claim = (claimed: number, v: number, se: number | null, labSetting: string | null = null, sameSetting = true): Claim =>
  ({ modelId: 'm', bench: 'b', claimed, version: null, conditions: '', url: 'https://example.com', quote: '', published: null, labSetting, indep: { v, se, setting: 'max', sameSetting } });

describe('judgeClaim', () => {
  it('matches inside the independent margin', () => expect(judgeClaim(claim(80.8, 80, 1))).toMatchObject({ kind: 'match' }));
  it('says who is higher outside it', () => {
    expect(judgeClaim(claim(94.2, 86.4, 2.45))).toMatchObject({ kind: 'lab' });
    expect(judgeClaim(claim(68.8, 73.6, 1.98))).toMatchObject({ kind: 'ind' });
  });
  it('never invents a margin when none is published', () => {
    expect(judgeClaim(claim(80.8, 80, null))).toMatchObject({ kind: 'unknown', margin: null });
    expect(judgeClaim(claim(80, 80, null))).toMatchObject({ kind: 'match' });
  });
  it('flags a comparison of different settings', () => {
    expect(judgeClaim(claim(80.6, 75.6, 1.9, 'high', false)).settingsDiffer).toBe(true);
    expect(judgeClaim(claim(80.6, 75.6, 1.9, 'high', true)).settingsDiffer).toBe(false);
    expect(judgeClaim(claim(80.6, 75.6, 1.9, null, false)).settingsDiffer).toBe(false);
  });
});
