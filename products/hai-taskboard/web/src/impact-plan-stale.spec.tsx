import { fireEvent, render, screen } from '@testing-library/react';
import { App } from './app';

it('shows impact cause paths and the exact activation subject without activation', () => {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Impact preview' }));
  expect(screen.getByText(/sha256:impact-fixture-subject/)).toBeInTheDocument();
  expect(
    screen.getByText('spec:board-shell → AC:keyboard-parity'),
  ).toBeInTheDocument();
  expect(screen.getByText(/no activation is available/)).toBeInTheDocument();
});
