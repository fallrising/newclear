import { fireEvent, render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { App } from './app';
import type { TransitionIntent } from './model';

describe('board transition accessibility', () => {
  it('uses labeled non-drag controls and has no axe violations in the fixture DOM', async () => {
    document.documentElement.lang = 'en';
    document.title = 'HAI Taskboard';
    render(<App />);
    expect(screen.getByText(/Move controls, Alt/)).toBeVisible();
    expect(
      screen.getByRole('button', {
        name: 'Move card Implement Board-first fixture shell to Developing',
      }),
    ).toBeEnabled();
    const results = await axe.run(document);
    expect(results.violations).toEqual([]);
  });

  it('routes a keyboard intent through the same move result', () => {
    render(<App />);
    fireEvent.keyDown(screen.getByTestId('card-select-wi_01HREADY'), {
      altKey: true,
      key: 'ArrowRight',
    });
    expect(screen.getByText(/moved to Developing/)).toBeInTheDocument();
  });

  it('emits the same command contract for click, keyboard, and drag seam', () => {
    const intents: TransitionIntent[] = [];
    const expected = {
      workItemId: 'wi_01HREADY',
      target: 'Developing',
      expectedVersion: 8,
      idempotencyKey: 'fixture-wi_01HREADY-Developing',
    };
    const invoke = (source: 'click' | 'keyboard' | 'drag-seam') => {
      const view = render(
        <App onTransitionIntent={(intent) => intents.push(intent)} />,
      );
      const card = screen.getByTestId('card-select-wi_01HREADY');
      if (source === 'click') {
        fireEvent.click(
          screen.getByRole('button', {
            name: 'Move card Implement Board-first fixture shell to Developing',
          }),
        );
      }
      if (source === 'keyboard') {
        fireEvent.keyDown(card, { altKey: true, key: 'ArrowRight' });
      }
      if (source === 'drag-seam') {
        fireEvent.click(
          screen.getByRole('button', {
            name: 'Drag card Implement Board-first fixture shell to Developing test seam',
          }),
        );
      }
      view.unmount();
    };
    invoke('click');
    invoke('keyboard');
    invoke('drag-seam');
    expect(
      intents.map((intent) => ({
        workItemId: intent.workItemId,
        target: intent.target,
        expectedVersion: intent.expectedVersion,
        idempotencyKey: intent.idempotencyKey,
      })),
    ).toEqual([expected, expected, expected]);
    expect(intents.map((intent) => intent.source)).toEqual([
      'click',
      'keyboard',
      'drag-seam',
    ]);
  });
});
