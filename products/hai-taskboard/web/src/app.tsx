import { useMemo, useRef, useState } from 'react';
import {
  attentionFixture,
  impactFixture,
  projectFixture,
  workItemsFixture,
} from './fixtures';
import {
  phases,
  type Phase,
  type TransitionIntent,
  type WorkItem,
} from './model';
import { Badge } from './components/ui/badge';
import { Button } from './components/ui/button';
import { Card } from './components/ui/card';

type Surface = 'Board' | 'Work item' | 'Attention' | 'Impact preview';

function laneFor(item: WorkItem): string {
  return item.conditions.includes('Blocked') ? 'Blocked' : item.phase;
}

function nextPhase(phase: Phase): Phase | undefined {
  return phases[phases.indexOf(phase) + 1];
}

function previousPhase(phase: Phase): Phase | undefined {
  return phases[phases.indexOf(phase) - 1];
}

function transitionFixture(intent: TransitionIntent, item: WorkItem) {
  if (intent.target === 'QA' && item.phase !== 'Review') {
    return {
      accepted: false as const,
      reason:
        'QA requires an approved current candidate and independent review.',
      detailId: 'guard-qa',
    };
  }
  if (
    item.conditions.some((condition) =>
      [
        'Blocked',
        'OutcomeUnknown',
        'CancelRequested',
        'Stale',
        'DoneStale',
      ].includes(condition),
    )
  ) {
    return {
      accepted: false as const,
      reason:
        'This item has an active recovery or stale-state guard. Its authoritative lane is unchanged.',
      detailId: 'guard-recovery',
    };
  }
  return {
    accepted: true as const,
    item: { ...item, phase: intent.target, version: item.version + 1 },
  };
}

export function App({
  onTransitionIntent,
}: {
  onTransitionIntent?: (intent: TransitionIntent) => void;
}) {
  const [surface, setSurface] = useState<Surface>('Board');
  const [items, setItems] = useState(workItemsFixture);
  const [selectedId, setSelectedId] = useState(workItemsFixture[1].id);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [notice, setNotice] = useState(
    'Board loaded from typed static fixtures.',
  );
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selected = items.find((item) => item.id === selectedId) ?? items[0];

  const lanes = useMemo(() => ['Blocked', ...phases] as const, []);

  function selectItem(id: string) {
    setSelectedId(id);
    setSurface('Board');
    setNotice(
      `Selected ${items.find((item) => item.id === id)?.title ?? 'work item'}.`,
    );
  }

  function submitTransition(
    intent: TransitionIntent,
    trigger: HTMLButtonElement,
  ) {
    triggerRef.current = trigger;
    onTransitionIntent?.(intent);
    const current = items.find((item) => item.id === intent.workItemId);
    if (!current) return;
    const result = transitionFixture(intent, current);
    if (!result.accepted) {
      setNotice(
        `Transition rejected: ${result.reason} Review the Work item detail guard.`,
      );
      queueMicrotask(() => triggerRef.current?.focus());
      return;
    }
    setItems((previous) =>
      previous.map((item) => (item.id === current.id ? result.item : item)),
    );
    setSelectedId(current.id);
    setNotice(
      `${current.title} moved to ${intent.target}. Command intent is fixture-only; no server mutation occurred.`,
    );
  }

  function makeIntent(
    item: WorkItem,
    target: Phase,
    source: TransitionIntent['source'],
  ): TransitionIntent {
    return {
      workItemId: item.id,
      target,
      expectedVersion: item.version,
      idempotencyKey: `fixture-${item.id}-${target}`,
      source,
    };
  }

  return (
    <main className="app-shell" data-theme={theme}>
      <a className="skip-link" href="#workspace">
        Skip to workspace
      </a>
      <header className="topbar">
        <div>
          <p className="eyebrow">LOCAL FIXTURE · NO LIVE MUTATIONS</p>
          <h1>HAI Taskboard</h1>
          <p className="muted">
            {projectFixture.name} · cursor {projectFixture.cursor}
          </p>
        </div>
        <div className="toolbar">
          <Badge tone="warning">Disconnected</Badge>
          <span className="cursor">Last synced {projectFixture.cursor}</span>
          <Button
            variant="outline"
            onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
            aria-pressed={theme === 'dark'}
          >
            Use {theme === 'light' ? 'dark' : 'light'} theme
          </Button>
        </div>
      </header>

      <nav className="nav" aria-label="Primary">
        {(
          ['Board', 'Work item', 'Attention', 'Impact preview'] as Surface[]
        ).map((item) => (
          <Button
            key={item}
            variant={surface === item ? 'default' : 'quiet'}
            onClick={() => setSurface(item)}
            aria-current={surface === item ? 'page' : undefined}
          >
            {item}
            {item === 'Attention' ? ` (${attentionFixture.length})` : ''}
          </Button>
        ))}
      </nav>

      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {notice}
      </p>
      <div id="workspace" className="workspace">
        {surface === 'Board' && (
          <>
            <section
              className="board"
              aria-label="Project board"
              aria-describedby="movement-instructions"
            >
              <p id="movement-instructions" className="instructions">
                Move controls, Alt + Arrow keys, and the drag test seam each
                send the same fixture command intent. Server position stays
                authoritative.
              </p>
              <div className="lane-grid">
                {lanes.map((lane) => (
                  <section
                    className="lane"
                    key={lane}
                    aria-labelledby={`lane-${lane}`}
                  >
                    <h2 id={`lane-${lane}`}>{lane}</h2>
                    {items
                      .filter((item) => laneFor(item) === lane)
                      .map((item) => (
                        <WorkCard
                          key={item.id}
                          item={item}
                          selected={selectedId === item.id}
                          onSelect={selectItem}
                          onTransition={submitTransition}
                          makeIntent={makeIntent}
                        />
                      ))}
                    {items.filter((item) => laneFor(item) === lane).length ===
                      0 && <p className="empty">No items</p>}
                  </section>
                ))}
              </div>
            </section>
            <Detail
              item={selected}
              makeIntent={makeIntent}
              onTransition={submitTransition}
            />
          </>
        )}
        {surface === 'Work item' && (
          <Detail
            item={selected}
            makeIntent={makeIntent}
            onTransition={submitTransition}
          />
        )}
        {surface === 'Attention' && <Attention />}
        {surface === 'Impact preview' && <Impact />}
      </div>
    </main>
  );
}

function WorkCard({
  item,
  selected,
  onSelect,
  onTransition,
  makeIntent,
}: {
  item: WorkItem;
  selected: boolean;
  onSelect: (id: string) => void;
  onTransition: (intent: TransitionIntent, trigger: HTMLButtonElement) => void;
  makeIntent: (
    item: WorkItem,
    target: Phase,
    source: TransitionIntent['source'],
  ) => TransitionIntent;
}) {
  const next = nextPhase(item.phase);
  return (
    <Card className={selected ? 'work-card selected' : 'work-card'}>
      <button
        className="card-select"
        data-testid={`card-select-${item.id}`}
        onClick={() => onSelect(item.id)}
        onKeyDown={(event) => {
          if (event.altKey && event.key === 'ArrowRight' && next)
            onTransition(
              makeIntent(item, next, 'keyboard'),
              event.currentTarget,
            );
          if (
            event.altKey &&
            event.key === 'ArrowLeft' &&
            previousPhase(item.phase)
          )
            onTransition(
              makeIntent(item, previousPhase(item.phase)!, 'keyboard'),
              event.currentTarget,
            );
        }}
        aria-describedby={`card-meta-${item.id}`}
      >
        <strong>{item.title}</strong>
        <span id={`card-meta-${item.id}`}>
          {item.phase} · {item.owner}
        </span>
      </button>
      <div className="card-meta">
        <span>
          AC {item.acCoverage[0]}/{item.acCoverage[1]}
        </span>
        <span>{item.run}</span>
        <span>Evidence: {item.evidence}</span>
        {item.blockerCount > 0 && (
          <Badge tone="danger">{item.blockerCount} blocker</Badge>
        )}
        {item.conditions.map((condition) => (
          <Badge key={condition} tone="warning">
            {condition === 'DoneStale' ? 'Done · Stale' : condition}
          </Badge>
        ))}
      </div>
      <div className="card-actions">
        <Button
          variant="outline"
          aria-label={`Move card ${item.title} to ${next ?? item.phase}`}
          onClick={(event) =>
            onTransition(
              makeIntent(item, next ?? item.phase, 'click'),
              event.currentTarget,
            )
          }
          disabled={!next}
        >
          Move to {next ?? item.phase}
        </Button>
        <Button
          variant="quiet"
          aria-label={`Drag card ${item.title} to ${next ?? item.phase} test seam`}
          onClick={(event) =>
            onTransition(
              makeIntent(item, next ?? item.phase, 'drag-seam'),
              event.currentTarget,
            )
          }
          disabled={!next}
        >
          Drag to {next ?? item.phase} (test seam)
        </Button>
      </div>
    </Card>
  );
}

function Detail({
  item,
  makeIntent,
  onTransition,
}: {
  item: WorkItem;
  makeIntent: (
    item: WorkItem,
    target: Phase,
    source: TransitionIntent['source'],
  ) => TransitionIntent;
  onTransition: (intent: TransitionIntent, trigger: HTMLButtonElement) => void;
}) {
  return (
    <aside className="detail" aria-labelledby="detail-title">
      <p className="eyebrow">WORK ITEM DETAIL · {item.id}</p>
      <h2 id="detail-title">{item.title}</h2>
      <p data-testid="authoritative-phase">
        Current authoritative phase: <strong>{item.phase}</strong> · version{' '}
        {item.version}
      </p>
      <section id="guard-qa">
        <h3>Next eligible action and exact guard</h3>
        <p>
          {item.pendingAction}. QA requires an approved current candidate and
          independent review; Done requires the exact completion subject digest.
        </p>
      </section>
      <section id="guard-recovery">
        <h3>Conditions and recovery</h3>
        <p>
          {item.conditions.length
            ? item.conditions.join(', ')
            : 'No active condition.'}{' '}
          {item.causePath ? `Cause path: ${item.causePath}.` : ''}
        </p>
      </section>
      <section>
        <h3>Acceptance and subject</h3>
        <p>
          Required AC coverage {item.acCoverage[0]}/{item.acCoverage[1]};
          fixture subject digest <code>sha256:fixture-current-subject</code>.
        </p>
      </section>
      <section>
        <h3>Runs, review and evidence</h3>
        <p>
          {item.run}. Evidence: {item.evidence}. Logs are intentionally absent
          from the primary state surface.
        </p>
      </section>
      <div
        className="move-targets"
        aria-label={`Move ${item.title} to a phase`}
      >
        {phases.map((phase) => (
          <Button
            key={phase}
            variant="outline"
            aria-label={`Move selected work item ${item.title} to ${phase}`}
            onClick={(event) =>
              onTransition(
                makeIntent(item, phase, 'click'),
                event.currentTarget,
              )
            }
            disabled={phase === item.phase}
          >
            Move to {phase}
          </Button>
        ))}
      </div>
    </aside>
  );
}

function Attention() {
  return (
    <section className="surface" aria-labelledby="attention-title">
      <h2 id="attention-title">Attention inbox</h2>
      <p>Actionable projection states only; no activity feed.</p>
      {attentionFixture.map((item) => (
        <Card key={item.id}>
          <Badge tone="warning">{item.kind}</Badge>
          <h3>{item.title}</h3>
          <p>{item.cause}</p>
          <p>
            <strong>{item.risk}</strong> · {item.action}
          </p>
        </Card>
      ))}
    </section>
  );
}

function Impact() {
  return (
    <section className="surface" aria-labelledby="impact-title">
      <h2 id="impact-title">Impact preview</h2>
      <p>
        Exact activation subject <code>sha256:impact-fixture-subject</code>; no
        activation is available in this fixture shell.
      </p>
      <div
        className="impact-table"
        role="table"
        aria-label="Impact plan affected items"
      >
        <div role="row" className="table-head">
          <span role="columnheader">Item</span>
          <span role="columnheader">Applicability</span>
          <span role="columnheader">Cause path</span>
          <span role="columnheader">Evidence</span>
        </div>
        {impactFixture.map((item) => (
          <div role="row" key={item.id}>
            <span role="cell">{item.id}</span>
            <span role="cell">{item.applicability}</span>
            <span role="cell">{item.causePath}</span>
            <span role="cell">{item.reuse}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
