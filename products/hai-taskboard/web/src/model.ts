export const phases = [
  'Draft',
  'Ready',
  'Developing',
  'Review',
  'QA',
  'Done',
] as const;
export type Phase = (typeof phases)[number];
export type Condition =
  'Blocked' | 'Stale' | 'OutcomeUnknown' | 'CancelRequested' | 'DoneStale';

export type WorkItem = {
  id: string;
  title: string;
  owner: string;
  phase: Phase;
  version: number;
  conditions: Condition[];
  blockerCount: number;
  acCoverage: readonly [number, number];
  run: string;
  evidence: string;
  pendingAction: string;
  revision?: string;
  causePath?: string;
};

export type AttentionItem = {
  id: string;
  kind: string;
  title: string;
  cause: string;
  risk: string;
  action: string;
};

export type ImpactItem = {
  id: string;
  applicability: 'Fresh' | 'Stale' | 'Unknown';
  causePath: string;
  reuse: 'Reusable' | 'Rebuild' | 'Unknown';
};

export type TransitionIntent = {
  workItemId: string;
  target: Phase;
  expectedVersion: number;
  idempotencyKey: string;
  source: 'click' | 'keyboard' | 'drag-seam';
};

export type TransitionResult =
  | { accepted: true; item: WorkItem }
  | { accepted: false; reason: string; detailId: string };
