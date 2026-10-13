/** Claim check verdicts: a lab's published number against an independent result. Pure, so it's tested. */
import { TIE_Z } from './fight.ts';
import type { Claim } from './types.ts';

export type ClaimVerdict = {
  /** match: inside the independent margin; lab / ind: who is higher; unknown: no margin to judge by. */
  kind: 'match' | 'lab' | 'ind' | 'unknown';
  /** Lab minus independent, in points. */
  diff: number;
  /** The independent result's 95% margin, or null when the source publishes none (never invented). */
  margin: number | null;
  /** The lab names a setting the independent tester didn't run, so this compares different settings. */
  settingsDiffer: boolean;
};

export function judgeClaim(c: Claim): ClaimVerdict {
  const diff = c.claimed - c.indep.v;
  const margin = c.indep.se != null ? TIE_Z * c.indep.se : null;
  const settingsDiffer = !!c.labSetting && !c.indep.sameSetting;
  if (margin == null) return { kind: Math.abs(diff) < 1e-9 ? 'match' : 'unknown', diff, margin, settingsDiffer };
  return { kind: Math.abs(diff) <= margin ? 'match' : diff > 0 ? 'lab' : 'ind', diff, margin, settingsDiffer };
}
