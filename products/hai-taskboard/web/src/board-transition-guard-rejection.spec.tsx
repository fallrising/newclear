import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from './app';

describe('board transition guard rejection', () => {
  it('preserves the authoritative lane, returns focus, and announces the guard', async () => {
    render(<App />);
    const target = screen.getByRole('button', {
      name: 'Move selected work item Implement Board-first fixture shell to QA',
    });
    fireEvent.click(target);
    await waitFor(() =>
      expect(
        screen.getByText(/Transition rejected: QA requires/),
      ).toBeInTheDocument(),
    );
    expect(target).toHaveFocus();
    expect(screen.getByTestId('authoritative-phase')).toHaveTextContent(
      'Ready',
    );
    expect(
      screen.getByText(/Review the Work item detail guard/),
    ).toBeInTheDocument();
  });
});
