// PriceBuddy Companion — in-page helper panel + element picker.
//
// Lives as a content script so picking an element (clicking the page) never
// dismisses the UI the way a toolbar popup would. The panel is rendered into a
// shadow root to stay isolated from the host page's styles.
//
// UI is organised into three tabs (design: "PriceBuddy Extension.dc.html"):
//   • Track    — track this page; shows the detected price + how many stores match.
//   • Insights — for a tracked product: here-vs-best comparison, price history,
//                deal timing and per-store prices (HERE / BEST badges).
//   • Tune     — the scrape-strategy workbench: auto-detect or hand-tune the
//                title/price/image selectors with a live "pick on page" picker.
//
// Pure data transforms live in viewmodels.js (loaded first) as `window.PBView`.

(() => {
  // Guard against double injection (registered content script + on-demand inject).
  if (window.__priceBuddyCompanionLoaded) {
    return;
  }
  window.__priceBuddyCompanionLoaded = true;

  const V = window.PBView;

  const FIELDS = [
    { key: 'title', label: 'Title' },
    { key: 'price', label: 'Price' },
    { key: 'image', label: 'Image' },
  ];

  const STRATEGY_TYPES = [
    { value: 'schema_org', label: 'Schema.org' },
    { value: 'selector', label: 'CSS' },
    { value: 'xpath', label: 'XPath' },
    { value: 'regex', label: 'Regex' },
    { value: 'json', label: 'JSON path' },
  ];

  const THEME_KEY = 'pricebuddy.theme';

  let host = null; // shadow host element
  let root = null; // shadow root
  let picking = null; // field key currently being picked, or null
  let hoverEl = null;

  let currentState = null;
  let currentStoreId = null;          // set when editing an existing store
  let currentStoreSettings = { scraper_service: 'http' }; // preserved on update
  let apiBase = '';                   // PriceBuddy base URL, for building product links

  let theme = 'dark';
  let activeTab = 'track';
  let tuneMode = 'auto';              // Tune sub-tab: 'auto' | 'manual'

  // Cached async data so switching tabs doesn't re-hit the API.
  let detected = null;               // last auto meta-extraction result
  let insightsVM = null;             // built Insights view-model (null = not tracked)
  let trackVM = null;                // Track view-model
  let loaded = { track: false, insights: false, tune: false };

  // ---------------------------------------------------------------------------
  // CSS selector generation
  // ---------------------------------------------------------------------------

  const DYNAMIC_CLASS = /(^|[-_])(\d|active|selected|hover|focus|open|show|hidden|ng-|css-|sc-|jsx-)/i;

  function isUnique(selector) {
    try {
      return document.querySelectorAll(selector).length === 1;
    } catch {
      return false;
    }
  }

  function stableClasses(elm) {
    return Array.from(elm.classList)
      .filter((c) => !DYNAMIC_CLASS.test(c) && c.length > 1 && c.length < 40)
      .slice(0, 2);
  }

  function partFor(elm) {
    const tag = elm.tagName.toLowerCase();

    // Prefer meaningful attributes for a readable, resilient selector.
    for (const attr of ['itemprop', 'data-testid', 'data-test', 'name']) {
      const val = elm.getAttribute(attr);
      if (val) {
        const cand = `${tag}[${attr}="${val}"]`;
        if (isUnique(cand)) {
          return { part: cand, unique: true };
        }
      }
    }

    let part = tag;
    const classes = stableClasses(elm);
    if (classes.length) {
      part += '.' + classes.map((c) => CSS.escape(c)).join('.');
    }

    // Disambiguate among siblings of the same resulting shape.
    const parent = elm.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter((c) => c.tagName === elm.tagName);
      if (siblings.length > 1) {
        part += `:nth-of-type(${siblings.indexOf(elm) + 1})`;
      }
    }
    return { part, unique: isUnique(part) };
  }

  function cssSelector(elm) {
    if (!(elm instanceof Element)) {
      return '';
    }
    if (elm.id && isUnique(`#${CSS.escape(elm.id)}`)) {
      return `#${CSS.escape(elm.id)}`;
    }

    const parts = [];
    let current = elm;
    let depth = 0;
    while (current && current.nodeType === 1 && depth < 6) {
      const { part, unique } = partFor(current);
      parts.unshift(part);
      const selector = parts.join(' > ');
      if (isUnique(selector)) {
        return selector;
      }
      if (unique) {
        return part;
      }
      current = current.parentElement;
      depth += 1;
    }
    return parts.join(' > ');
  }

  // For price/image, the value often lives in an attribute rather than text.
  function suggestValueSelector(elm, field) {
    const selector = cssSelector(elm);
    const text = (elm.textContent || '').trim();
    if (field === 'image' && elm.tagName === 'IMG') {
      return `${selector}|src`;
    }
    if (!text) {
      if (elm.hasAttribute('content')) {
        return `${selector}|content`;
      }
      if (elm.hasAttribute('value')) {
        return `${selector}|value`;
      }
    }
    return selector;
  }

  // ---------------------------------------------------------------------------
  // State (persisted per-origin so a draft survives reloads / re-picks)
  // ---------------------------------------------------------------------------

  function stateKey() {
    return `pb:draft:${location.host}`;
  }

  function defaultState() {
    return {
      storeName: document.title ? document.title.split(/[|\-–—:]/)[0].trim().slice(0, 60) : location.host,
      strategy: {
        title: { type: 'schema_org', value: '' },
        price: { type: 'schema_org', value: '' },
        image: { type: 'schema_org', value: '' },
      },
    };
  }

  async function loadState() {
    const stored = await chrome.storage.local.get(stateKey());
    return stored[stateKey()] || defaultState();
  }

  async function saveState(state) {
    await chrome.storage.local.set({ [stateKey()]: state });
  }

  // ---------------------------------------------------------------------------
  // Messaging helper
  // ---------------------------------------------------------------------------

  function send(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(response);
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Build the store payload PriceBuddy expects
  // ---------------------------------------------------------------------------

  function buildStorePayload(state) {
    const strategy = {};
    for (const { key } of FIELDS) {
      const s = state.strategy[key] || { type: 'schema_org', value: '' };
      if (s.type === 'schema_org') {
        strategy[key] = { type: 'schema_org' };
      } else {
        strategy[key] = { type: s.type, value: (s.value || '').trim() };
      }
    }
    return {
      name: state.storeName || location.host,
      domains: [{ domain: location.host }],
      settings: currentStoreSettings,
      scrape_strategy: strategy,
    };
  }

  // ---------------------------------------------------------------------------
  // Element picker
  // ---------------------------------------------------------------------------

  function startPicking(field) {
    picking = field;
    document.body.style.cursor = 'crosshair';
    setStatus(`Click the ${field} element on the page… (Esc to cancel)`);
    setHidden(true); // hide the panel so it doesn't block clicks
    document.addEventListener('mousemove', onHover, true);
    document.addEventListener('click', onPick, true);
    document.addEventListener('keydown', onPickKey, true);
  }

  function stopPicking() {
    if (hoverEl) {
      hoverEl.style.outline = hoverEl.__pbPrevOutline || '';
      hoverEl = null;
    }
    document.body.style.cursor = '';
    document.removeEventListener('mousemove', onHover, true);
    document.removeEventListener('click', onPick, true);
    document.removeEventListener('keydown', onPickKey, true);
    picking = null;
    setHidden(false);
  }

  function onHover(e) {
    const elm = e.target;
    if (elm === hoverEl || (host && (elm === host || host.contains(elm)))) {
      return;
    }
    if (hoverEl) {
      hoverEl.style.outline = hoverEl.__pbPrevOutline || '';
    }
    hoverEl = elm;
    hoverEl.__pbPrevOutline = hoverEl.style.outline;
    hoverEl.style.outline = '2px solid #14b8a6';
  }

  function onPickKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      stopPicking();
      setStatus('Pick cancelled.');
    }
  }

  async function onPick(e) {
    if (host && (e.target === host || host.contains(e.target))) {
      return; // clicks inside the panel
    }
    e.preventDefault();
    e.stopPropagation();
    const field = picking;
    const elm = e.target;
    const value = suggestValueSelector(elm, field);
    stopPicking();

    const state = await loadState();
    state.strategy[field] = { type: 'selector', value };
    await saveState(state);
    currentState = state;
    tuneMode = 'manual';
    renderContent();
    setStatus(`Picked ${field}: ${value}`, 'success');
  }

  // ---------------------------------------------------------------------------
  // Theme
  // ---------------------------------------------------------------------------

  function systemTheme() {
    try {
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    } catch {
      return 'dark';
    }
  }

  async function resolveTheme() {
    const stored = await chrome.storage.sync.get(THEME_KEY);
    const pref = stored[THEME_KEY];
    return pref === 'light' || pref === 'dark' ? pref : systemTheme();
  }

  function applyTheme() {
    const panel = root && root.querySelector('.pb-panel');
    if (!panel) {
      return;
    }
    const vars = V.themeVars(theme);
    for (const [k, val] of Object.entries(vars)) {
      panel.style.setProperty(k, val);
    }
  }

  async function toggleTheme() {
    theme = theme === 'dark' ? 'light' : 'dark';
    await chrome.storage.sync.set({ [THEME_KEY]: theme });
    applyTheme();
    const btn = root.getElementById('pb-theme');
    if (btn) {
      btn.textContent = theme === 'dark' ? '☀' : '☾';
    }
  }

  // ---------------------------------------------------------------------------
  // Tiny DOM helpers
  // ---------------------------------------------------------------------------

  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    const { dataset, ...rest } = props;
    Object.assign(node, rest);
    for (const [k, v] of Object.entries(dataset || {})) {
      node.dataset[k] = v;
    }
    for (const child of [].concat(children)) {
      if (child != null) {
        node.append(child);
      }
    }
    return node;
  }

  function setHidden(hidden) {
    if (host) {
      host.style.display = hidden ? 'none' : 'block';
    }
  }

  function setStatus(text, kind = 'info') {
    const status = root && root.getElementById('pb-status');
    if (status) {
      status.textContent = text || '';
      status.className = `pb-status pb-${kind}`;
    }
  }

  function thumb(image, size) {
    if (image) {
      return el('div', { className: `pb-thumb pb-thumb-${size}` }, [
        el('img', { className: 'pb-thumb-img', src: image, alt: '', referrerPolicy: 'no-referrer' }),
      ]);
    }
    return el('div', { className: `pb-thumb pb-thumb-${size} pb-thumb-empty` }, [
      el('span', { className: 'pb-thumb-label', textContent: 'IMG' }),
    ]);
  }

  // ---------------------------------------------------------------------------
  // Data loaders
  // ---------------------------------------------------------------------------

  // Ask PriceBuddy to extract (auto-detecting / matching a store) for this page.
  async function ensureDetected() {
    if (detected) {
      return detected;
    }
    const res = await send({ type: 'pb:meta-extraction', url: location.href });
    detected = res.ok ? res.data : { error: res.error, status: res.status };
    return detected;
  }

  // Find how many stores already match this domain (for the Track "N stores" pill).
  async function lookupStores() {
    const wanted = V.bareDomain(location.host);
    const res = await send({ type: 'pb:get-store', domain: wanted });
    if (!res.ok) {
      return [];
    }
    const stores = (res.data && res.data.data) || [];
    return stores.filter((s) => (s.domains || []).some((d) => V.bareDomain(d && d.domain) === wanted));
  }

  // Locate the tracked product for this page and build the Insights view-model.
  async function loadInsights() {
    const res = await send({ type: 'pb:list-products', params: { per_page: 100 } });
    if (!res.ok) {
      return { error: res.error, status: res.status };
    }
    const products = (res.data && res.data.data) || [];
    const target = V.normalizeUrl(location.href);
    let matchId = null;
    outer: for (const product of products) {
      for (const entry of product.price_cache || []) {
        if (entry.url && V.normalizeUrl(entry.url) === target) {
          matchId = product.id;
          break outer;
        }
      }
    }
    if (!matchId) {
      return null; // not tracked
    }
    // Pull the full detail with the materialized insights block.
    const detail = await send({ type: 'pb:get-product', id: matchId, params: { include: 'insights' } });
    if (!detail.ok) {
      return { error: detail.error, status: detail.status };
    }
    const product = (detail.data && detail.data.data) || detail.data;
    return V.buildInsights(product, product.insights || null, location.href);
  }

  // ---------------------------------------------------------------------------
  // Shell: header + tab bar + content container
  // ---------------------------------------------------------------------------

  function segBtn(id, label, tab) {
    const btn = el('button', {
      id,
      className: `pb-tab ${activeTab === tab ? 'pb-tab-on' : ''}`,
      textContent: label,
    });
    btn.addEventListener('click', () => setTab(tab));
    return btn;
  }

  function setTab(tab) {
    activeTab = tab;
    for (const t of ['track', 'insights', 'tune']) {
      const b = root.getElementById(`pb-tab-${t}`);
      if (b) {
        b.classList.toggle('pb-tab-on', t === tab);
      }
    }
    renderContent();
  }

  function renderContent() {
    const box = root.getElementById('pb-content');
    if (!box) {
      return;
    }
    box.innerHTML = '';
    box.append(el('div', { id: 'pb-status', className: 'pb-status pb-info' }));
    if (activeTab === 'track') {
      renderTrack(box);
    } else if (activeTab === 'insights') {
      renderInsights(box);
    } else {
      renderTune(box);
    }
  }

  // ---------------------------------------------------------------------------
  // Track tab
  // ---------------------------------------------------------------------------

  async function renderTrack(box) {
    if (!loaded.track) {
      box.append(el('div', { className: 'pb-loading', textContent: 'Reading this page…' }));
      const [ext, stores] = await Promise.all([ensureDetected(), lookupStores()]);
      trackVM = V.buildTrack(ext && !ext.error ? ext : null, stores, location.host);
      loaded.track = true;
      if (activeTab === 'track') {
        renderContent();
      }
      return;
    }

    const vm = trackVM || V.buildTrack(null, [], location.host);

    // Product identity row.
    const idRow = el('div', { className: 'pb-track-id' }, [
      thumb(vm.image, 'lg'),
      el('div', { className: 'pb-track-meta' }, [
        el('div', { className: 'pb-track-title', textContent: vm.title || document.title || location.host }),
        el('div', { className: 'pb-domain' }, [
          el('span', { className: 'pb-domain-dot' }),
          el('span', { className: 'pb-domain-text', textContent: vm.domain }),
        ]),
      ]),
    ]);
    box.append(idRow);

    // Detected price card.
    const priceCard = el('div', { className: 'pb-detect-card' }, [
      el('div', {}, [
        el('div', { className: 'pb-detect-price', textContent: vm.priceLabel || 'No price found' }),
        el('div', { className: 'pb-detect-sub', textContent: vm.priceLabel ? 'detected on this page' : 'tune selectors to detect a price' }),
      ]),
      el('span', { className: 'pb-spacer' }),
      el('span', { className: `pb-pill ${vm.storeFound ? 'pb-pill-good' : 'pb-pill-neutral'}` }, [
        el('span', { className: 'pb-pill-icon', textContent: vm.storeFound ? '⌕' : '+' }),
        el('span', {
          textContent: vm.storeFound
            ? `${vm.storeCount} store${vm.storeCount === 1 ? '' : 's'} found`
            : 'new store',
        }),
      ]),
    ]);
    box.append(priceCard);

    // Actions.
    const alreadyTracked = !!insightsVM && !insightsVM.error;
    const trackBtn = el('button', {
      className: 'pb-btn pb-btn-primary pb-btn-block',
    }, [el('span', { className: 'pb-btn-icon', textContent: '+' }), document.createTextNode(' Track this product')]);
    trackBtn.addEventListener('click', onTrack);

    const secondary = el('div', { className: 'pb-row2' }, [
      buttonTo('Add another store', () => { tuneMode = 'manual'; setTab('tune'); }),
      buttonTo('Scrape settings', () => setTab('tune')),
    ]);

    box.append(el('div', { className: 'pb-track-actions' }, [trackBtn, secondary]));

    if (alreadyTracked) {
      const note = el('button', { className: 'pb-inline-note' }, [
        document.createTextNode('Already tracking this product — '),
        el('span', { className: 'pb-link-text', textContent: 'see Insights →' }),
      ]);
      note.addEventListener('click', () => setTab('insights'));
      box.append(note);
    }
  }

  function buttonTo(label, onClick) {
    const b = el('button', { className: 'pb-btn pb-btn-soft', textContent: label });
    b.addEventListener('click', onClick);
    return b;
  }

  async function onTrack() {
    setStatus('Adding to PriceBuddy…', 'info');
    const ext = await ensureDetected();
    const title = (ext && !ext.error && ext.title) || document.title || location.host;
    const payload = { title, url: location.href };
    if (ext && !ext.error && ext.image) {
      payload.image = ext.image;
    }
    const res = await send({ type: 'pb:create-product', payload });
    if (!res.ok) {
      setStatus(res.status === 403
        ? 'Token lacks product access. Create an "all access" token to track products.'
        : `Error: ${res.error}`, 'error');
      return;
    }
    const product = res.data && res.data.data ? res.data.data : res.data;
    setStatus(`Tracking "${product.title || title}" (product #${product.id}).`, 'success');
    // Refresh insights so the Insights tab reflects the new product.
    loaded.insights = false;
    insightsVM = await loadInsights();
    loaded.insights = true;
    setTab('insights');
  }

  // ---------------------------------------------------------------------------
  // Insights tab
  // ---------------------------------------------------------------------------

  async function renderInsights(box) {
    if (!loaded.insights) {
      box.append(el('div', { className: 'pb-loading', textContent: 'Loading insights…' }));
      insightsVM = await loadInsights();
      loaded.insights = true;
      if (activeTab === 'insights') {
        renderContent();
      }
      return;
    }

    if (insightsVM && insightsVM.error) {
      const msg = insightsVM.status === 403
        ? 'Token lacks product access. Use an "all access" token to see insights.'
        : `Couldn't load insights: ${insightsVM.error}`;
      box.append(emptyState('⚠', 'Insights unavailable', msg));
      return;
    }

    if (!insightsVM) {
      const empty = emptyState('☆', 'Not tracked yet', "This page isn't tracked in PriceBuddy. Track it to unlock price history and store comparison.");
      const cta = el('button', { className: 'pb-btn pb-btn-primary pb-btn-block', textContent: 'Go to Track' });
      cta.addEventListener('click', () => setTab('track'));
      empty.append(cta);
      box.append(empty);
      return;
    }

    const vm = insightsVM;

    // Product row.
    box.append(el('div', { className: 'pb-ins-id' }, [
      thumb(vm.image, 'sm'),
      el('div', { className: 'pb-ins-meta' }, [
        el('div', { className: 'pb-ins-title', textContent: vm.title }),
        el('div', {
          className: 'pb-ins-sub',
          textContent: [`${vm.storeCount} store${vm.storeCount === 1 ? '' : 's'}`, vm.trackedFor].filter(Boolean).join(' · '),
        }),
      ]),
    ]));

    // Verdict card — buy here vs switch to a cheaper store.
    if (vm.verdict) {
      const card = el('div', { className: `pb-verdict pb-verdict-${vm.verdict.mode}` });
      card.append(el('div', { className: 'pb-verdict-head' }, [
        el('span', { className: 'pb-verdict-icon', textContent: vm.verdict.icon }),
        el('span', { className: 'pb-verdict-headline', textContent: vm.verdict.headline }),
      ]));
      card.append(el('div', { className: 'pb-verdict-detail', textContent: vm.verdict.detail }));
      if (vm.verdict.cta) {
        const cta = el('button', { className: 'pb-verdict-cta', textContent: vm.verdict.cta.label });
        cta.addEventListener('click', () => window.open(vm.verdict.cta.url, '_blank'));
        card.append(cta);
      }
      box.append(card);
    }

    // "You're here" card — current store price, its own history + stats.
    if (vm.here) {
      const hereCard = el('div', { className: 'pb-here-card' });
      hereCard.append(el('div', { className: 'pb-here-head' }, [
        el('span', { className: 'pb-here-dot' }),
        el('span', { className: 'pb-here-label', textContent: "YOU'RE HERE" }),
        el('span', { className: 'pb-spacer' }),
        el('span', { className: 'pb-here-store', textContent: vm.here.store }),
      ]));
      hereCard.append(el('div', { className: 'pb-here-priceline' }, [
        el('span', { className: 'pb-here-price', textContent: vm.here.priceLabel }),
        el('span', { className: 'pb-here-sub', textContent: 'current price' }),
      ]));
      if (vm.hereSpark) {
        hereCard.append(sparkSvg(vm.hereSpark, 'var(--muted)'));
      }
      if (vm.hereStats) {
        hereCard.append(el('div', { className: 'pb-here-stats' }, [
          chip('Min', vm.hereStats.min),
          chip('Avg', vm.hereStats.avg),
          chip('Max', vm.hereStats.max),
        ]));
      }
      box.append(hereCard);
    }

    // Other stores (the current store lives in its own card above).
    const others = vm.rows.filter((r) => !r.isHere);
    if (others.length) {
      const list = el('div', { className: 'pb-stores' });
      for (const r of others) {
        const row = el('div', { className: 'pb-store-row' }, [
          el('span', { className: 'pb-store-dir', textContent: r.dirGlyph, style: `color:${r.dirColor}` }),
          el('span', { className: `pb-store-price ${r.isBest ? 'pb-best-text' : ''}`, textContent: r.priceLabel }),
          el('span', { className: `pb-store-name ${r.isBest ? 'pb-best-text' : ''}`, textContent: `@${r.store}` }),
          el('span', { className: 'pb-spacer' }),
          r.isBest ? el('span', { className: 'pb-badge pb-badge-best', textContent: 'BEST' }) : null,
        ]);
        if (r.url) {
          row.classList.add('pb-store-link');
          row.addEventListener('click', () => window.open(r.url, '_blank'));
        }
        list.append(row);
      }
      box.append(list);
    }

    // All-stores min / avg / max.
    if (vm.allStats) {
      box.append(el('div', { className: 'pb-allstats' }, [
        allStat('All min', vm.allStats.min),
        allStat('All avg', vm.allStats.avg),
        allStat('All max', vm.allStats.max),
      ]));
    }

    if (apiBase && vm.productId) {
      const link = el('a', {
        className: 'pb-open-link',
        textContent: 'Open in PriceBuddy →',
        href: `${apiBase}/admin/products/${vm.productId}`,
        target: '_blank',
      });
      box.append(link);
    }
  }

  function sparkSvg(spark, color) {
    const stroke = color || 'var(--amber)';
    const svgns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgns, 'svg');
    svg.setAttribute('viewBox', '0 0 100 30');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('class', 'pb-spark');
    const area = document.createElementNS(svgns, 'path');
    area.setAttribute('d', spark.area);
    area.setAttribute('fill', stroke);
    area.setAttribute('opacity', '.07');
    const line = document.createElementNS(svgns, 'path');
    line.setAttribute('d', spark.stroke);
    line.setAttribute('fill', 'none');
    line.setAttribute('stroke', stroke);
    line.setAttribute('stroke-width', '1.4');
    line.setAttribute('stroke-linejoin', 'round');
    line.setAttribute('stroke-linecap', 'round');
    line.setAttribute('opacity', '.85');
    line.setAttribute('vector-effect', 'non-scaling-stroke');
    svg.append(area, line);
    return el('div', { className: 'pb-spark-wrap' }, [svg]);
  }

  function chip(label, value) {
    return el('div', { className: 'pb-chip' }, [
      el('div', { className: 'pb-chip-label', textContent: label }),
      el('div', { className: 'pb-chip-value', textContent: value }),
    ]);
  }

  function allStat(label, value) {
    return el('div', { className: 'pb-allstat' }, [
      el('div', { className: 'pb-allstat-label', textContent: label }),
      el('div', { className: 'pb-allstat-value', textContent: value }),
    ]);
  }

  function emptyState(icon, title, text) {
    return el('div', { className: 'pb-empty' }, [
      el('div', { className: 'pb-empty-icon', textContent: icon }),
      el('div', { className: 'pb-empty-title', textContent: title }),
      el('div', { className: 'pb-empty-text', textContent: text }),
    ]);
  }

  // ---------------------------------------------------------------------------
  // Tune tab
  // ---------------------------------------------------------------------------

  async function renderTune(box) {
    if (!loaded.tune) {
      box.append(el('div', { className: 'pb-loading', textContent: 'Checking store…' }));
      currentState = await loadState();
      await prepareStoreForTune(currentState);
      await ensureDetected();
      loaded.tune = true;
      if (activeTab === 'tune') {
        renderContent();
      }
      return;
    }

    const state = currentState || (await loadState());

    // Header: title + domain pill.
    box.append(el('div', { className: 'pb-tune-head' }, [
      el('span', { className: 'pb-tune-title', textContent: 'Scrape strategy' }),
      el('span', { className: 'pb-spacer' }),
      el('span', { className: 'pb-pill pb-pill-neutral' }, [
        el('span', { className: 'pb-domain-dot' }),
        el('span', { className: 'pb-mono', textContent: V.bareDomain(location.host) }),
      ]),
    ]));

    // Sub-tabs.
    const sub = el('div', { className: 'pb-subtabs' });
    sub.append(subTab('Auto-detect', 'auto'), subTab('Manual override', 'manual'));
    box.append(sub);

    if (tuneMode === 'auto') {
      renderTuneAuto(box, state);
    } else {
      renderTuneManual(box, state);
    }

    // Footer actions.
    const footer = el('div', { className: 'pb-tune-foot' });
    const saveBtn = el('button', {
      id: 'pb-save-btn',
      className: 'pb-btn pb-btn-primary pb-btn-grow',
      textContent: currentStoreId ? `Update ${state.storeName || 'store'}` : `Save to ${state.storeName || 'store'}`,
    });
    saveBtn.addEventListener('click', onSaveStore);
    const testBtn = el('button', { className: 'pb-btn pb-btn-soft', textContent: 'Test all' });
    testBtn.addEventListener('click', onTestAll);
    footer.append(saveBtn, testBtn);
    box.append(footer);
  }

  function subTab(label, mode) {
    const b = el('button', { className: `pb-subtab ${tuneMode === mode ? 'pb-subtab-on' : ''}`, textContent: label });
    b.addEventListener('click', () => { tuneMode = mode; renderContent(); });
    return b;
  }

  // Confidence heuristic for a detected field: schema/meta auto = high, else med.
  function detectedField(key, state) {
    const value = detected && !detected.error ? detected[key] : null;
    const strat = detected && !detected.error && detected.store && detected.store.scrape_settings ? detected.store.scrape_settings[key] : null;
    const type = (strat && strat.type) || (state.strategy[key] && state.strategy[key].type) || 'schema_org';
    const label = (STRATEGY_TYPES.find((t) => t.value === type) || { label: type }).label;
    const has = value !== null && value !== undefined && value !== '';
    return {
      value: has ? String(value) : 'not found',
      src: label,
      conf: !has ? 'low' : (type === 'schema_org' ? 'high' : 'med'),
      has,
    };
  }

  function renderTuneAuto(box, state) {
    const wrap = el('div', { className: 'pb-tune-body' });
    const found = FIELDS.filter(({ key }) => detectedField(key, state).has).length;
    wrap.append(el('div', { className: `pb-callout ${found === FIELDS.length ? 'pb-callout-good' : 'pb-callout-warn'}` }, [
      el('span', { className: 'pb-callout-icon', textContent: found === FIELDS.length ? '✓' : '⌾' }),
      el('span', { className: 'pb-callout-text', textContent: `${found} of ${FIELDS.length} fields detected automatically` }),
    ]));

    for (const { key, label } of FIELDS) {
      const d = detectedField(key, state);
      const confColor = d.conf === 'high' ? 'var(--teal)' : (d.conf === 'med' ? 'var(--amber)' : 'var(--red)');
      const confLabel = d.conf === 'high' ? 'high confidence' : (d.conf === 'med' ? 'medium' : 'not found');
      const editBtn = el('button', { className: 'pb-edit-btn', textContent: 'Edit' });
      editBtn.addEventListener('click', () => { tuneMode = 'manual'; renderContent(); });
      wrap.append(el('div', { className: 'pb-auto-field' }, [
        el('span', { className: 'pb-field-tag', textContent: label }),
        el('div', { className: 'pb-auto-meta' }, [
          el('div', { className: `pb-auto-value ${d.has ? '' : 'pb-miss'}`, textContent: d.value }),
          el('div', { className: 'pb-auto-src' }, [
            el('span', { className: 'pb-mono', textContent: d.src }),
            el('span', { className: 'pb-dot-sep' }),
            el('span', { className: 'pb-conf' }, [
              el('span', { className: 'pb-conf-dot', style: `background:${confColor}` }),
              el('span', { className: 'pb-mono', textContent: confLabel }),
            ]),
          ]),
        ]),
        editBtn,
      ]));
    }
    box.append(wrap);
  }

  function renderTuneManual(box, state) {
    const wrap = el('div', { className: 'pb-tune-body' });
    for (const { key, label } of FIELDS) {
      const s = state.strategy[key] || { type: 'schema_org', value: '' };
      const card = el('div', { className: 'pb-manual-field' });

      const headRow = el('div', { className: 'pb-manual-head' }, [
        el('span', { className: 'pb-field-tag', textContent: label }),
        el('span', { className: 'pb-spacer' }),
      ]);
      const pickBtn = el('button', {
        className: `pb-pick-btn ${picking === key ? 'pb-pick-on' : ''}`,
        textContent: '◎ Pick on page',
      });
      pickBtn.addEventListener('click', () => startPicking(key));
      headRow.append(pickBtn);
      card.append(headRow);

      const controls = el('div', { className: 'pb-manual-controls' });
      const typeWrap = el('div', { className: 'pb-select-wrap' });
      const typeSel = el('select', { className: 'pb-select' });
      for (const t of STRATEGY_TYPES) {
        const opt = el('option', { value: t.value, textContent: t.label });
        if (t.value === s.type) {
          opt.selected = true;
        }
        typeSel.append(opt);
      }
      typeWrap.append(typeSel, el('span', { className: 'pb-select-caret', textContent: '▾' }));

      const valInput = el('input', {
        type: 'text',
        className: 'pb-input pb-mono',
        value: s.value || '',
        placeholder: s.type === 'schema_org' ? 'no value needed' : 'selector or pattern',
        spellcheck: false,
      });
      valInput.disabled = s.type === 'schema_org';

      typeSel.addEventListener('change', async () => {
        s.type = typeSel.value;
        valInput.disabled = s.type === 'schema_org';
        valInput.placeholder = s.type === 'schema_org' ? 'no value needed' : 'selector or pattern';
        if (s.type === 'schema_org') {
          s.value = '';
          valInput.value = '';
        }
        state.strategy[key] = s;
        await saveState(state);
      });
      valInput.addEventListener('input', async () => {
        s.value = valInput.value;
        state.strategy[key] = s;
        await saveState(state);
      });

      controls.append(typeWrap, valInput);
      card.append(controls);

      // Live match preview (populated by Test all).
      card.append(el('div', { id: `pb-match-${key}`, className: 'pb-match pb-match-idle' }, [
        el('span', { className: 'pb-match-icon', textContent: '·' }),
        el('span', { className: 'pb-match-tag', textContent: 'not tested' }),
        el('span', { className: 'pb-match-text pb-mono', textContent: 'Run “Test all” to preview' }),
      ]));

      wrap.append(card);
    }
    box.append(wrap);
  }

  function setMatch(key, ok, value) {
    const row = root.getElementById(`pb-match-${key}`);
    if (!row) {
      return;
    }
    row.className = `pb-match ${ok ? 'pb-match-ok' : 'pb-match-bad'}`;
    row.innerHTML = '';
    row.append(
      el('span', { className: 'pb-match-icon', textContent: ok ? '✓' : '✕' }),
      el('span', { className: 'pb-match-tag', textContent: ok ? 'matched' : 'no match' }),
      el('span', { className: 'pb-match-text pb-mono', textContent: ok ? String(value) : 'refine your selector' }),
    );
  }

  async function onTestAll() {
    const state = currentState || (await loadState());
    setStatus('Testing selectors against the live page…', 'info');
    const res = await send({ type: 'pb:meta-extraction', url: location.href, store: buildStorePayload(state) });
    if (!res.ok) {
      setStatus(`Error: ${res.error}`, 'error');
      return;
    }
    detected = res.data;
    let hits = 0;
    for (const { key } of FIELDS) {
      const v = res.data[key];
      const ok = v !== null && v !== undefined && v !== '';
      if (ok) {
        hits += 1;
      }
      setMatch(key, ok, v);
    }
    setStatus(`${hits} of ${FIELDS.length} fields resolved.`, hits === FIELDS.length ? 'success' : 'info');
  }

  // Look up an existing store for this domain and fold its saved strategy into
  // the draft, so Tune opens in "update" mode when the store already exists.
  async function prepareStoreForTune(state) {
    const wanted = V.bareDomain(location.host);
    const res = await send({ type: 'pb:get-store', domain: wanted });
    let existing = null;
    if (res.ok) {
      const stores = (res.data && res.data.data) || [];
      existing = stores.find((s) => (s.domains || []).some((d) => V.bareDomain(d && d.domain) === wanted)) || null;
    }
    if (existing) {
      currentStoreId = existing.id;
      currentStoreSettings = existing.settings || { scraper_service: 'http' };
      if (existing.name) {
        state.storeName = existing.name;
      }
      const strat = existing.scrape_strategy || {};
      for (const { key } of FIELDS) {
        const d = strat[key];
        if (d && d.type) {
          state.strategy[key] = { type: d.type, value: d.value || '' };
        }
      }
      await saveState(state);
    } else {
      currentStoreId = null;
      currentStoreSettings = { scraper_service: 'http' };
    }
  }

  async function onSaveStore() {
    const state = currentState || (await loadState());
    const payload = buildStorePayload(state);

    if (currentStoreId) {
      setStatus('Updating store…', 'info');
      const res = await send({ type: 'pb:update-store', id: currentStoreId, payload });
      if (!res.ok) {
        setStatus(res.status === 403
          ? 'Token lacks store access. Create an "all access" token to manage stores.'
          : `Error: ${res.error}`, 'error');
        return;
      }
      setStatus(`Updated ${state.storeName || `store #${currentStoreId}`}.`, 'success');
      return;
    }

    setStatus('Adding store…', 'info');
    const res = await send({ type: 'pb:create-store', payload });
    if (!res.ok) {
      setStatus(res.status === 403
        ? 'Token lacks store access. Create an "all access" token to manage stores.'
        : `Error: ${res.error}`, 'error');
      return;
    }
    const store = (res.data && res.data.data) || res.data;
    currentStoreId = store && store.id ? store.id : null;
    if (currentStoreId) {
      currentStoreSettings = store.settings || currentStoreSettings;
      const btn = root.getElementById('pb-save-btn');
      if (btn) {
        btn.textContent = `Update ${state.storeName || 'store'}`;
      }
    }
    setStatus(`Store added${currentStoreId ? ` (#${currentStoreId})` : ''}.`, 'success');
  }

  // ---------------------------------------------------------------------------
  // Panel construction
  // ---------------------------------------------------------------------------

  async function buildPanel() {
    host = document.createElement('div');
    host.id = 'pricebuddy-companion-host';
    host.style.cssText = 'all: initial; position: fixed; top: 16px; right: 16px; z-index: 2147483647;';
    document.documentElement.append(host);
    root = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = PANEL_CSS;
    root.append(style);

    theme = await resolveTheme();

    const panel = el('div', { className: 'pb-panel' });

    // Header.
    const header = el('div', { className: 'pb-header' }, [
      el('span', { className: 'pb-logo-mark' }, [el('span', { className: 'pb-logo-dot' })]),
      el('span', { className: 'pb-logo-text' }, [document.createTextNode('Price'), el('span', { className: 'pb-logo-accent', textContent: 'Buddy' })]),
      el('span', { className: 'pb-spacer' }),
    ]);
    const themeBtn = el('button', { id: 'pb-theme', className: 'pb-icon-btn', textContent: theme === 'dark' ? '☀' : '☾', title: 'Toggle theme' });
    themeBtn.addEventListener('click', toggleTheme);
    const closeBtn = el('button', { className: 'pb-icon-btn pb-close', textContent: '×', title: 'Close' });
    closeBtn.addEventListener('click', () => setHidden(true));
    header.append(themeBtn, closeBtn);
    panel.append(header);

    const settings = await send({ type: 'pb:get-settings' });
    if (!settings.ok || !settings.data || !settings.data.apiUrl || !settings.data.token) {
      const setup = el('div', { className: 'pb-setup' }, [
        el('p', { className: 'pb-setup-text', textContent: 'Connect this extension to your PriceBuddy instance to get started.' }),
      ]);
      const btn = el('button', { className: 'pb-btn pb-btn-primary pb-btn-block', textContent: 'Open settings' });
      btn.addEventListener('click', () => send({ type: 'pb:open-options' }));
      setup.append(btn);
      panel.append(setup);
      root.append(panel);
      applyTheme();
      return;
    }

    apiBase = String(settings.data.apiUrl || '').replace(/\/+$/, '');

    // Tab bar.
    const tabs = el('div', { className: 'pb-tabs' });
    tabs.append(segBtn('pb-tab-track', 'Track', 'track'), segBtn('pb-tab-insights', 'Insights', 'insights'), segBtn('pb-tab-tune', 'Tune', 'tune'));
    panel.append(tabs);

    // Content container.
    panel.append(el('div', { id: 'pb-content', className: 'pb-content' }));

    root.append(panel);
    applyTheme();

    // Smart default tab: Insights when this page is already tracked, else Track.
    insightsVM = await loadInsights();
    loaded.insights = true;
    activeTab = insightsVM && !insightsVM.error ? 'insights' : 'track';
    for (const t of ['track', 'insights', 'tune']) {
      const b = root.getElementById(`pb-tab-${t}`);
      if (b) {
        b.classList.toggle('pb-tab-on', t === activeTab);
      }
    }
    renderContent();
  }

  async function toggle() {
    if (!host) {
      await buildPanel();
      return;
    }
    setHidden(host.style.display !== 'none' ? true : false);
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'pb:toggle-panel') {
      toggle();
    }
  });

  // ---------------------------------------------------------------------------
  // Styles — tokens (var(--x)) come from viewmodels THEMES, set on .pb-panel.
  // ---------------------------------------------------------------------------

  const PANEL_CSS = `
    @import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=DM+Mono:wght@400;500&display=swap');

    .pb-panel { --bg:#0d1117; width: 400px; max-width: calc(100vw - 32px); max-height: 88vh; overflow-y: auto;
      background: var(--bg); color: var(--text); border-radius: 18px; border: 1px solid var(--frame);
      box-shadow: 0 24px 60px -24px rgba(0,0,0,.55); font-family: Manrope, system-ui, sans-serif; box-sizing: border-box; }
    .pb-panel * { box-sizing: border-box; }
    .pb-mono { font-family: 'DM Mono', ui-monospace, Menlo, monospace; }
    .pb-spacer { flex: 1; }
    .pb-best-text { color: var(--teal) !important; }

    /* Header */
    .pb-header { display: flex; align-items: center; gap: 9px; padding: 12px 14px; border-bottom: 1px solid var(--line); }
    .pb-logo-mark { width: 22px; height: 22px; border-radius: 7px; background: var(--teal); position: relative; flex: none; }
    .pb-logo-dot { position: absolute; top: 6px; left: 6px; width: 4px; height: 4px; border-radius: 50%; background: var(--bg); }
    .pb-logo-text { font: 800 14px/1 Manrope, sans-serif; letter-spacing: -.01em; color: var(--text); }
    .pb-logo-accent { color: var(--teal); }
    .pb-icon-btn { width: 28px; height: 28px; border-radius: 8px; background: var(--chip); border: 1px solid var(--line);
      color: var(--muted); cursor: pointer; font-size: 13px; display: inline-flex; align-items: center; justify-content: center; }
    .pb-icon-btn:hover { color: var(--text); }
    .pb-close { background: transparent; border: none; color: var(--faint); font-size: 18px; }

    /* Tab bar */
    .pb-tabs { display: flex; gap: 4px; margin: 12px 14px 0; padding: 3px; background: var(--chip); border-radius: 11px; }
    .pb-tab { flex: 1; padding: 8px; border-radius: 8px; border: none; cursor: pointer; font: 700 12px/1 Manrope, sans-serif;
      background: transparent; color: var(--muted); }
    .pb-tab-on { background: var(--bg); color: var(--teal); box-shadow: 0 1px 3px rgba(0,0,0,.22); }

    .pb-content { padding-bottom: 4px; }
    .pb-loading { padding: 26px 16px; color: var(--faint); font: 500 12px/1.4 Manrope, sans-serif; text-align: center; }

    /* Status */
    .pb-status { font: 500 12px/1.4 Manrope, sans-serif; padding: 8px 14px; word-break: break-word; }
    .pb-status:empty { display: none; }
    .pb-info { color: var(--muted); }
    .pb-success { color: var(--teal); }
    .pb-error { color: var(--red); }

    /* Buttons */
    .pb-btn { border: none; cursor: pointer; border-radius: 11px; font: 700 12.5px/1 Manrope, sans-serif; padding: 11px 14px; color: var(--text); background: var(--chip); }
    .pb-btn-soft { background: var(--chip); border: 1px solid var(--line); color: var(--text); font-weight: 600; }
    .pb-btn-primary { background: var(--teal); color: var(--onTeal); }
    .pb-btn-block { width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 13px; border-radius: 12px; font-weight: 800; }
    .pb-btn-grow { flex: 1; }
    .pb-btn-icon { font-size: 15px; }

    /* Thumbnails */
    .pb-thumb { border-radius: 12px; overflow: hidden; border: 1px solid var(--line); flex: none; display: flex; align-items: center; justify-content: center; background: var(--input); }
    .pb-thumb-lg { width: 64px; height: 64px; }
    .pb-thumb-sm { width: 44px; height: 44px; border-radius: 11px; }
    .pb-thumb-img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .pb-thumb-empty { background: repeating-linear-gradient(135deg, var(--chip) 0 7px, var(--input) 7px 14px); }
    .pb-thumb-label { font: 600 8px/1 'DM Mono', monospace; color: var(--faint); letter-spacing: .05em; }

    /* Domain pill */
    .pb-domain { display: flex; align-items: center; gap: 6px; margin-top: 5px; }
    .pb-domain-dot { width: 6px; height: 6px; border-radius: 2px; background: var(--teal); }
    .pb-domain-text { font: 500 11px/1 'DM Mono', monospace; color: var(--muted); }
    .pb-pill { display: inline-flex; align-items: center; gap: 6px; padding: 5px 10px; border-radius: 999px; font: 600 11px/1 Manrope, sans-serif; }
    .pb-pill-good { background: var(--tealdim); border: 1px solid var(--goodln); color: var(--teal); }
    .pb-pill-neutral { background: var(--chip); border: 1px solid var(--line); color: var(--muted); }
    .pb-pill-icon { font-size: 11px; }

    /* Track tab */
    .pb-track-id { display: flex; gap: 12px; padding: 14px 16px 4px; }
    .pb-track-meta { flex: 1; min-width: 0; }
    .pb-track-title { font: 700 13.5px/1.35 Manrope, sans-serif; color: var(--text); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .pb-detect-card { margin: 12px 16px 0; padding: 12px 14px; border-radius: 14px; background: var(--card); border: 1px solid var(--line); display: flex; align-items: center; gap: 12px; }
    .pb-detect-price { font: 800 22px/1 Manrope, sans-serif; letter-spacing: -.02em; color: var(--text); }
    .pb-detect-sub { font: 500 10.5px/1 Manrope, sans-serif; color: var(--faint); margin-top: 5px; }
    .pb-track-actions { padding: 14px 16px 6px; display: flex; flex-direction: column; gap: 8px; }
    .pb-row2 { display: flex; gap: 8px; }
    .pb-row2 .pb-btn { flex: 1; padding: 10px; }
    .pb-inline-note { margin: 2px 16px 12px; background: none; border: none; color: var(--muted); font: 500 11.5px/1.4 Manrope, sans-serif; cursor: pointer; text-align: left; padding: 0; }
    .pb-link-text { color: var(--teal); font-weight: 700; }

    /* Insights tab */
    .pb-ins-id { display: flex; gap: 11px; padding: 14px 16px 10px; align-items: center; }
    .pb-ins-meta { flex: 1; min-width: 0; }
    .pb-ins-title { font: 700 12.5px/1.3 Manrope, sans-serif; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .pb-ins-sub { font: 500 10.5px/1 Manrope, sans-serif; color: var(--faint); margin-top: 4px; }

    /* Verdict card */
    .pb-verdict { margin: 0 16px 12px; padding: 12px 13px; border-radius: 14px; background: var(--tealdim); border: 1px solid var(--goodln); }
    .pb-verdict-head { display: flex; align-items: center; gap: 9px; }
    .pb-verdict-icon { flex: none; width: 26px; height: 26px; border-radius: 8px; background: var(--teal); color: var(--onTeal); display: flex; align-items: center; justify-content: center; font: 800 14px/1 Manrope, sans-serif; }
    .pb-verdict-headline { font: 800 14.5px/1.15 Manrope, sans-serif; letter-spacing: -.01em; color: var(--text); }
    .pb-verdict-detail { font: 500 11.5px/1.45 Manrope, sans-serif; color: var(--muted); margin-top: 8px; }
    .pb-verdict-cta { width: 100%; margin-top: 11px; padding: 10px; border-radius: 10px; background: var(--teal); border: none; color: var(--onTeal); font: 700 12.5px/1 Manrope, sans-serif; cursor: pointer; }

    /* "You're here" card */
    .pb-here-card { margin: 0 16px 12px; padding: 12px 13px; border-radius: 14px; background: var(--card); border: 1px solid var(--line); }
    .pb-here-head { display: flex; align-items: center; gap: 8px; }
    .pb-here-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--muted); }
    .pb-here-label { font: 700 9px/1 Manrope, sans-serif; letter-spacing: .07em; text-transform: uppercase; color: var(--faint); }
    .pb-here-store { font: 600 11px/1 Manrope, sans-serif; color: var(--muted); }
    .pb-here-priceline { display: flex; align-items: baseline; gap: 6px; margin-top: 7px; }
    .pb-here-price { font: 800 24px/1 Manrope, sans-serif; letter-spacing: -.02em; color: var(--text); }
    .pb-here-sub { font: 500 10px/1 Manrope, sans-serif; color: var(--faint); }
    .pb-here-stats { display: flex; gap: 8px; margin-top: 10px; }
    .pb-chip { flex: 1; padding: 7px 9px; border-radius: 9px; background: var(--chip); }
    .pb-chip-label { font: 500 8.5px/1 Manrope, sans-serif; color: var(--faint); text-transform: uppercase; letter-spacing: .06em; }
    .pb-chip-value { font: 700 12px/1 Manrope, sans-serif; color: var(--text); margin-top: 4px; }

    .pb-spark-wrap { margin: 10px 0 2px; overflow: hidden; }
    .pb-spark { width: 100%; height: 40px; display: block; }

    .pb-stores { padding: 2px 16px 4px; display: flex; flex-direction: column; }
    .pb-store-row { display: flex; align-items: center; gap: 10px; padding: 8px 2px; border-bottom: 1px solid var(--line); }
    .pb-store-link { cursor: pointer; }
    .pb-store-link:hover { opacity: .82; }
    .pb-store-dir { font-size: 13px; width: 14px; flex: none; }
    .pb-store-price { font: 800 15px/1 Manrope, sans-serif; color: var(--text); }
    .pb-store-name { font: 600 12px/1 Manrope, sans-serif; color: var(--muted); }
    .pb-badge { font: 700 9px/1 Manrope, sans-serif; letter-spacing: .06em; text-transform: uppercase; padding: 3px 6px; border-radius: 5px; }
    .pb-badge-best { color: var(--teal); background: var(--tealdim); }

    .pb-callout { margin: 10px 16px 0; padding: 9px 11px; border-radius: 11px; display: flex; align-items: center; gap: 8px; }
    .pb-callout-good { background: var(--tealdim); color: var(--teal); }
    .pb-callout-warn { background: var(--amberdim); color: var(--amber); }
    .pb-callout-icon { font-size: 12px; }
    .pb-callout-text { font: 700 11.5px/1.3 Manrope, sans-serif; }

    .pb-allstats { display: flex; gap: 8px; padding: 12px 16px 16px; }
    .pb-allstat { flex: 1; padding: 9px 11px; border-radius: 11px; background: var(--card); border: 1px solid var(--line); }
    .pb-allstat-label { font: 500 9px/1 Manrope, sans-serif; color: var(--faint); text-transform: uppercase; letter-spacing: .06em; }
    .pb-allstat-value { font: 700 13px/1 Manrope, sans-serif; color: var(--text); margin-top: 5px; }

    .pb-open-link { display: block; padding: 0 16px 16px; font: 700 11.5px/1 Manrope, sans-serif; color: var(--teal); text-decoration: none; }

    /* Empty states */
    .pb-empty { padding: 26px 22px; text-align: center; }
    .pb-empty-icon { font-size: 26px; color: var(--faint); }
    .pb-empty-title { font: 700 14px/1.2 Manrope, sans-serif; color: var(--text); margin-top: 8px; }
    .pb-empty-text { font: 500 12px/1.5 Manrope, sans-serif; color: var(--muted); margin: 6px 0 16px; }

    /* Tune tab */
    .pb-tune-head { display: flex; align-items: center; gap: 8px; padding: 14px 16px 10px; }
    .pb-tune-title { font: 800 13px/1 Manrope, sans-serif; letter-spacing: -.01em; color: var(--text); }
    .pb-subtabs { display: flex; gap: 4px; margin: 0 16px; padding: 3px; background: var(--chip); border-radius: 10px; }
    .pb-subtab { flex: 1; padding: 7px; border-radius: 8px; border: none; cursor: pointer; font: 600 11.5px/1 Manrope, sans-serif; background: transparent; color: var(--muted); }
    .pb-subtab-on { background: var(--card); color: var(--text); box-shadow: 0 1px 2px rgba(0,0,0,.18); }
    .pb-tune-body { padding: 12px 16px 4px; display: flex; flex-direction: column; gap: 10px; }
    .pb-field-tag { font: 700 9.5px/1 Manrope, sans-serif; letter-spacing: .08em; color: var(--faint); text-transform: uppercase; }

    .pb-auto-field { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 12px; background: var(--card); border: 1px solid var(--line); }
    .pb-auto-field .pb-field-tag { width: 44px; flex: none; }
    .pb-auto-meta { flex: 1; min-width: 0; }
    .pb-auto-value { font: 600 12.5px/1.3 Manrope, sans-serif; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .pb-auto-value.pb-miss { color: var(--faint); font-style: italic; }
    .pb-auto-src { display: flex; align-items: center; gap: 6px; margin-top: 3px; font-size: 10px; color: var(--muted); }
    .pb-dot-sep { width: 3px; height: 3px; border-radius: 50%; background: var(--faint); }
    .pb-conf { display: inline-flex; align-items: center; gap: 4px; }
    .pb-conf-dot { width: 6px; height: 6px; border-radius: 50%; }
    .pb-edit-btn { flex: none; padding: 5px 10px; border-radius: 8px; background: transparent; border: 1px solid var(--line); color: var(--muted); font: 600 11px/1 Manrope, sans-serif; cursor: pointer; }

    .pb-manual-field { padding: 11px 12px; border-radius: 12px; background: var(--card); border: 1px solid var(--line); }
    .pb-manual-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
    .pb-pick-btn { padding: 5px 9px; border-radius: 7px; cursor: pointer; font: 600 10.5px/1 Manrope, sans-serif; background: transparent; color: var(--muted); border: 1px solid var(--line); }
    .pb-pick-on { background: var(--teal); color: var(--onTeal); border-color: var(--teal); }
    .pb-manual-controls { display: flex; gap: 7px; align-items: stretch; }
    .pb-select-wrap { position: relative; flex: none; }
    .pb-select { appearance: none; padding: 8px 26px 8px 10px; border-radius: 9px; background: var(--chip); border: 1px solid var(--line); color: var(--text); font: 600 11px/1 Manrope, sans-serif; cursor: pointer; }
    .pb-select-caret { position: absolute; right: 9px; top: 50%; transform: translateY(-50%); pointer-events: none; color: var(--faint); font-size: 9px; }
    .pb-input { flex: 1; min-width: 0; padding: 8px 10px; border-radius: 9px; background: var(--input); border: 1px solid var(--line); color: var(--text); font-size: 11.5px; outline: none; }
    .pb-input:disabled { opacity: .45; }
    .pb-match { display: flex; align-items: center; gap: 7px; margin-top: 8px; padding: 7px 10px; border-radius: 8px; }
    .pb-match-idle { background: var(--chip); border: 1px solid var(--line); color: var(--faint); }
    .pb-match-ok { background: var(--tealdim); border: 1px solid var(--goodln); color: var(--teal); }
    .pb-match-bad { background: var(--redbg); border: 1px solid var(--redln); color: var(--red); }
    .pb-match-icon { font-size: 11px; }
    .pb-match-tag { font: 600 10px/1 Manrope, sans-serif; letter-spacing: .04em; text-transform: uppercase; opacity: .8; }
    .pb-match-text { font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; }

    .pb-tune-foot { display: flex; gap: 8px; padding: 12px 16px 16px; }
  `;
})();
