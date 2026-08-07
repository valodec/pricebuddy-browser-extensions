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

  const THEMES = {
    light: {
      '--bg': '#ffffff', '--frame': 'rgba(0,0,0,.10)',
      '--text': '#141a1f', '--muted': '#57606a', '--faint': '#8a9199',
      '--card': '#f6f7f9', '--chip': '#eef1f4', '--input': '#e7eaee',
      '--line': 'rgba(0,0,0,.09)', '--track': '#e3e6ea',
      '--teal': '#0c9d86', '--tealdim': 'rgba(12,157,134,.12)', '--goodln': 'rgba(12,157,134,.30)', '--onTeal': '#ffffff',
      '--amber': '#b7791f', '--amberdim': 'rgba(183,121,31,.10)',
      '--red': '#d64545', '--redbg': 'rgba(214,69,69,.09)', '--redln': 'rgba(214,69,69,.28)',
    },
    dark: {
      '--bg': '#0d1117', '--frame': 'rgba(255,255,255,.09)',
      '--text': '#e6edf3', '--muted': '#8b949e', '--faint': '#6e7681',
      '--card': '#161b22', '--chip': '#1c222b', '--input': '#0d1117',
      '--line': 'rgba(255,255,255,.08)', '--track': '#20262f',
      '--teal': '#2fe0c8', '--tealdim': 'rgba(47,224,200,.14)', '--goodln': 'rgba(47,224,200,.30)', '--onTeal': '#08110f',
      '--amber': '#f0b429', '--amberdim': 'rgba(240,180,41,.14)',
      '--red': '#f87171', '--redbg': 'rgba(248,113,113,.1)', '--redln': 'rgba(248,113,113,.28)',
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

  function money(amount, currency, decimals) {
    if (amount === null || amount === undefined || amount === '' || Number.isNaN(Number(amount))) {
      return '—';
    }
    const symbol = CURRENCY_SYMBOL[String(currency || '').toUpperCase()] || '';
    const value = Number(amount);
    const d = decimals === undefined ? 2 : decimals;
    return symbol + value.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
  }

  // Ordered numeric series from a {date: price} history map.
  function seriesFromHistory(history) {
    return Object.entries(history || {})
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([, v]) => Number(v))
      .filter((v) => !Number.isNaN(v));
  }

  // Min / avg / max of a numeric series, formatted as money (null if empty).
  function statsOf(values, currency) {
    if (!values || !values.length) {
      return null;
    }
    const min = Math.min(...values);
    const max = Math.max(...values);
    const avg = Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100;
    return { min: money(min, currency), avg: money(avg, currency), max: money(max, currency) };
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

  function dealTiming(insights) {
    const deal = insights && insights.dealScore;
    const pct = insights && insights.percentile;
    const cheaperThan = pct && pct.percentCheaperThan != null ? Math.round(pct.percentCheaperThan) : null;

    if (deal && deal.isAllTimeLow) {
      return { tone: 'good', icon: '★', text: 'All-time low — great time to buy' };
    }
    if (deal && deal.verdict) {
      const good = /good|buy|low|great|decent/i.test(deal.verdict);
      const text = cheaperThan != null
        ? `${deal.verdict} — cheaper than ${cheaperThan}% of the year`
        : deal.verdict;
      return { tone: good ? 'good' : 'warn', icon: good ? '✓' : '⌾', text };
    }
    if (cheaperThan != null) {
      const good = cheaperThan >= 50;
      return {
        tone: good ? 'good' : 'warn',
        icon: good ? '✓' : '⌾',
        text: `Cheaper than ${cheaperThan}% of the year`,
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
          priceLabel: money(entry.price, entry.currency),
          trend: entry.trend,
          availability: entry.availability,
          isHere: !!entry.url && normalizeUrl(entry.url) === target,
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
    const hereStats = statsOf(hereValues.length ? hereValues : (here && here.price != null ? [here.price] : []), here && here.currency);
    const hereSpark = sparklinePath(hereValues);

    // All-stores min / avg / max from the materialized insights stats block.
    const allStats = stats
      ? { min: money(stats.lowest, best && best.currency), avg: money(stats.average, best && best.currency), max: money(stats.highest, best && best.currency) }
      : null;

    // Verdict card — buy here vs switch to a cheaper store.
    const cur = best && best.currency;
    const pct = insights && insights.percentile && insights.percentile.percentCheaperThan != null
      ? Math.round(insights.percentile.percentCheaperThan)
      : null;
    const cheaperElsewhere = !!(here && best && here !== best && here.price != null && best.price != null && best.price < here.price);
    let verdict;
    if (cheaperElsewhere) {
      const dealPhrase = insights && insights.dealScore && insights.dealScore.verdict ? insights.dealScore.verdict : 'Decent price';
      verdict = {
        mode: 'switch',
        icon: '→',
        headline: `Cheaper at ${best.store}`,
        detail: `${dealPhrase} on ${here.store}, but you'll save ${money(saving, cur, 0)} buying from ${best.store}.`,
        cta: best.url ? { label: `Open ${best.store} · ${money(best.price, cur, 0)}`, url: best.url } : null,
      };
    } else if (here || best) {
      const focus = here || best;
      const allTimeLow = insights && insights.dealScore && insights.dealScore.isAllTimeLow;
      verdict = {
        mode: 'buy',
        icon: '✓',
        headline: allTimeLow ? 'All-time low — buy now' : 'Good time to buy here',
        detail: `${focus.store} has the best price right now${pct != null ? ` — cheaper than ${pct}% of the year.` : '.'}`,
        cta: null,
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
      priceLabel: extraction && extraction.price != null ? money(extraction.price, extraction.currency) : null,
      storeCount: stores.length,
      storeFound: stores.length > 0,
    };
  }

  const api = {
    themeVars, THEMES,
    normalizeUrl, bareDomain,
    sparklinePath, trendDirection,
    money, trackedFor, dealTiming,
    buildInsights, buildTrack,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.PBView = api;
  }
})(typeof self !== 'undefined' ? self : this);
