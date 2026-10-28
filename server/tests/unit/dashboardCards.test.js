import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ATTENTION_CARDS, STATUS_CARDS, UNRESOLVED } from '../../../client/src/lib/dashboardCards.js';
import { STATUSES } from '../../src/domain/constants.js';

const cards = [...STATUS_CARDS, ...ATTENTION_CARDS];
const filtersOf = (card) => Object.fromEntries(new URL(card.to, 'http://localhost').searchParams);

describe('dashboard cards', () => {
  it('links the unassigned card to unassigned, unresolved tickets', () => {
    const card = cards.find((c) => c.key === 'unassigned');
    assert.equal(new URL(card.to, 'http://localhost').pathname, '/tickets');
    assert.deepEqual(filtersOf(card), { assignee: 'unassigned', status: 'Open,In Progress,Waiting on Customer' });
  });

  it('uses every status except Resolved for unresolved filters', () => {
    assert.deepEqual(UNRESOLVED.split(','), STATUSES.filter((s) => s !== 'Resolved'));
  });

  it('makes every card clickable, with a unique key', () => {
    assert.equal(new Set(cards.map((c) => c.key)).size, cards.length);
    for (const card of cards) assert.match(card.to, /^\/tickets(\?|$)/, card.key);
  });
});
