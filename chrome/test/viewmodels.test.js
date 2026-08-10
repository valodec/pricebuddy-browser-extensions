// Pure-logic tests for the panel view-models. Run with `node --test` — no
// dependencies, no browser, no build step.

const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../src/content/viewmodels.js');

test('themeVars returns dark palette by default and light on request', () => {
  // Dark bg is Tailwind gray-950, which is what Filament's `dark:bg-gray-950`
  // resolves to on the PriceBuddy panel.
  assert.equal(V.themeVars('dark')['--bg'], '#030712');
  assert.equal(V.themeVars('light')['--bg'], '#ffffff');
  assert.equal(V.themeVars('anything-else')['--bg'], '#030712');
});

test('both themes define exactly the same token set', () => {
  // A token present in one palette and missing from the other renders as an
  // unset custom property — invisible text, or a transparent background.
  const light = Object.keys(V.THEMES.light).sort();
  const dark = Object.keys(V.THEMES.dark).sort();
  assert.deepEqual(light, dark);
});

// Contrast, so the accessibility fixes can't silently regress. WCAG AA wants
// 4.5:1 for normal text; the panel uses --faint at 9-10.5px, so it counts.
function contrast(a, b) {
  const channel = (hex) => hex.replace('#', '').match(/../g)
    .map((h) => parseInt(h, 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const lum = (hex) => {
    const [r, g, b] = channel(hex);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test('text tokens meet WCAG AA against their background in both themes', () => {
  for (const mode of ['light', 'dark']) {
    const t = V.themeVars(mode);
    for (const token of ['--text', '--muted', '--faint', '--teal', '--red', '--amber']) {
      const ratio = contrast(t[token], t['--bg']);
      assert.ok(ratio >= 4.5, `${mode} ${token} on --bg is ${ratio.toFixed(2)}:1, need >= 4.5`);
    }
    // Primary button label sits on the accent, not on the background.
    const onTeal = contrast(t['--onTeal'], t['--teal']);
    assert.ok(onTeal >= 4.5, `${mode} --onTeal on --teal is ${onTeal.toFixed(2)}:1, need >= 4.5`);
  }
});

test('normalizeUrl strips protocol, www, query, trailing slash and lowercases', () => {
  assert.equal(V.normalizeUrl('https://WWW.Foo.com/Bar/?x=1'), 'foo.com/bar');
  assert.equal(V.normalizeUrl('http://foo.com/bar/'), 'foo.com/bar');
});

test('bareDomain drops a leading www.', () => {
  assert.equal(V.bareDomain('www.Target.com.au'), 'target.com.au');
  assert.equal(V.bareDomain('target.com.au'), 'target.com.au');
});

test('storeNameFromHost derives a store name from the domain, not the page', () => {
  // Regression: the default used to come from document.title, so saving on a
  // product page created stores called things like "Logitech MX Master 3S".
  assert.equal(V.storeNameFromHost('www.amazon.com.au'), 'Amazon');
  assert.equal(V.storeNameFromHost('bigw.com.au'), 'Bigw');
  assert.equal(V.storeNameFromHost('amazon.co.uk'), 'Amazon');
  assert.equal(V.storeNameFromHost('example.com'), 'Example');
  // A subdomain shouldn't win over the registrable label.
  assert.equal(V.storeNameFromHost('shop.example.com'), 'Example');
  assert.equal(V.storeNameFromHost('www.the-good-guys.com.au'), 'The Good Guys');
  // Degenerate input shouldn't throw.
  assert.equal(V.storeNameFromHost(''), '');
  assert.equal(V.storeNameFromHost('localhost'), 'Localhost');
});

test('trackedUrls prefers the urls include over price_cache', () => {
  const product = {
    urls: [{ url: 'https://target.com.au/p/xbox' }, { url: 'https://amazon.com.au/p/xbox' }],
    price_cache: [{ url: 'https://target.com.au/p/xbox?aff=pb' }],
  };
  assert.deepEqual(V.trackedUrls(product), [
    'https://target.com.au/p/xbox',
    'https://amazon.com.au/p/xbox',
  ]);
});

test('trackedUrls falls back to price_cache when urls is absent or empty', () => {
  const fromCache = { price_cache: [{ url: 'https://target.com.au/p/xbox?aff=pb' }] };
  assert.deepEqual(V.trackedUrls(fromCache), ['https://target.com.au/p/xbox?aff=pb']);
  assert.deepEqual(V.trackedUrls({ urls: [], price_cache: [{ url: 'https://a.com/x' }] }), ['https://a.com/x']);
});

test('trackedUrls tolerates missing, malformed and empty entries', () => {
  assert.deepEqual(V.trackedUrls({}), []);
  assert.deepEqual(V.trackedUrls(null), []);
  assert.deepEqual(V.trackedUrls({ urls: null, price_cache: null }), []);
  assert.deepEqual(V.trackedUrls({ urls: [{ url: '' }, null, {}, { url: 'https://a.com/x' }] }), ['https://a.com/x']);
});

test('trackedUrls: the affiliate-tagged and raw spellings normalise the same', () => {
  // price_cache carries buy_url (affiliate query params added); urls carries the
  // raw stored URL. Matching is done on normalizeUrl, which drops the query, so
  // whichever source we fall back to must resolve to the same key.
  const viaInclude = V.trackedUrls({ urls: [{ url: 'https://www.target.com.au/p/xbox/' }] });
  const viaCache = V.trackedUrls({ price_cache: [{ url: 'https://target.com.au/p/xbox?aff=pb&tag=x' }] });
  assert.equal(V.normalizeUrl(viaInclude[0]), V.normalizeUrl(viaCache[0]));
  assert.equal(V.normalizeUrl(viaInclude[0]), 'target.com.au/p/xbox');
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

test('money groups by the store locale, not the browser locale', () => {
  // The API now returns a BCP-47 tag per store, so an Australian price renders
  // the Australian way regardless of where the browser is.
  assert.equal(V.money(1234.5, 'AUD', 2, 'en-AU'), '$1,234.50');
  assert.equal(V.money(1234.5, 'EUR', 2, 'de-DE'), '€1.234,50');
  // Absent locale (older instance) falls back to the browser's.
  assert.ok(V.money(1234.5, 'AUD', 2, null).startsWith('$'));
  // A malformed tag must not throw — toLocaleString would otherwise reject it.
  assert.doesNotThrow(() => V.money(10, 'AUD', 2, 'not a locale'));
  assert.ok(V.money(10, 'AUD', 2, 'not a locale').startsWith('$'));
});

test('buildTrack uses the currency and locale from the extraction', () => {
  // Regression: meta-extraction had no currency, so Track rendered a bare
  // "127.49" while Insights rendered "$127.49" in the same panel.
  const vm = V.buildTrack(
    { title: 'x', price: 1234.5, currency: 'GBP', locale: 'en-GB' }, [], 'shop.co.uk',
  );
  assert.equal(vm.priceLabel, '£1,234.50');
  assert.equal(vm.currency, 'GBP');

  // Older instances omit both — render the number rather than guess a symbol.
  const bare = V.buildTrack({ title: 'x', price: 127.49 }, [], 'shop.com');
  assert.equal(bare.priceLabel, '127.49');
  assert.equal(bare.currency, null);
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

// The five keys emitted by App\Services\Insights\DealScoreCalculator, with the
// display copy it currently pairs with them.
const BACKEND_VERDICTS = [
  ['great', 'Great time to buy', 'good'],
  ['good', 'Good price', 'good'],
  ['average', 'About average', 'warn'],
  ['pricey', 'A bit pricey', 'warn'],
  ['wait', "Wait — it's expensive right now", 'warn'],
];

test('dealVerdictTone maps every backend verdictKey to the right tone', () => {
  for (const [verdictKey, verdict, expected] of BACKEND_VERDICTS) {
    assert.equal(V.dealVerdictTone({ verdictKey, verdict }), expected, `${verdictKey} should be ${expected}`);
  }
  assert.equal(V.dealVerdictTone(null), null);
  assert.equal(V.dealVerdictTone({}), null);
});

test('dealVerdictTone trusts verdictKey over the display copy', () => {
  // If the backend ever pairs a cautionary key with upbeat-sounding prose, the
  // key wins — prose is display copy and can be reworded at any time.
  assert.equal(V.dealVerdictTone({ verdictKey: 'wait', verdict: 'A good deal is coming' }), 'warn');
  assert.equal(V.dealVerdictTone({ verdictKey: 'great', verdict: 'Never been this expensive' }), 'good');
  // Unknown key falls through to the prose reading rather than throwing.
  assert.equal(V.dealVerdictTone({ verdictKey: 'brand-new-key', verdict: 'Great price' }), 'good');
});

test('dealVerdictTone is not fooled by negated prose when no key is present', () => {
  // The regression this guards: "not a good time to buy" contains both "good"
  // and "buy", and a naive substring match reads it as positive.
  assert.equal(V.dealVerdictTone({ verdict: 'Not a good time to buy' }), 'warn');
  assert.equal(V.dealVerdictTone({ verdict: "Wait — it's expensive right now" }), 'warn');
  assert.equal(V.dealVerdictTone({ verdict: 'Great time to buy' }), 'good');
  // Unrecognised wording defaults to the cautious tone.
  assert.equal(V.dealVerdictTone({ verdict: 'Hmm' }), 'warn');
});

test('dealTiming carries the backend lowConfidence flag through', () => {
  const thin = V.dealTiming({ dealScore: { verdictKey: 'good', verdict: 'Good price', lowConfidence: true } });
  assert.equal(thin.lowConfidence, true);
  const solid = V.dealTiming({ dealScore: { verdictKey: 'good', verdict: 'Good price', lowConfidence: false } });
  assert.equal(solid.lowConfidence, false);
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
    // Mirrors DealScoreData::toArray() — note `verdictKey` is the stable enum.
    dealScore: { score: 6.2, verdictKey: 'good', verdict: 'Good price', isAllTimeLow: false, lowConfidence: false },
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

test('buildInsights does not claim a good time to buy when the deal score says wait', () => {
  const insights = { ...sampleInsights(), dealScore: { verdictKey: 'wait', verdict: "Wait — it's expensive right now", isAllTimeLow: false } };
  // On the cheapest store, so mode is still "buy" — but being the cheapest store
  // is not the same as this being a good price, and the headline must not imply it.
  const vm = V.buildInsights(sampleProduct(), insights, 'https://target.com.au/p/xbox');
  assert.equal(vm.verdict.mode, 'buy');
  assert.equal(vm.verdict.headline, 'Cheapest here, but not a low price');
  assert.equal(vm.verdict.icon, '⌾');

  // ...whereas a positive key keeps the upbeat headline.
  const good = V.buildInsights(sampleProduct(), sampleInsights(), 'https://target.com.au/p/xbox');
  assert.equal(good.verdict.headline, 'Good time to buy here');
  assert.equal(good.verdict.icon, '✓');
});

test('buildInsights trusts the server is_current flag over URL comparison', () => {
  // The server matches on urls.id, so it stays correct where a string comparison
  // wouldn't — e.g. an affiliate-tagged buy_url that no longer resembles the page
  // URL. When the flag is present it wins outright.
  const product = sampleProduct();
  product.price_cache[0].is_current = false; // Target — would match by URL
  product.price_cache[1].is_current = true;  // Amazon — server says we're here
  product.price_cache[2].is_current = false;

  const vm = V.buildInsights(product, sampleInsights(), 'https://target.com.au/p/xbox');
  assert.equal(vm.here.store, 'Amazon AU');
});

test('buildInsights falls back to URL comparison when is_current is absent', () => {
  const vm = V.buildInsights(sampleProduct(), sampleInsights(), 'https://target.com.au/p/xbox');
  assert.equal(vm.here.store, 'Target AU');
});

test('buildInsights: affiliate-tagged buy_url still matches under the strip-all rule', () => {
  // eBay is tagged with six params that the server's denylist does not cover.
  // The fallback survives only because normalizeUrl drops the entire query.
  const product = sampleProduct();
  product.price_cache[0].url = 'https://target.com.au/p/xbox?campid=5338&mkcid=1&mkevt=1&mkrid=705&siteid=15&toolid=10001';

  const vm = V.buildInsights(product, sampleInsights(), 'https://www.target.com.au/p/xbox');
  assert.equal(vm.here.store, 'Target AU');
});

// Captured verbatim from a live PriceBuddy instance (GET /api/products/1
// ?include=insights&current_url=...). The shapes here are real, not assumed.
function livePayload() {
  return {
    id: 1,
    title: 'Apple Ipad WiFi',
    price_cache: [
      { store_id: 9, store_name: 'Big W', url_id: 2, url: 'https://www.bigw.com.au/product/x/p/6016877', price: 599, currency: 'AUD', trend: 'none', history: {}, is_current: true },
      { store_id: 1, store_name: 'Amazon AU', url_id: 1, url: 'https://www.amazon.com.au/dp/B0DZ8JZRXK', price: 669, currency: 'AUD', trend: 'none', history: {}, is_current: false },
    ],
    insights: {
      bestPrice: 599,
      bestStore: 'Big W',
      stats: { lowest: 599, average: 634, highest: 669, current: 599 },
      percentile: { beatFraction: 0, percentCheaperThan: 0 },
      dealScore: { score: 0, verdictKey: 'wait', verdict: "Wait — it's expensive right now", isAllTimeLow: false, lowConfidence: true },
      hasEnoughData: false,
    },
  };
}

test('live payload: cheapest store but a "wait" deal score is not sold as a good time to buy', () => {
  const p = livePayload();
  const vm = V.buildInsights(p, p.insights, 'https://www.bigw.com.au/product/x/p/6016877?utm_source=n&gclid=abc');

  // Server flagged Big W, and it is also the cheapest — so mode is "buy"...
  assert.equal(vm.here.store, 'Big W');
  assert.equal(vm.best.store, 'Big W');
  assert.equal(vm.verdict.mode, 'buy');

  // ...but the deal score says wait, so the copy must not claim otherwise.
  // Before the verdictKey fix this rendered "Good time to buy here".
  assert.equal(vm.verdict.headline, 'Cheapest here, but not a low price');
  assert.equal(vm.verdict.icon, '⌾');
  assert.equal(vm.verdict.lowConfidence, true);

  // And the detail must not read as a contradiction at percentile 0.
  assert.doesNotMatch(vm.verdict.detail, /best price right now — cheaper than 0%/);
  assert.match(vm.verdict.detail, /cheapest store for this, but the price beats only 0% of the year\./);

  // A verdict that already contains an em-dash doesn't get a second one.
  assert.doesNotMatch(vm.timing.text, /—.*—/);
  assert.match(vm.timing.text, /Wait — it's expensive right now · cheaper than 0% of the year/);
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
