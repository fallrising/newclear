import { APIError } from './client';
export type Intent = {
  project: string;
  url: string;
  body: string;
  commandID: string;
};
export type Result = {
  ok: boolean;
  result?: Record<string, unknown>;
  error?: { code: string; message: string; details?: unknown };
};
export type CommandState = {
  status: 'idle' | 'pending' | 'uncertain' | 'settled';
  intent?: Intent;
  result?: Result;
};
export class CommandRunner {
  state: CommandState = { status: 'idle' };
  constructor(
    readonly request: (url: string, body?: string) => Promise<Result>,
    readonly changed: (state: CommandState) => void,
  ) {}
  private set(state: CommandState) {
    this.state = state;
    this.changed(state);
  }
  async submit(intent: Intent) {
    if (this.state.status === 'pending' || this.state.status === 'uncertain')
      return;
    const captured = Object.freeze({ ...intent });
    this.set({ status: 'pending', intent: captured });
    try {
      this.set({
        status: 'settled',
        intent: captured,
        result: await this.request(captured.url, captured.body),
      });
    } catch (error) {
      if (error instanceof APIError)
        this.set({
          status: 'settled',
          intent: captured,
          result: { ok: false, error: error.error },
        });
      else {
        this.set({ status: 'uncertain', intent: captured });
        await this.recover();
      }
    }
  }
  async recover() {
    if (this.state.status !== 'uncertain' || !this.state.intent) return;
    const intent = this.state.intent;
    this.set({ status: 'pending', intent });
    try {
      this.set({
        status: 'settled',
        intent,
        result: await this.request(
          '/api/v1/projects/' +
            encodeURIComponent(intent.project) +
            '/commands/' +
            encodeURIComponent(intent.commandID),
        ),
      });
    } catch {
      this.set({ status: 'uncertain', intent });
    }
  }
}
