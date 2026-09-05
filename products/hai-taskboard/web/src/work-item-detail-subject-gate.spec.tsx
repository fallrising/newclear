import { fireEvent, render, screen } from '@testing-library/react';
import { App } from './app';

it('keeps the exact subject and Done gate visible in Work item detail', () => {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Work item' }));
  expect(
    screen.getByText('Next eligible action and exact guard'),
  ).toBeInTheDocument();
  expect(
    screen.getByText(/sha256:fixture-current-subject/),
  ).toBeInTheDocument();
  expect(
    screen.getByText(/Done requires the exact completion subject digest/),
  ).toBeInTheDocument();
});
