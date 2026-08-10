// Pure view-model helpers for the PriceBuddy panel.
//
// Deliberately free of any `chrome.*` / DOM dependency so the data transforms
// that drive the redesigned Track / Insights / Tune tabs can be unit-checked
// with plain `node`. The content script consumes them via `window.PBView`; the
// same object is exported for Node so `test/viewmodels.test.js` can assert on it.

(function (root) {
  // ---------------------------------------------------------------------------
  // Theme — CSS custom properties, lifted verbatim from the Claude Design doc so
  // the panel renders identically in light and dark.
  // ---------------------------------------------------------------------------

  // Palette taken from the PriceBuddy Filament panel so the extension reads as
  // part of the same product:
  //   primary  = Color::Teal   (AdminPanelProvider::PRIMARY_COLOR) = Tailwind teal
  //   neutrals = Color::Gray                                       = Tailwind gray
  //   dark     = gray-950 page, gray-900 cards, gray-800 chips (what Filament's
  //              own `dark:bg-gray-*` utilities resolve to)
  //
  // `--teal` intentionally differs per mode: teal-400 (#2dd4bf) is the brand
  // value and reads well on a dark ground, but only reaches ~2.2:1 on white, so
  // light mode steps down to teal-600. `--logo-symbol` keeps the brand 400 in
  // both, matching PriceBuddy's own `_logo.scss`.
  const THEMES = {
    light: {
      '--bg': '#ffffff', '--frame': 'rgba(3,7,18,.12)',
      '--text': '#030712', '--muted': '#4b5563', '--faint': '#6b7280',
      '--card': '#f9fafb', '--chip': '#f3f4f6', '--input': '#f3f4f6',
      '--line': 'rgba(3,7,18,.10)', '--track': '#e5e7eb',
      '--teal': '#0f766e', '--tealdim': 'rgba(13,148,136,.10)', '--goodln': 'rgba(13,148,136,.28)', '--onTeal': '#ffffff',
      '--amber': '#b45309', '--amberdim': 'rgba(180,83,9,.10)',
      '--red': '#dc2626', '--redbg': 'rgba(220,38,38,.08)', '--redln': 'rgba(220,38,38,.26)',
      '--logo-symbol': '#2dd4bf', '--logo-text': '#030712',
    },
    dark: {
      '--bg': '#030712', '--frame': 'rgba(249,250,251,.10)',
      '--text': '#f9fafb', '--muted': '#9ca3af', '--faint': '#8a929f',
      '--card': '#111827', '--chip': '#1f2937', '--input': '#111827',
      '--line': 'rgba(249,250,251,.10)', '--track': '#374151',
      '--teal': '#2dd4bf', '--tealdim': 'rgba(45,212,191,.14)', '--goodln': 'rgba(45,212,191,.30)', '--onTeal': '#042f2e',
      '--amber': '#fbbf24', '--amberdim': 'rgba(251,191,36,.14)',
      '--red': '#f87171', '--redbg': 'rgba(248,113,113,.10)', '--redln': 'rgba(248,113,113,.28)',
      '--logo-symbol': '#2dd4bf', '--logo-text': '#f9fafb',
    },
  };

  function themeVars(theme) {
    return THEMES[theme === 'light' ? 'light' : 'dark'];
  }

  // ---------------------------------------------------------------------------
  // URL matching — mirrors the backend "host + path" comparison so we can pick
  // out the listing that belongs to the page the user is actually on.
  // ---------------------------------------------------------------------------

  function normalizeUrl(u) {
    try {
      const url = new URL(u);
      const host = url.host.replace(/^www\./i, '');
      return (host + url.pathname).replace(/\/+$/, '').toLowerCase();
    } catch {
      return String(u || '').replace(/^www\./i, '').toLowerCase();
    }
  }

  function bareDomain(host) {
    return String(host || '').replace(/^www\./i, '').toLowerCase();
  }

  // A sensible default *store* name for a domain — "www.amazon.com.au" → "Amazon".
  //
  // The previous default came from `document.title`, which on a product page is
  // the product, so saving created stores called things like
  // "Logitech MX Master 3S". A store's name is permanent and shared across every
  // product on that domain, so the default has to come from the domain.
  //
  // No public-suffix list here; the heuristic is "the label before the suffix",
  // treating a two-part suffix (`com.au`, `co.uk`) as one.
  const SUFFIX_LABELS = new Set(['com', 'co', 'net', 'org', 'gov', 'edu', 'ac']);

  function storeNameFromHost(host) {
    const labels = bareDomain(host).split('.').filter(Boolean);
    if (!labels.length) {
      return '';
    }
    let name = labels[0];
    if (labels.length >= 3 && SUFFIX_LABELS.has(labels[labels.length - 2])) {
      name = labels[labels.length - 3];
    } else if (labels.length >= 2) {
      name = labels[labels.length - 2];
    }
    return name
      .split(/[-_]/)
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  // Every URL a product is tracked at, for deciding whether the page in view is
  // one of them.
  //
  // Prefers the `urls` include, which the panel requests alongside a sparse
  // fieldset so the response can omit `price_cache` — that embeds a full
  // {date: price} history per store and dwarfs everything else. Falls back to
  // `price_cache` for instances that don't support the include.
  //
  // ── The two URL fields are NOT interchangeable ──────────────────────────────
  // `urls[].url`        raw, as the user saved it        → match on this
  // `price_cache[].url` affiliate-tagged `buy_url`       → link out with this
  //
  // They differ by whatever `config/affiliates.php` adds; eBay gets six params
  // (mkrid, mkcid, campid, siteid, toolid, mkevt). Matching survives here only
  // because normalizeUrl() drops the entire query string, so both spellings
  // collapse to host+path. That is load-bearing: adopting the server's
  // significant-param rule would make `price_cache[].url` stop matching the
  // untagged URL a browser is actually on. See TODO.md.
  //
  // Use `price_cache[].url` for the outbound store links in the Insights tab —
  // those *should* carry the affiliate tag.
  function trackedUrls(product) {
    const included = Array.isArray(product && product.urls) ? product.urls : [];
    const source = included.length ? included : ((product && product.price_cache) || []);
    return (Array.isArray(source) ? source : [])
      .map((entry) => entry && entry.url)
      .filter((url) => typeof url === 'string' && url.length > 0);
  }

  // ---------------------------------------------------------------------------
  // Sparkline — build an SVG path (viewBox 0..100 x 0..30) from a value series,
  // matching the design's amber area chart.
  // ---------------------------------------------------------------------------

  function sparklinePath(values) {
    const nums = (values || []).map(Number).filter((v) => !Number.isNaN(v));
    if (nums.length < 2) {
      return null;
    }
    const min = Math.min(...nums);
    const max = Math.max(...nums);
    const span = max - min || 1;
    const n = nums.length;
    const pts = nums.map((v, i) => [
      (i / (n - 1)) * 100,
      29 - ((v - min) / span) * 27,
    ]);
    const stroke = 'M ' + pts.map((q) => q[0].toFixed(2) + ',' + q[1].toFixed(2)).join(' L ');
    return { stroke, area: stroke + ' L 100,30 L 0,30 Z' };
  }

  // ---------------------------------------------------------------------------
  // Trend → direction glyph. Backend Trend enum: up | down | lowest | none.
  // Down / lowest are "good" (cheaper) — teal ↘; up is "bad" — red ↗.
  // ---------------------------------------------------------------------------

  function trendDirection(trend) {
    if (trend === 'down' || trend === 'lowest') {
      return { glyph: '↘', dir: 'down', color: 'var(--teal)' };
    }
    if (trend === 'up') {
      return { glyph: '↗', dir: 'up', color: 'var(--red)' };
    }
    return { glyph: '·', dir: 'flat', color: 'var(--faint)' };
  }

  // ---------------------------------------------------------------------------
  // Money formatting — keep it currency-aware but dependency-free.
  // ---------------------------------------------------------------------------

  const CURRENCY_SYMBOL = { USD: '$', AUD: '$', NZD: '$', CAD: '$', GBP: '£', EUR: '€', JPY: '¥' };

  /**
   * @param {number|string} amount
   * @param {?string} currency ISO 4217 code, e.g. "AUD"
   * @param {number} [decimals]
   * @param {?string} [locale] BCP-47 tag from the store, e.g. "en-AU". Grouping
   *   and separators should follow the store's locale, not the browser's — a
   *   German browser shouldn't render an Australian price as `1.234,56`.
   */
  function money(amount, currency, decimals, locale) {
    if (amount === null || amount === undefined || amount === '' || Number.isNaN(Number(amount))) {
      return '—';
    }
    const symbol = CURRENCY_SYMBOL[String(currency || '').toUpperCase()] || '';
    const value = Number(amount);
    const d = decimals === undefined ? 2 : decimals;
    const opts = { minimumFractionDigits: d, maximumFractionDigits: d };
    // An unknown tag makes toLocaleString throw; fall back to the browser's.
    try {
      return symbol + value.toLocaleString(locale || undefined, opts);
    } catch {
      return symbol + value.toLocaleString(undefined, opts);
    }
  }

  // Ordered numeric series from a {date: price} history map.
  function seriesFromHistory(history) {
    return Object.entries(history || {})
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([, v]) => Number(v))
      .filter((v) => !Number.isNaN(v));
  }

  // Min / avg / max of a numeric series, formatted as money (null if empty).
  function statsOf(values, currency, locale) {
    if (!values || !values.length) {
      return null;
    }
    const min = Math.min(...values);
    const max = Math.max(...values);
    const avg = Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100;
    return {
      min: money(min, currency, undefined, locale),
      avg: money(avg, currency, undefined, locale),
      max: money(max, currency, undefined, locale),
    };
  }

  // Approximate "tracked N mos / N days" label from an ISO created_at.
  function trackedFor(createdAt, now) {
    if (!createdAt) {
      return null;
    }
    const start = new Date(createdAt).getTime();
    const end = (now ? new Date(now) : new Date()).getTime();
    if (Number.isNaN(start) || end <= start) {
      return null;
    }
    const days = Math.floor((end - start) / 86400000);
    if (days < 1) {
      return 'tracked today';
    }
    if (days < 30) {
      return `tracked ${days} day${days === 1 ? '' : 's'}`;
    }
    const months = Math.round(days / 30);
    if (months < 12) {
      return `tracked ${months} mo${months === 1 ? '' : 's'}`;
    }
    const years = (days / 365).toFixed(days % 365 === 0 ? 0 : 1);
    return `tracked ${years} yr${Number(years) === 1 ? '' : 's'}`;
  }

  // ---------------------------------------------------------------------------
  // Deal-timing verdict → callout tone/copy. Prefers the backend dealScore
  // verdict, falling back to the percentile "cheaper than X%" framing.
  // ---------------------------------------------------------------------------

  // Tone per backend verdict key (App\Services\Insights\DealScoreCalculator).
  // `verdictKey` is the stable enum; `verdict` is display copy that can be
  // reworded at any time — never infer tone from the prose when a key is present.
  const DEAL_VERDICT_TONE = {
    great: 'good',
    good: 'good',
    average: 'warn',
    pricey: 'warn',
    wait: 'warn',
  };

  // Fallback for responses that predate `verdictKey`. Substring-matching prose is
  // inherently fragile — a reworded verdict like "Not a good time to buy" contains
  // both "good" and "buy" — so check for negation//caution wording first and
  // default to the cautious tone when nothing is recognised.
  const VERDICT_NEGATIVE = /\b(not|never|isn'?t|aren'?t|avoid|wait|hold off|poor|bad|worst|expensive|pricey|overpriced)\b/i;
  const VERDICT_POSITIVE = /\b(great|good|excellent|best|decent|bargain|low(est)?|cheap(est)?)\b/i;

  function verdictToneFromText(text) {
    if (VERDICT_NEGATIVE.test(text)) {
      return 'warn';
    }
    return VERDICT_POSITIVE.test(text) ? 'good' : 'warn';
  }

  /**
   * Tone for a dealScore block: the `verdictKey` enum when present, else a
   * negation-aware read of the prose, else null.
   * @returns {'good'|'warn'|null}
   */
  function dealVerdictTone(deal) {
    if (!deal) {
      return null;
    }
    if (deal.verdictKey && DEAL_VERDICT_TONE[deal.verdictKey]) {
      return DEAL_VERDICT_TONE[deal.verdictKey];
    }
    return deal.verdict ? verdictToneFromText(deal.verdict) : null;
  }

  function dealTiming(insights) {
    const deal = insights && insights.dealScore;
    const pct = insights && insights.percentile;
    const cheaperThan = pct && pct.percentCheaperThan != null ? Math.round(pct.percentCheaperThan) : null;
    // The backend flags when there are too few data points to trust the score;
    // surface it rather than presenting a confident-looking verdict regardless.
    const lowConfidence = !!(deal && deal.lowConfidence);

    if (deal && deal.isAllTimeLow) {
      return { tone: 'good', icon: '★', text: 'All-time low — great time to buy', lowConfidence };
    }

    const tone = dealVerdictTone(deal);
    if (tone) {
      // Some backend verdicts already contain an em-dash ("Wait — it's expensive
      // right now"); appending another clause with one reads as a run-on.
      const joiner = /[—–]/.test(deal.verdict) ? ' · ' : ' — ';
      const text = cheaperThan != null
        ? `${deal.verdict}${joiner}cheaper than ${cheaperThan}% of the year`
        : deal.verdict;
      return { tone, icon: tone === 'good' ? '✓' : '⌾', text, lowConfidence };
    }

    if (cheaperThan != null) {
      const good = cheaperThan >= 50;
      return {
        tone: good ? 'good' : 'warn',
        icon: good ? '✓' : '⌾',
        text: `Cheaper than ${cheaperThan}% of the year`,
        lowConfidence,
      };
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // The core Insights view-model. Consumes a product (with price_cache) plus its
  // optional `insights` block and the URL of the page in view, and produces the
  // shapes the panel renders: here-vs-best cards, per-store rows, stats, timing.
  // ---------------------------------------------------------------------------

  function buildInsights(product, insights, currentUrl) {
    const cache = Array.isArray(product && product.price_cache) ? product.price_cache : [];
    const target = normalizeUrl(currentUrl);

    // Per-store rows, cheapest first (backend already sorts, but be defensive).
    const rows = cache
      .map((entry) => {
        const price = Number(entry.price);
        return {
          storeId: entry.store_id,
          store: entry.store_name || '—',
          url: entry.url,
          currency: entry.currency,
          price: Number.isNaN(price) ? null : price,
          priceLabel: money(entry.price, entry.currency, undefined, entry.locale),
          locale: entry.locale || null,
          trend: entry.trend,
          availability: entry.availability,
          // `is_current` is the server's answer (it matches on urls.id, immune to
          // affiliate tagging); the normalizeUrl comparison is the fallback for
          // instances that don't accept `current_url`. See trackedUrls() on why
          // matching entry.url — the affiliate-tagged buy_url — only works while
          // normalizeUrl drops the whole query string.
          isHere: entry.is_current !== undefined
            ? !!entry.is_current
            : (!!entry.url && normalizeUrl(entry.url) === target),
          history: entry.history || {},
        };
      })
      .sort((a, b) => {
        if (a.price === null) return 1;
        if (b.price === null) return -1;
        return a.price - b.price;
      });

    const priced = rows.filter((r) => r.price !== null && r.price > 0);
    const here = rows.find((r) => r.isHere) || null;
    // Prefer the backend's chosen best listing; else the cheapest priced row.
    const bestByName = insights && insights.bestStore
      ? priced.find((r) => r.store === insights.bestStore)
      : null;
    const best = bestByName || priced[0] || null;

    rows.forEach((r) => {
      r.isBest = !!best && r === best;
      const t = trendDirection(r.trend);
      r.dirGlyph = t.glyph;
      r.dirColor = t.color;
      r.badge = r.isBest ? 'BEST' : (r.isHere ? 'HERE' : null);
    });

    const saving = here && best && here.price != null && best.price != null && here.price > best.price
      ? here.price - best.price
      : 0;

    const stats = insights && insights.stats ? insights.stats : null;
    const statCards = stats
      ? {
          min: money(stats.lowest, best && best.currency),
          avg: money(stats.average, best && best.currency),
          max: money(stats.highest, best && best.currency),
          current: money(stats.current, best && best.currency),
        }
      : null;

    // Sparkline series: prefer the daily-best series, else the current listing's
    // own history, else any listing with history.
    let series = insights && Array.isArray(insights.dailyBest) && insights.dailyBest.length >= 2
      ? insights.dailyBest
      : null;
    if (!series) {
      const source = (here && Object.keys(here.history).length >= 2 ? here : rows.find((r) => Object.keys(r.history).length >= 2)) || null;
      if (source) {
        series = Object.entries(source.history)
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([, v]) => Number(v));
      }
    }

    const storeCount = new Set(rows.map((r) => r.storeId).filter((v) => v != null)).size || rows.length;

    // Current-store ("you're here") own price history → sparkline + min/avg/max.
    const hereValues = here ? seriesFromHistory(here.history) : [];
    const hereStats = statsOf(
      hereValues.length ? hereValues : (here && here.price != null ? [here.price] : []),
      here && here.currency,
      here && here.locale,
    );
    const hereSpark = sparklinePath(hereValues);

    // Aggregate figures span every store, so format them the way the cheapest
    // store would — there's no single "correct" locale for a cross-store number.
    const cur = best && best.currency;
    const loc = best && best.locale;

    // All-stores min / avg / max from the materialized insights stats block.
    const allStats = stats
      ? {
          min: money(stats.lowest, cur, undefined, loc),
          avg: money(stats.average, cur, undefined, loc),
          max: money(stats.highest, cur, undefined, loc),
        }
      : null;

    // Verdict card — buy here vs switch to a cheaper store.
    const pct = insights && insights.percentile && insights.percentile.percentCheaperThan != null
      ? Math.round(insights.percentile.percentCheaperThan)
      : null;
    const cheaperElsewhere = !!(here && best && here !== best && here.price != null && best.price != null && best.price < here.price);
    const deal = insights && insights.dealScore;
    const lowConfidence = !!(deal && deal.lowConfidence);
    let verdict;
    if (cheaperElsewhere) {
      const dealPhrase = deal && deal.verdict ? deal.verdict : 'Decent price';
      verdict = {
        mode: 'switch',
        icon: '→',
        headline: `Cheaper at ${best.store}`,
        detail: `${dealPhrase} on ${here.store}, but you'll save ${money(saving, cur, 0, loc)} buying from ${best.store}.`,
        cta: best.url ? { label: `Open ${best.store} · ${money(best.price, cur, 0, loc)}`, url: best.url } : null,
        lowConfidence,
      };
    } else if (here || best) {
      const focus = here || best;
      const allTimeLow = deal && deal.isAllTimeLow;
      // Don't claim it's a good time to buy when the deal score says otherwise —
      // being on the cheapest *store* is not the same as this being a good price.
      const goodTiming = dealVerdictTone(deal) !== 'warn';
      verdict = {
        mode: 'buy',
        icon: goodTiming ? '✓' : '⌾',
        headline: allTimeLow
          ? 'All-time low — buy now'
          : (goodTiming ? 'Good time to buy here' : 'Cheapest here, but not a low price'),
        // "has the best price right now" is about stores; the percentile is about
        // time. Saying both in one breath reads as a contradiction when the
        // percentile is low ("best price right now — cheaper than 0% of the
        // year"), so the cautious case gets its own phrasing.
        detail: goodTiming
          ? `${focus.store} has the best price right now${pct != null ? ` — cheaper than ${pct}% of the year.` : '.'}`
          : `${focus.store} is your cheapest store for this${pct != null ? `, but the price beats only ${pct}% of the year.` : ', but the price is high right now.'}`,
        cta: null,
        lowConfidence,
      };
    } else {
      verdict = null;
    }

    return {
      title: product && product.title ? product.title : '',
      image: product && product.image ? product.image : null,
      productId: product && product.id ? product.id : null,
      storeCount,
      trackedFor: trackedFor(product && product.created_at),
      here,
      best,
      saving,
      savingLabel: saving > 0 ? money(saving, best && best.currency) : null,
      rows,
      stats: statCards,
      series,
      spark: sparklinePath(series),
      timing: dealTiming(insights),
      verdict,
      hereStats,
      hereSpark,
      allStats,
      hasEnoughData: insights ? !!insights.hasEnoughData : rows.length > 0,
    };
  }

  // ---------------------------------------------------------------------------
  // Track tab — small view-model over a live meta-extraction result + store
  // lookup so the "detected price" card and "N stores found" pill are real.
  // ---------------------------------------------------------------------------

  function buildTrack(extraction, storeMatches, host) {
    const stores = Array.isArray(storeMatches) ? storeMatches : [];
    return {
      title: (extraction && extraction.title) || '',
      image: (extraction && extraction.image) || null,
      domain: bareDomain(host),
      // `currency` / `locale` sit next to `price` on the meta-extraction response.
      // Older instances omit them, in which case money() renders an unadorned
      // number rather than guessing a symbol.
      priceLabel: extraction && extraction.price != null
        ? money(extraction.price, extraction.currency, undefined, extraction.locale)
        : null,
      currency: (extraction && extraction.currency) || null,
      storeCount: stores.length,
      storeFound: stores.length > 0,
    };
  }

  const api = {
    themeVars, THEMES,
    normalizeUrl, bareDomain, trackedUrls, storeNameFromHost,
    sparklinePath, trendDirection,
    money, trackedFor, dealTiming, dealVerdictTone,
    buildInsights, buildTrack,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.PBView = api;
  }
})(typeof self !== 'undefined' ? self : this);
