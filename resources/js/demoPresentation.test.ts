import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('reserves the seal column and gives every remaining card row full width', () => {
  const css = readFileSync('resources/css/app.css', 'utf8');
  expect(css).toMatch(/\.certificate-card > \.seal\s*\{[^}]*grid-column: 1;[^}]*grid-row: 1;/);
  expect(css).toMatch(/\.certificate-card > \.certificate-heading\s*\{[^}]*grid-column: 2;[^}]*grid-row: 1;/);
  expect(css).toMatch(/\.certificate-card > :not\(\.seal\):not\(\.certificate-heading\)\s*\{[^}]*grid-column: 1 \/ -1;/);
  expect(css).toContain('.certificate-card .certificate-sent:visited');
  expect(css).toContain('.certificate-card .certificate-sent:focus-visible');
});
