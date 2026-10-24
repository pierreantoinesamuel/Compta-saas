// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import axe from 'axe-core';
import { SkipNav } from '../components/SkipNav';
import { EmptyState } from '../components/EmptyState';
import { LoadingSkeleton } from '../components/LoadingSkeleton';

afterEach(cleanup);

async function assertNoViolations(container: HTMLElement) {
  const results = await axe.run(container, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
  });
  if (results.violations.length > 0) {
    const report = results.violations
      .map((v) => `[${v.id}] ${v.description}\n  ${v.nodes.map((n) => n.html).join('\n  ')}`)
      .join('\n');
    throw new Error(`axe-core WCAG 2.1 AA violations:\n${report}`);
  }
  expect(results.violations).toHaveLength(0);
}

describe('WCAG 2.1 AA / RGAA 4.1 — SkipNav', () => {
  it('has no a11y violations', async () => {
    const { container } = render(<SkipNav />);
    await assertNoViolations(container);
  });
});

describe('WCAG 2.1 AA / RGAA 4.1 — EmptyState', () => {
  it('title only has no violations', async () => {
    const { container } = render(<EmptyState title="Aucun résultat" />);
    await assertNoViolations(container);
  });

  it('with description has no violations', async () => {
    const { container } = render(
      <EmptyState title="Aucun résultat" description="Aucune donnée disponible pour le moment." />,
    );
    await assertNoViolations(container);
  });

  it('with CTA button has no violations', async () => {
    const { container } = render(
      <EmptyState
        title="Aucune facture"
        description="Créez votre première facture."
        ctaLabel="Nouvelle facture"
        onCta={() => {}}
      />,
    );
    await assertNoViolations(container);
  });
});

describe('WCAG 2.1 AA / RGAA 4.1 — LoadingSkeleton', () => {
  it('default (5 rows × 4 cols) has no violations', async () => {
    const { container } = render(<LoadingSkeleton />);
    await assertNoViolations(container);
  });

  it('custom rows/cols has no violations', async () => {
    const { container } = render(<LoadingSkeleton rows={3} cols={6} />);
    await assertNoViolations(container);
  });
});
