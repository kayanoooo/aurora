import React from 'react';
import { render, screen } from '@testing-library/react';
import App from './App';

test('renders Aurora authentication screen', async () => {
  render(<App />);
  expect(await screen.findByRole('heading', { name: /Aurora/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Вход|Sign In/i })).toBeInTheDocument();
});
