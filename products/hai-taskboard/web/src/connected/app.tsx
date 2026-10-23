import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import {
  APIError,
  cursorText,
  identifier,
  metadata,
  projectPath,
  request,
  type Binding,
  type Board,
  type Preparation,
  type Project,
} from './client';
import {
  CommandRunner,
  type CommandState,
  type Intent,
  type Result,
} from './commands';
import { BoardStream } from './stream';
const busy = (state: CommandState) =>
  state.status === 'pending' || state.status === 'uncertain';
function Field({
  name,
  children,
  ...props
}: {
  name: string;
  children: ReactNode;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="connected-field">
      {children}
      <input name={name} {...props} />
    </label>
  );
}
const values = (event: FormEvent<HTMLFormElement>) =>
  new FormData(event.currentTarget);
const text = (data: FormData, name: string) => String(data.get(name) ?? '');
const errorMessage = (error: unknown) =>
  error instanceof APIError
    ? `${error.error.code}: ${error.message}`
    : 'Service unavailable. Check the local runtime and refresh.';

export function ConnectedApp() {
  const [theme, setTheme] = useState('light');
  const [session, setSession] = useState<
    'checking' | 'authenticated' | 'unauthenticated' | 'unavailable'
  >('checking');
  const [actor, setActor] = useState('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<Project>();
  const [board, setBoard] = useState<Board>();
  const [connection, setConnection] = useState('Disconnected');
  const [problem, setProblem] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [command, setCommand] = useState<CommandState>({ status: 'idle' });
  const [runner] = useState(
    () => new CommandRunner(request<Result>, setCommand),
  );
  const sessionGeneration = useRef(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const origin = useRef<HTMLElement | null>(null);
  const stream = useRef<BoardStream | undefined>(undefined);
  const [binding, setBinding] = useState<Binding>();
  const [proposal, setProposal] = useState('');
  const [prepared, setPrepared] = useState<Preparation>();
  const [acContents, setACContents] = useState<Record<string, string>>({});
  const authenticated = session === 'authenticated';
  const pending = busy(command);
  function expired(expectedGeneration = sessionGeneration.current) {
    if (expectedGeneration !== sessionGeneration.current) return;
    sessionGeneration.current += 1;
    stream.current?.stop();
    setConnection('Disconnected');
    setSession('unauthenticated');
    setBoard(undefined);
    setProject(undefined);
    setProjects([]);
    setProblem('Session unavailable. Log in to resume.');
  }
  async function inspect() {
    const generation = ++sessionGeneration.current;
    stream.current?.stop();
    setConnection('Revalidating');
    setSession('checking');
    setProblem('');
    try {
      const value = await request<{ status: string; actor: string }>(
        '/api/v1/session',
      );
      if (generation !== sessionGeneration.current) return;
      if (value.status !== 'authenticated') {
        expired();
        return;
      }
      setActor(value.actor);
      setSession('authenticated');
    } catch (error) {
      if (generation !== sessionGeneration.current) return;
      setSession(
        error instanceof APIError && error.status === 401
          ? 'unauthenticated'
          : 'unavailable',
      );
      setProblem('Local session unavailable. Check the runtime or log in.');
    }
  }
  useEffect(() => {
    void inspect();
  }, []); // Cookie authority is always inspected; never persisted in the shell.
  async function list(): Promise<boolean> {
    const generation = sessionGeneration.current;
    try {
      const value = await request<{ items: Project[] }>('/api/v1/projects');
      if (generation !== sessionGeneration.current) return false;
      setProjects(value.items);
      setProblem('');
      return true;
    } catch (error) {
      if (generation !== sessionGeneration.current) return false;
      if (
        error instanceof APIError &&
        (error.status === 401 || error.status === 403)
      )
        expired();
      else setProblem('Project list unavailable. ' + errorMessage(error));
      return false;
    }
  }
  useEffect(() => {
    if (authenticated) void list();
  }, [authenticated]);
  useEffect(() => {
    if (!authenticated || !project?.project_id) return;
    const id = project.project_id;
    const generation = sessionGeneration.current;
    let active = true;
    const current = new BoardStream(
      id,
      async () => {
        const [snapshot, projection] = await Promise.all([
          request<Board>(projectPath(id) + '/board'),
          request<Project>(projectPath(id)),
        ]);
        if (active && generation === sessionGeneration.current)
          setProject(projection);
        return snapshot;
      },
      (value) => {
        if (active && generation === sessionGeneration.current) setBoard(value);
      },
      (value) => {
        if (active && generation === sessionGeneration.current)
          setConnection(value);
      },
      () => expired(generation),
    );
    stream.current = current;
    void current.start();
    return () => {
      active = false;
      current.stop();
      if (stream.current === current) stream.current = undefined;
    };
  }, [authenticated, project?.project_id]);
  async function open(id: string) {
    const generation = sessionGeneration.current;
    setProblem('');
    try {
      const value = await request<Project>(projectPath(id));
      if (generation !== sessionGeneration.current) return;
      setBoard(undefined);
      setConnection('Connecting');
      setProject(value);
      setBinding(undefined);
      setPrepared(undefined);
      setACContents({});
      setProposal('');
    } catch (error) {
      if (generation !== sessionGeneration.current) return;
      if (error instanceof APIError && error.status === 401) expired();
      else setProblem('Project unavailable. ' + errorMessage(error));
    }
  }
  async function finish(generation = sessionGeneration.current) {
    if (generation !== sessionGeneration.current) return;
    const state = runner.state;
    if (state.status === 'uncertain') {
      setAnnouncement(
        'Result pending verification. Original command retained; no retry was sent.',
      );
      return;
    }
    if (state.result?.ok) {
      const result = state.result.result;
      if (typeof result?.proposal_digest === 'string') {
        setProposal(result.proposal_digest);
        setPrepared(undefined);
      }
      setAnnouncement('Command accepted. Refreshing authoritative state.');
      if (project) {
        const refreshed = await stream.current?.refresh(true);
        if (generation !== sessionGeneration.current) return;
        const outcome =
          typeof result?.type === 'string' ? result.type : 'Command accepted';
        setAnnouncement(
          `${outcome}. ${refreshed ? 'Server projection refreshed; review the current board and cursor.' : 'Projection refresh unavailable; verify the cursor before another action.'}`,
        );
      } else {
        const refreshed = await list();
        if (generation !== sessionGeneration.current) return;
        setAnnouncement(
          refreshed
            ? 'Project creation accepted. Project list refreshed.'
            : 'Project creation accepted. Project list unavailable; refresh to verify.',
        );
      }
      heading.current?.focus();
    } else if (state.result?.error) {
      if (
        state.result.error.code === 'unauthenticated' ||
        state.result.error.code === 'permission_denied'
      )
        expired();
      setAnnouncement(
        'Command rejected. Review the exact guard and refresh before a new intent.',
      );
      // Allow the pending disabled state to render before restoring the originating native control.
      setTimeout(() => origin.current?.focus(), 0);
    }
  }
  async function send(
    operation: string,
    expectedVersion: number,
    payload: Record<string, unknown>,
    target = project?.project_id,
    create = false,
  ) {
    if (!target || pending) return;
    if (project && connection !== 'Connected' && !create) {
      setProblem(
        'Disconnected. Refresh and review the current snapshot before submitting.',
      );
      void stream.current?.refresh(true);
      return;
    }
    origin.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const meta = metadata(expectedVersion);
    const intent: Intent = {
      project: target,
      url: create ? '/api/v1/projects' : projectPath(target) + '/commands',
      commandID: meta.command_id,
      body: JSON.stringify(
        create
          ? { ...meta, project_id: target, ...payload }
          : { ...meta, operation, payload },
      ),
    };
    setProblem('');
    const generation = sessionGeneration.current;
    await runner.submit(intent);
    await finish(generation);
  }
  async function read<T>(path: string, apply: (value: T) => void) {
    const generation = sessionGeneration.current;
    try {
      const value = await request<T>(path);
      if (generation !== sessionGeneration.current) return;
      apply(value);
      setProblem('');
    } catch (error) {
      if (generation !== sessionGeneration.current) return;
      if (error instanceof APIError && error.status === 401) expired();
      else setProblem(errorMessage(error));
    }
  }
  return (
    <div className="app-shell connected-shell" data-theme={theme}>
      <a className="skip-link" href="#connected-main">
        Skip to workspace
      </a>
      <header className="topbar">
        <div>
          <p className="eyebrow">LOCAL · DETERMINISTIC FAKE ONLY</p>
          <h1>HAI Taskboard</h1>
        </div>
        <div className="toolbar">
          <button
            className="button"
            onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
          >
            Use {theme === 'light' ? 'dark' : 'light'} theme
          </button>
          {authenticated && (
            <button
              className="button"
              onClick={async () => {
                const generation = ++sessionGeneration.current;
                stream.current?.stop();
                setConnection('Disconnected');
                setSession('checking');
                try {
                  await request('/api/v1/session', undefined, 'DELETE');
                  if (generation !== sessionGeneration.current) return;
                  expired(generation);
                  setProblem('Logged out of this browser.');
                } catch {
                  if (generation !== sessionGeneration.current) return;
                  setSession('unavailable');
                  setProblem(
                    'Logout unavailable. Session status is unconfirmed.',
                  );
                }
              }}
            >
              Log out {actor}
            </button>
          )}
        </div>
      </header>
      <main id="connected-main">
        <h2 ref={heading} tabIndex={-1}>
          {project ? project.name + ' · Board' : 'Projects'}
        </h2>
        <p role="status" aria-live="polite">
          {announcement ||
            (session === 'checking' ? 'Inspecting local session…' : '')}
        </p>
        {problem && (
          <p role="alert" className="guard">
            {problem}
          </p>
        )}
        {!authenticated ? (
          <section className="surface">
            <h3>
              {session === 'unavailable'
                ? 'Local runtime unavailable'
                : 'Local operator login'}
            </h3>
            <p>
              This demonstration uses the configured local operator secret and a
              browser session cookie.
            </p>
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                const form = event.currentTarget;
                const token = text(values(event), 'token');
                form.reset();
                const generation = ++sessionGeneration.current;
                setSession('checking');
                setProblem('');
                try {
                  const result = await request<{ actor: string }>(
                    '/api/v1/session',
                    JSON.stringify({ token }),
                  );
                  if (generation !== sessionGeneration.current) return;
                  setActor(result.actor);
                  setSession('authenticated');
                } catch {
                  if (generation !== sessionGeneration.current) return;
                  setSession('unauthenticated');
                  setProblem(
                    'Login rejected or unavailable. Check the local runtime and secret.',
                  );
                }
              }}
            >
              <Field
                name="token"
                type="password"
                autoComplete="off"
                required
                maxLength={43}
              >
                Local operator secret
              </Field>
              <button
                className="button button-default"
                disabled={session === 'checking'}
              >
                Log in
              </button>
            </form>
            <button className="button" onClick={() => void inspect()}>
              Check session
            </button>
          </section>
        ) : (
          <>
            <nav className="nav" aria-label="Project navigation">
              <button
                className="button"
                disabled={pending}
                onClick={() => {
                  setProject(undefined);
                  setBoard(undefined);
                }}
              >
                Projects
              </button>
              <button
                className="button"
                onClick={() =>
                  project ? void stream.current?.refresh(true) : void list()
                }
              >
                Refresh {project ? 'board' : 'projects'}
              </button>
            </nav>
            {!project ? (
              <section className="surface">
                <h3>Available projects</h3>
                {projects.length ? (
                  <ul>
                    {projects.map((value) => (
                      <li key={value.project_id}>
                        <button
                          className="button"
                          disabled={pending}
                          onClick={() => void open(value.project_id)}
                        >
                          {value.name}
                        </button>{' '}
                        <code>{value.project_id}</code>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No project projection loaded.</p>
                )}
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void open(text(values(event), 'project'));
                  }}
                >
                  <Field name="project" required>
                    Open project ID
                  </Field>
                  <button className="button" disabled={pending}>
                    Open project
                  </button>
                </form>
                <h3>Create project</h3>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    const data = values(event);
                    void send(
                      'CreateProject',
                      0,
                      {
                        name: text(data, 'name'),
                        repository: {
                          root_hint: text(data, 'root_hint'),
                          approved_ref: text(data, 'approved_ref'),
                        },
                      },
                      identifier('prj'),
                      true,
                    );
                  }}
                >
                  <Field name="name" required maxLength={160}>
                    Project name
                  </Field>
                  <Field name="root_hint" required maxLength={512}>
                    Repository hint (does not grant approval)
                  </Field>
                  <Field name="approved_ref" required maxLength={200}>
                    Repository ref hint
                  </Field>
                  <button className="button" disabled={pending}>
                    Create project
                  </button>
                </form>
              </section>
            ) : (
              <>
                <p className="cursor">
                  {connection} · Last applied cursor:{' '}
                  {board ? cursorText(board.cursor) : 'none'} · Project version{' '}
                  {project.version}
                </p>
                {!board && (
                  <p>
                    Board snapshot unavailable or loading. No local fixture data
                    is shown.
                  </p>
                )}
                {board && (
                  <section
                    aria-label="Project board"
                    className="lane-grid"
                    tabIndex={0}
                  >
                    {board.projection.lanes.map((lane) => (
                      <section
                        className="lane"
                        key={lane.key}
                        aria-label={lane.key + ' lane'}
                      >
                        <h3>
                          {lane.key} ({lane.items.length})
                        </h3>
                        {lane.items.map((item) => (
                          <article className="card" key={item.work_item_id}>
                            <h4>{item.title}</h4>
                            <code>{item.work_item_id}</code>
                            <p>
                              {item.phase} ·{' '}
                              {item.conditions.join(', ') ||
                                'No projected conditions'}
                            </p>
                            <p className="card-meta">
                              Owner {item.human_owner_id}
                              <br />
                              Version {item.version} · AC{' '}
                              {item.covered_ac_count}/{item.required_ac_count}
                              <br />
                              {item.effective_satisfied
                                ? 'Effective satisfaction confirmed'
                                : 'Effective satisfaction unconfirmed'}{' '}
                              · Blockers {item.active_blocker_count}
                            </p>
                            {item.current_run && (
                              <p>
                                Run {item.current_run.run_id}:{' '}
                                {item.current_run.observed_state} ·{' '}
                                {item.current_run.dispatch_state} ·{' '}
                                {item.current_run.reconciliation_state}
                                <br />
                                Last observation{' '}
                                {item.current_run.last_observed_at || 'unknown'}
                              </p>
                            )}
                            {item.phase === 'Draft' && (
                              <button
                                className="button"
                                disabled={pending || connection !== 'Connected'}
                                onClick={() =>
                                  void send('MarkReady', item.version, {
                                    work_item_id: item.work_item_id,
                                  })
                                }
                              >
                                Mark {item.title} Ready
                              </button>
                            )}
                            {item.phase === 'Ready' && (
                              <form
                                onSubmit={(event) => {
                                  event.preventDefault();
                                  void send('DispatchRun', item.version, {
                                    work_item_id: item.work_item_id,
                                    adapter_id: 'fake/v1',
                                    scenario_id: text(
                                      values(event),
                                      'scenario',
                                    ),
                                  });
                                }}
                              >
                                <Field name="scenario" required maxLength={120}>
                                  Fake scenario ID for {item.title}
                                </Field>
                                <button
                                  className="button"
                                  disabled={
                                    pending || connection !== 'Connected'
                                  }
                                >
                                  Dispatch {item.title} to Developing
                                </button>
                              </form>
                            )}
                          </article>
                        ))}
                      </section>
                    ))}
                  </section>
                )}
                <section className="surface">
                  <h3>Create an empty Draft</h3>
                  <p>
                    Creating a Draft does not accept a specification or make it
                    Ready.
                  </p>
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      const data = values(event);
                      void send('CreateWorkItem', 0, {
                        work_item_id: identifier('wi'),
                        title: text(data, 'title'),
                        goal: text(data, 'goal'),
                        owner_id: text(data, 'owner'),
                        required_ac_revisions: [],
                      });
                    }}
                  >
                    <Field name="title" required maxLength={240}>
                      Work item title
                    </Field>
                    <Field name="goal" required maxLength={8000}>
                      Goal
                    </Field>
                    <Field name="owner" required maxLength={120}>
                      Human owner ID
                    </Field>
                    <button
                      className="button"
                      disabled={pending || connection !== 'Connected'}
                    >
                      Create empty Draft
                    </button>
                  </form>
                </section>
                <section className="surface">
                  <h3>Initial specification admission</h3>
                  <p>
                    Proposal, preparation and acceptance are separate explicit
                    actions. Only a headless project is eligible.
                  </p>
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      setBinding(undefined);
                      void read<Binding>(
                        projectPath(project.project_id) +
                          '/repository-bindings/' +
                          encodeURIComponent(text(values(event), 'binding')),
                        setBinding,
                      );
                    }}
                  >
                    <Field name="binding" required>
                      Approved binding ID
                    </Field>
                    <button className="button" disabled={pending}>
                      Inspect approved binding
                    </button>
                  </form>
                  {binding && (
                    <>
                      <p>
                        Approved by {binding.binding.approved_by_actor} ·
                        version {binding.binding.version}
                        <br />
                        <code>{binding.binding_digest}</code>
                      </p>
                      <form
                        onSubmit={(event) => {
                          event.preventDefault();
                          const data = values(event);
                          void send('ProposeSpecification', project.version, {
                            repository_binding_id: binding.binding.id,
                            binding_version: binding.binding.version,
                            binding_digest: binding.binding_digest,
                            ref: text(data, 'ref'),
                            manifest_path: text(data, 'manifest'),
                          });
                        }}
                      >
                        <label className="connected-field">
                          Allowlisted ref
                          <select name="ref" required defaultValue="">
                            <option value="" disabled>
                              Choose a ref
                            </option>
                            {binding.binding.refs.map((ref) => (
                              <option key={ref}>{ref}</option>
                            ))}
                          </select>
                        </label>
                        <label className="connected-field">
                          Allowlisted manifest
                          <select name="manifest" required defaultValue="">
                            <option value="" disabled>
                              Choose a manifest
                            </option>
                            {binding.binding.manifest_paths.map((path) => (
                              <option key={path}>{path}</option>
                            ))}
                          </select>
                        </label>
                        <button
                          className="button"
                          disabled={pending || connection !== 'Connected'}
                        >
                          Propose specification
                        </button>
                      </form>
                    </>
                  )}
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (!/^sha256:[0-9a-f]{64}$/.test(proposal)) {
                        setProblem('Enter a canonical sha256 proposal digest.');
                        return;
                      }
                      setPrepared(undefined);
                      setACContents({});
                      void read<Preparation>(
                        projectPath(project.project_id) +
                          '/proposals/' +
                          proposal +
                          '/initial-acceptance',
                        setPrepared,
                      );
                    }}
                  >
                    <label className="connected-field">
                      Stored proposal digest
                      <input
                        value={proposal}
                        onChange={(event) => {
                          setProposal(event.target.value);
                          setPrepared(undefined);
                        }}
                        required
                        pattern="sha256:[0-9a-f]{64}"
                      />
                    </label>
                    <button className="button" disabled={pending}>
                      Prepare initial acceptance
                    </button>
                  </form>
                  {prepared && (
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        void send(
                          'AcceptInitialSpecification',
                          prepared.expected_version,
                          {
                            proposal_digest: prepared.proposal_digest,
                            policy_revision_digest:
                              prepared.policy_revision_digest,
                            acceptance_subject_digest:
                              prepared.acceptance_subject_digest,
                            work_items: prepared.work_items,
                            ac_contents: prepared.ac_revisions.map((ac) => ({
                              ac_id: ac.ac_id,
                              content: acContents[ac.ac_id] ?? '',
                            })),
                          },
                        );
                      }}
                    >
                      <p>
                        Prepared project version {prepared.expected_version}.
                        This snapshot is not a reservation.
                      </p>
                      <p>
                        Policy <code>{prepared.policy_revision_digest}</code>
                        <br />
                        Subject{' '}
                        <code>{prepared.acceptance_subject_digest}</code>
                      </p>
                      <ul>
                        {prepared.work_items.map((item) => (
                          <li key={item.work_item_id}>
                            {item.work_item_id} · expected version{' '}
                            {item.expected_version}
                          </li>
                        ))}
                      </ul>
                      {prepared.ac_revisions.map((ac) => (
                        <label className="connected-field" key={ac.ac_id}>
                          Exact AC bytes for {ac.ac_id}, standard padded base64
                          (empty bytes allowed)<code>{ac.revision_digest}</code>
                          <textarea
                            aria-label={'Exact AC bytes for ' + ac.ac_id}
                            value={acContents[ac.ac_id] ?? ''}
                            onChange={(event) =>
                              setACContents({
                                ...acContents,
                                [ac.ac_id]: event.target.value,
                              })
                            }
                            maxLength={87384}
                            spellCheck={false}
                          />
                        </label>
                      ))}
                      <label className="connected-field">
                        <input type="checkbox" required />I inspected the
                        versions and digests and explicitly accept these exact
                        AC bytes.
                      </label>
                      <button
                        className="button"
                        disabled={pending || connection !== 'Connected'}
                      >
                        Accept initial specification
                      </button>
                    </form>
                  )}
                </section>
              </>
            )}
            {command.intent && (
              <section className="surface" aria-label="Command result">
                <h3>Command {command.intent.commandID}</h3>
                <p>
                  {command.status === 'pending'
                    ? 'Pending — authoritative lanes retained.'
                    : command.status === 'uncertain'
                      ? 'Result pending verification. Original intent retained; no automatic retry.'
                      : command.result?.ok
                        ? 'Accepted by server.'
                        : 'Rejected by server. Review intent before a new submission.'}
                </p>
                {command.result?.error && (
                  <p role="alert">
                    {command.result.error.code}: {command.result.error.message}
                    <br />
                    {command.result.error.details !== undefined
                      ? JSON.stringify(command.result.error.details)
                      : null}
                  </p>
                )}
                {command.status === 'uncertain' && (
                  <button
                    className="button"
                    onClick={async () => {
                      const generation = sessionGeneration.current;
                      await runner.recover();
                      await finish(generation);
                    }}
                  >
                    Look up original command result
                  </button>
                )}
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
