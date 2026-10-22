// @vitest-environment jsdom
import { it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fixtures from '../../tests/Fixtures/m33b-word-counts.json';
import { analyzeHtml } from './writingMetrics';
// Actual TS analyzer and PHP implementation consume identical synthetic bytes.
it('matches PHP categories for shared Unicode, provenance and block fixtures', () => {
  const php = process.env.M33B_PHP ?? 'php';
  const results = JSON.parse(execFileSync(php, ['scripts/m33b-word-counts.php'], { encoding: 'utf8' }));
  for (const fixture of fixtures) {
    const { text: _text, ...counts } = analyzeHtml(fixture.html);
    expect(results[fixture.id], fixture.id).toEqual(counts);
  }
});
