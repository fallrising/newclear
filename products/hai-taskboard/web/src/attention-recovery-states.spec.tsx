import { fireEvent, render, screen } from '@testing-library/react';
import { App } from './app';

it('presents disconnected, conflict, stale, unknown, cancel, and done-stale states distinctly', () => {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: /Attention/ }));
  for (const state of [
    'Disconnected',
    'Version conflict',
    'Stale input',
    'OutcomeUnknown',
    'CancelRequested',
    'Done · Stale',
  ]) {
    expect(screen.getAllByText(state).length).toBeGreaterThan(0);
  }
  expect(
    screen.getByText(/automatic retry, publish, and Done are unavailable/),
  ).toBeInTheDocument();
});
