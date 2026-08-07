// Pure-logic tests for the panel view-models. Run with `node --test` — no
// dependencies, no browser, no build step.

const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../src/content/viewmodels.js');

test('themeVars returns dark palette by default and light on request', () => {
  assert.equal(V.themeVars('dark')['--bg'], '#0d1117');
  assert.equal(V.themeVars('light')['--bg'], '#ffffff');
  assert.equal(V.themeVars('anything-else')['--bg'], '#0d1117');
});

test('normalizeUrl strips protocol, www, query, trailing slash and lowercases', () => {
  assert.equal(V.normalizeUrl('https://WWW.Foo.com/Bar/?x=1'), 'foo.com/bar');
  assert.equal(V.normalizeUrl('http://foo.com/bar/'), 'foo.com/bar');
});

test('bareDomain drops a leading www.', () => {
  assert.equal(V.bareDomain('www.Target.com.au'), 'target.com.au');
  assert.equal(V.bareDomain('target.com.au'), 'target.com.au');
});

test('sparklinePath needs at least two points and produces a closed area', () => {
  assert.equal(V.sparklinePath([5]), null);
  const p = V.sparklinePath([10, 20, 15]);
  assert.ok(p.stroke.startsWith('M '));
  assert.ok(p.area.endsWith('L 100,30 L 0,30 Z'));
});

test('trendDirection maps enum values to glyphs', () => {
  assert.equal(V.trendDirection('down').glyph, '↘');
  assert.equal(V.trendDirection('lowest').glyph, '↘');
  assert.equal(V.trendDirection('up').glyph, '↗');
  assert.equal(V.trendDirection('none').dir, 'flat');
});

test('money formats currency, integers without cents, and handles blanks', () => {
  assert.equal(V.money(84, 'AUD'), '$84.00');
  assert.equal(V.money(84.5, 'AUD'), '$84.50');
  assert.equal(V.money(99.99, 'GBP'), '£99.99');
  assert.equal(V.money(null, 'AUD'), '—');
  assert.equal(V.money('', 'AUD'), '—');
});

test('trackedFor summarises an elapsed duration', () => {
  const now = '2026-07-02T00:00:00Z';
  assert.equal(V.trackedFor('2026-07-02T00:00:00Z', now), null); // no elapsed time
  assert.equal(V.trackedFor('2026-06-30T00:00:00Z', now), 'tracked 2 days');
  assert.equal(V.trackedFor('2026-01-02T00:00:00Z', now), 'tracked 6 mos');
});

test('dealTiming prefers all-time-low, then verdict, then percentile', () => {
  assert.equal(V.dealTiming({ dealScore: { isAllTimeLow: true } }).tone, 'good');
  const verdict = V.dealTiming({ dealScore: { verdict: 'Decent time to buy' }, percentile: { percentCheaperThan: 52 } });
  assert.match(verdict.text, /Decent time to buy — cheaper than 52% of the year/);
  assert.equal(verdict.tone, 'good');
  const pctOnly = V.dealTiming({ percentile: { percentCheaperThan: 20 } });
  assert.equal(pctOnly.tone, 'warn');
  assert.equal(V.dealTiming({}), null);
});

// A representative product mirroring the API shape (price_cache + insights).
function sampleProduct() {
  return {
    id: 7,
    title: 'Xbox Wireless Controller – Carbon Black',
    image: 'https://img/controller.jpg',
    created_at: '2025-12-02T00:00:00Z',
    price_cache: [
      { store_id: 1, store_name: 'Target AU', url: 'https://target.com.au/p/xbox', trend: 'down', price: 84, currency: 'AUD', history: { '2025-12-01': 90, '2025-12-15': 84 } },
      { store_id: 2, store_name: 'Amazon AU', url: 'https://amazon.com.au/p/xbox', trend: 'up', price: 98, currency: 'AUD', history: { '2025-12-01': 95, '2025-12-15': 98 } },
      { store_id: 3, store_name: 'Big W', url: 'https://bigw.com.au/p/xbox', trend: 'up', price: 99, currency: 'AUD', history: {} },
    ],
  };
}

function sampleInsights() {
  return {
    bestPrice: 84, bestStore: 'Target AU',
    stats: { lowest: 64, average: 90.27, highest: 99, current: 84 },
    percentile: { beatFraction: 0.52, percentCheaperThan: 52 },
    dealScore: { verdict: 'Decent time to buy', isAllTimeLow: false },
    dailyBest: [90, 88, 86, 84, 84, 85, 84],
    hasEnoughData: true,
  };
}

test('buildInsights: current page becomes HERE, cheapest becomes BEST, saving computed', () => {
  const vm = V.buildInsights(sampleProduct(), sampleInsights(), 'https://www.amazon.com.au/p/xbox/?ref=nav');
  assert.equal(vm.title, 'Xbox Wireless Controller – Carbon Black');
  assert.equal(vm.storeCount, 3);

  const here = vm.here;
  const best = vm.best;
  assert.equal(here.store, 'Amazon AU');
  assert.equal(here.badge, 'HERE');
  assert.equal(best.store, 'Target AU');
  assert.equal(best.badge, 'BEST');

  // Amazon $98 vs best $84 → save $14.
  assert.equal(vm.saving, 14);
  assert.equal(vm.savingLabel, '$14.00');

  // Rows sorted cheapest first.
  assert.deepEqual(vm.rows.map((r) => r.store), ['Target AU', 'Amazon AU', 'Big W']);
  assert.equal(vm.rows[0].dirGlyph, '↘');
  assert.equal(vm.rows[1].dirGlyph, '↗');

  // Verdict: cheaper elsewhere → "switch" with a CTA to the best store.
  assert.equal(vm.verdict.mode, 'switch');
  assert.equal(vm.verdict.headline, 'Cheaper at Target AU');
  assert.match(vm.verdict.detail, /save \$14 buying from Target AU/);
  assert.equal(vm.verdict.cta.label, 'Open Target AU · $84');
  assert.equal(vm.verdict.cta.url, 'https://target.com.au/p/xbox');

  // "You're here" card: current store's own history stats + sparkline.
  assert.deepEqual(vm.hereStats, { min: '$95.00', avg: '$96.50', max: '$98.00' });
  assert.ok(vm.hereSpark && vm.hereSpark.stroke.startsWith('M '));

  // All-stores stats from the insights block.
  assert.deepEqual(vm.allStats, { min: '$64.00', avg: '$90.27', max: '$99.00' });
});

test('buildInsights: stats, timing and sparkline are wired from insights', () => {
  const vm = V.buildInsights(sampleProduct(), sampleInsights(), 'https://target.com.au/p/xbox');
  assert.equal(vm.stats.min, '$64.00');
  assert.equal(vm.stats.max, '$99.00');
  assert.equal(vm.stats.avg, '$90.27');
  assert.match(vm.timing.text, /cheaper than 52%/);
  assert.ok(vm.spark && vm.spark.stroke.startsWith('M '));
  // On the cheapest store, HERE and BEST coincide → no saving.
  assert.equal(vm.here.store, 'Target AU');
  assert.equal(vm.saving, 0);

  // Verdict: already on the best price → "buy" with no CTA.
  assert.equal(vm.verdict.mode, 'buy');
  assert.equal(vm.verdict.headline, 'Good time to buy here');
  assert.match(vm.verdict.detail, /Target AU has the best price right now — cheaper than 52% of the year\./);
  assert.equal(vm.verdict.cta, null);
});

test('buildInsights degrades gracefully without an insights block', () => {
  const vm = V.buildInsights(sampleProduct(), null, 'https://target.com.au/p/xbox');
  assert.equal(vm.stats, null);
  assert.equal(vm.timing, null);
  // Falls back to a listing history for the sparkline.
  assert.ok(vm.spark && vm.spark.stroke.startsWith('M '));
  assert.equal(vm.best.store, 'Target AU');
});

test('buildTrack reflects a live extraction and store matches', () => {
  const vm = V.buildTrack({ title: 'Xbox Controller', price: 84, currency: 'AUD', image: 'x.jpg' }, [{ id: 1 }, { id: 2 }], 'www.target.com.au');
  assert.equal(vm.priceLabel, '$84.00');
  assert.equal(vm.domain, 'target.com.au');
  assert.equal(vm.storeCount, 2);
  assert.equal(vm.storeFound, true);

  const empty = V.buildTrack(null, [], 'shop.example.com');
  assert.equal(empty.priceLabel, null);
  assert.equal(empty.storeFound, false);
});
