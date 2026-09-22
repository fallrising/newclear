import { readFileSync } from 'node:fs';
import { fireEvent, render, screen } from '@testing-library/react';
import { App } from './app';

it('has a 320px narrow layout rule and keeps the theme control textual', () => {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Use dark theme' }));
  expect(screen.getByRole('main')).toHaveAttribute('data-theme', 'dark');
  const stylesheet = readFileSync('src/styles.css', 'utf8');
  expect(stylesheet).toContain('@media (max-width: 700px)');
  expect(stylesheet).toContain('min-width: 320px');
});
