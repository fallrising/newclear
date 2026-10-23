import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { ConnectedApp } from './connected/app';
const project = {
  project_id: 'prj_0000000001',
  name: 'Real project',
  version: 1,
  repository: { binding_id: null, root_hint: 'hint', approved_ref: 'main' },
  cursor: { stream_epoch: 1, event_sequence: 0 },
};
const item = {
  work_item_id: 'wi_0000000001',
  title: 'Live task',
  phase: 'Draft',
  version: 2,
  human_owner_id: 'operator',
  effective_satisfied: false,
  required_ac_count: 1,
  covered_ac_count: 0,
  active_blocker_count: 0,
  conditions: [],
};
const board = {
  cursor: project.cursor,
  projection: {
    project_id: project.project_id,
    lanes: [{ key: 'Draft', items: [item] }],
    attention_count: 0,
  },
};
const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
class Source extends EventTarget {
  close() {}
}
afterEach(() => vi.unstubAllGlobals());
describe('local-session-browser connected component boundary (not browser acceptance)', () => {
  it('inspects cookie session, clears password immediately, uses same-origin fetch, and logs out', async () => {
    let login!: (response: Response) => void;
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        response({ error: { code: 'unauthenticated', message: 'login' } }, 401),
      )
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            login = resolve;
          }),
      )
      .mockResolvedValueOnce(response({ items: [] }))
      .mockResolvedValueOnce(response({ status: 'logged_out' }));
    vi.stubGlobal('fetch', fetcher);
    render(<ConnectedApp />);
    const password = await screen.findByLabelText('Local operator secret');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Log in' })).toBeEnabled(),
    );
    fireEvent.change(password, { target: { value: 'a'.repeat(43) } });
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(password).toHaveValue('');
    expect(fetcher.mock.calls[1][1]).toMatchObject({
      credentials: 'same-origin',
      method: 'POST',
    });
    expect(fetcher.mock.calls[1][0]).toBe('/api/v1/session');
    login(response({ status: 'authenticated', actor: 'operator' }));
    const logout = await screen.findByRole('button', {
      name: 'Log out operator',
    });
    fireEvent.click(logout);
    await screen.findByLabelText('Local operator secret');
    expect(fetcher.mock.calls[3][1].method).toBe('DELETE');
    expect(screen.queryByText('a'.repeat(43))).not.toBeInTheDocument();
  });
  it('shows honest route unavailability without runtime fixture fallback', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          response({ status: 'authenticated', actor: 'operator' }),
        )
        .mockResolvedValueOnce(
          response(
            {
              error: {
                code: 'projection_unavailable',
                message: 'route unavailable',
              },
            },
            503,
          ),
        ),
    );
    render(<ConnectedApp />);
    await screen.findByText(/Project list unavailable/);
    expect(
      screen.queryByText('Implement Board-first fixture shell'),
    ).not.toBeInTheDocument();
  });
  it('keeps the server lane while pending and restores rejection focus and exact guard', async () => {
    vi.stubGlobal('EventSource', Source);
    let reject!: (response: Response) => void;
    const fetcher = vi.fn((url: string, options?: RequestInit) => {
      if (url === '/api/v1/session')
        return Promise.resolve(
          response({ status: 'authenticated', actor: 'operator' }),
        );
      if (url === '/api/v1/projects')
        return Promise.resolve(response({ items: [project] }));
      if (url.endsWith('/commands') && options?.method === 'POST')
        return new Promise<Response>((resolve) => {
          reject = resolve;
        });
      return Promise.resolve(
        response(url.endsWith('/board') ? board : project),
      );
    });
    // The stream opens only after a snapshot, just as the browser EventSource does.
    class OpenSource extends Source {
      addEventListener(name: string, listener: EventListener) {
        if (name === 'open') queueMicrotask(() => listener(new Event('open')));
      }
    }
    vi.stubGlobal('EventSource', OpenSource);
    vi.stubGlobal('fetch', fetcher);
    render(<ConnectedApp />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Real project' }),
    );
    const mark = await screen.findByRole('button', {
      name: 'Mark Live task Ready',
    });
    await waitFor(() => expect(mark).toBeEnabled());
    mark.focus();
    fireEvent.click(mark);
    expect(
      within(screen.getByRole('region', { name: 'Draft lane' })).getByText(
        'Live task',
      ),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(/Pending — authoritative lanes retained/),
    ).toBeInTheDocument();
    const body = JSON.parse(
      String(
        fetcher.mock.calls.find((call) => call[0].endsWith('/commands'))?.[1]
          ?.body,
      ),
    );
    expect(body).toMatchObject({
      operation: 'MarkReady',
      expected_version: 2,
      payload: { work_item_id: item.work_item_id },
    });
    expect(body.command_id).toMatch(/^cmd_[0-9A-HJKMNP-TV-Z]{20}$/);
    expect(body.idempotency_key).toMatch(/^[0-9a-f-]{36}$/);
    reject(
      response({
        ok: false,
        error: {
          code: 'version_conflict',
          message: 'Current version 3; review current accepted head',
          details: { unmet_guard: 'Accepted head required' },
        },
      }),
    );
    await screen.findByText(/Current version 3/);
    await waitFor(() => expect(mark).toHaveFocus());
    expect(screen.getByText(/Accepted head required/)).toBeInTheDocument();
    expect(
      fetcher.mock.calls.filter((call) => call[0].endsWith('/commands')),
    ).toHaveLength(1);
  });
});

it('requires explicit proposal, prepared read-set inspection, exact AC bytes and acceptance as separate commands', async () => {
  const digest = 'sha256:' + 'a'.repeat(64);
  const policy = 'sha256:' + 'b'.repeat(64);
  const subject = 'sha256:' + 'c'.repeat(64);
  const bindingDigest = 'sha256:' + 'd'.repeat(64);
  const calls: Record<string, unknown>[] = [];
  class OpenSource extends EventTarget {
    close() {}
    addEventListener(type: string, listener: EventListener) {
      super.addEventListener(type, listener);
      if (type === 'open') queueMicrotask(() => listener(new Event('open')));
    }
  }
  const fetcher = vi.fn((url: string, options?: RequestInit) => {
    if (url === '/api/v1/session')
      return Promise.resolve(
        response({ status: 'authenticated', actor: 'operator' }),
      );
    if (url === '/api/v1/projects')
      return Promise.resolve(response({ items: [project] }));
    if (url.endsWith('/repository-bindings/approved'))
      return Promise.resolve(
        response({
          binding_digest: bindingDigest,
          binding: {
            id: 'approved',
            version: 4,
            approved_by_actor: 'operator',
            refs: ['refs/heads/main'],
            manifest_paths: ['spec.json'],
          },
        }),
      );
    if (url.endsWith('/initial-acceptance'))
      return Promise.resolve(
        response({
          proposal_digest: digest,
          policy_revision_digest: policy,
          acceptance_subject_digest: subject,
          expected_version: 3,
          work_items: [
            { work_item_id: item.work_item_id, expected_version: 2 },
          ],
          ac_revisions: [{ ac_id: 'local', revision_digest: digest }],
        }),
      );
    if (url.endsWith('/commands')) {
      const body = JSON.parse(String(options?.body));
      calls.push(body);
      return Promise.resolve(
        response({
          ok: true,
          result:
            body.operation === 'ProposeSpecification'
              ? { type: 'SpecificationProposed', proposal_digest: digest }
              : { type: 'InitialSpecificationAccepted' },
        }),
      );
    }
    return Promise.resolve(response(url.endsWith('/board') ? board : project));
  });
  vi.stubGlobal('fetch', fetcher);
  vi.stubGlobal('EventSource', OpenSource);
  render(<ConnectedApp />);
  fireEvent.click(await screen.findByRole('button', { name: 'Real project' }));
  await screen.findByRole('button', { name: 'Mark Live task Ready' });
  fireEvent.change(screen.getByLabelText('Approved binding ID'), {
    target: { value: 'approved' },
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Inspect approved binding' }),
  );
  fireEvent.change(await screen.findByLabelText('Allowlisted ref'), {
    target: { value: 'refs/heads/main' },
  });
  fireEvent.change(screen.getByLabelText('Allowlisted manifest'), {
    target: { value: 'spec.json' },
  });
  const propose = screen.getByRole('button', { name: 'Propose specification' });
  await waitFor(() => expect(propose).toBeEnabled());
  expect(calls).toHaveLength(0);
  fireEvent.click(propose);
  await waitFor(() =>
    expect(screen.getByLabelText('Stored proposal digest')).toHaveValue(digest),
  );
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({
    operation: 'ProposeSpecification',
    expected_version: 1,
    payload: {
      repository_binding_id: 'approved',
      binding_version: 4,
      binding_digest: bindingDigest,
      ref: 'refs/heads/main',
      manifest_path: 'spec.json',
    },
  });
  const proposalInput = screen.getByLabelText('Stored proposal digest');
  fireEvent.change(proposalInput, { target: { value: digest + '/bad' } });
  fireEvent.submit(proposalInput.closest('form')!);
  expect(
    screen.getByText('Enter a canonical sha256 proposal digest.'),
  ).toBeInTheDocument();
  expect(
    fetcher.mock.calls.filter(([url]) => url.endsWith('/initial-acceptance')),
  ).toHaveLength(0);
  fireEvent.change(proposalInput, { target: { value: digest } });
  fireEvent.click(
    screen.getByRole('button', { name: 'Prepare initial acceptance' }),
  );
  const content = await screen.findByLabelText('Exact AC bytes for local');
  expect(
    fetcher.mock.calls.find(([url]) =>
      url.endsWith('/initial-acceptance'),
    )?.[0],
  ).toBe(
    '/api/v1/projects/' +
      project.project_id +
      '/proposals/' +
      digest +
      '/initial-acceptance',
  );
  expect(calls).toHaveLength(1);
  expect(screen.getByText(subject)).toBeInTheDocument();
  fireEvent.change(content, { target: { value: 'ZXhhY3QgYnl0ZXMK' } });
  fireEvent.click(screen.getByRole('checkbox', { name: /I inspected/ }));
  const accept = screen.getByRole('button', {
    name: 'Accept initial specification',
  });
  await waitFor(() => expect(accept).toBeEnabled());
  fireEvent.click(accept);
  await waitFor(() => expect(calls).toHaveLength(2));
  expect(calls[1]).toMatchObject({
    operation: 'AcceptInitialSpecification',
    expected_version: 3,
    payload: {
      proposal_digest: digest,
      policy_revision_digest: policy,
      acceptance_subject_digest: subject,
      work_items: [{ work_item_id: item.work_item_id, expected_version: 2 }],
      ac_contents: [{ ac_id: 'local', content: 'ZXhhY3QgYnl0ZXMK' }],
    },
  });
  expect(calls[0].command_id).not.toBe(calls[1].command_id);
});

it('a delayed login failure cannot overwrite a newer successful cookie inspection', async () => {
  let finishLogin!: (value: Response) => void;
  let gets = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, options?: RequestInit) => {
      if (url === '/api/v1/projects')
        return Promise.resolve(response({ items: [] }));
      if (options?.method === 'POST')
        return new Promise<Response>((resolve) => {
          finishLogin = resolve;
        });
      return Promise.resolve(
        ++gets === 1
          ? response(
              { error: { code: 'unauthenticated', message: 'login' } },
              401,
            )
          : response({ status: 'authenticated', actor: 'operator' }),
      );
    }),
  );
  render(<ConnectedApp />);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Log in' })).toBeEnabled(),
  );
  fireEvent.change(screen.getByLabelText('Local operator secret'), {
    target: { value: 'a'.repeat(43) },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
  fireEvent.click(screen.getByRole('button', { name: 'Check session' }));
  await screen.findByRole('button', { name: 'Log out operator' });
  await act(async () => {
    finishLogin(
      response(
        { error: { code: 'unauthenticated', message: 'rejected old request' } },
        401,
      ),
    );
  });
  expect(
    screen.getByRole('button', { name: 'Log out operator' }),
  ).toBeInTheDocument();
});

it.each(['inspection', 'logout', 'expiry'])(
  'a delayed login success cannot overwrite newer %s authority',
  async (action) => {
    let finishLogin!: (value: Response) => void;
    let finishList!: (value: Response) => void;
    let gets = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, options?: RequestInit) => {
        if (url === '/api/v1/projects')
          return action === 'expiry'
            ? new Promise<Response>((resolve) => {
                finishList = resolve;
              })
            : Promise.resolve(response({ items: [] }));
        if (options?.method === 'POST')
          return new Promise<Response>((resolve) => {
            finishLogin = resolve;
          });
        if (options?.method === 'DELETE')
          return Promise.resolve(response({ status: 'logged_out' }));
        gets += 1;
        return Promise.resolve(
          gets === 1 || action === 'inspection'
            ? response(
                { error: { code: 'unauthenticated', message: 'expired' } },
                401,
              )
            : response({ status: 'authenticated', actor: 'operator' }),
        );
      }),
    );
    render(<ConnectedApp />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Log in' })).toBeEnabled(),
    );
    fireEvent.change(screen.getByLabelText('Local operator secret'), {
      target: { value: 'a'.repeat(43) },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
    fireEvent.click(screen.getByRole('button', { name: 'Check session' }));
    if (action !== 'inspection') {
      const logout = await screen.findByRole('button', {
        name: 'Log out operator',
      });
      if (action === 'logout') fireEvent.click(logout);
      else
        await act(async () => {
          finishList(
            response(
              { error: { code: 'unauthenticated', message: 'expired' } },
              401,
            ),
          );
        });
    }
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Log in' })).toBeEnabled(),
    );
    await act(async () => {
      finishLogin(response({ status: 'authenticated', actor: 'obsolete' }));
    });
    expect(
      screen.queryByRole('button', { name: 'Log out obsolete' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log in' })).toBeEnabled();
  },
);

it('an older logout completion cannot override a newer authenticated session inspection', async () => {
  let finishLogout!: (value: Response) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, options?: RequestInit) => {
      if (url === '/api/v1/projects')
        return Promise.resolve(response({ items: [] }));
      if (options?.method === 'DELETE')
        return new Promise<Response>((resolve) => {
          finishLogout = resolve;
        });
      return Promise.resolve(
        response({ status: 'authenticated', actor: 'operator' }),
      );
    }),
  );
  render(<ConnectedApp />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Log out operator' }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Check session' }));
  await screen.findByRole('button', { name: 'Log out operator' });
  await act(async () => {
    finishLogout(response({ status: 'logged_out' }));
  });
  expect(
    screen.getByRole('button', { name: 'Log out operator' }),
  ).toBeInTheDocument();
});
