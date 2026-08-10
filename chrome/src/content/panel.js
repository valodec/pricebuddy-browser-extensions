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

  // PriceBuddy wordmark, copied from ../price-buddy/public/images/logo-full.svg
  // (editor cruft stripped). Fills are driven by --logo-symbol / --logo-text,
  // the same custom properties PriceBuddy's own _logo.scss uses, so it themes
  // with the panel. Inlined rather than loaded via chrome.runtime.getURL so the
  // extension needs no web_accessible_resources. The options page inlines its own
  // copy for the same reason, so this markup exists three times: here,
  // options.html, and images/logo-full.svg as the canonical source. Keep in sync.
  const LOGO_SVG = '<svg width="1920" height="300" viewBox="0 0 1920 300" xmlns="http://www.w3.org/2000/svg" ><g><g transform="matrix(11.659996,0,0,10.722209,189.2271,704.3276)"><path style="fill:var(--logo-symbol,#2dd4bf)" d="m 10.109308,-59.47752 c 0,3.731091 -1.6265938,6.441762 -1.6950008,6.554825 -0.137761,0.225178 -0.376243,0.348691 -0.622323,0.348691 -0.129232,0 -0.25938,-0.03421 -0.377194,-0.105461 -0.343942,-0.209026 -0.454153,-0.656528 -0.24608,-1.000469 0.01534,-0.0247 1.483125,-2.492144 1.483125,-5.797585 0,-1.885023 -1.225645,-3.253185 -2.914946,-3.253185 -1.607589,0 -2.914943,1.307355 -2.914943,2.915895 0,0.685031 0.331589,2.425637 0.458905,3.038459 0.08266,0.394297 -0.171,0.780043 -0.565319,0.862703 -0.394296,0.08076 -0.780042,-0.171021 -0.861749,-0.564367 -0.05034,-0.240379 -0.491208,-2.377181 -0.491208,-3.336795 0,-2.411385 1.961983,-4.373366 4.374314,-4.373366 2.492148,0 4.3724188,2.024689 4.3724188,4.710655 z m -4.2489048,1.146786 c 0.289785,2.421836 0.709733,7.141045 0.227089,7.621802 l -10.589951,10.590899 c -0.650829,0.651779 -1.708303,0.651779 -2.360082,-9.5e-4 l -7.0811862,-7.080236 c -0.651776,-0.650826 -0.651776,-1.708303 0,-2.360077 l 10.5908952,-10.589953 c 0.168157,-0.168169 1.999985,-0.175771 4.05982701,-0.06841 -0.01128,0.135866 -0.04087,0.264131 -0.04087,0.402847 0,0.528263 0.116866,1.347259 0.239432,2.067445 -0.215657,0.320188 -0.342042,0.704983 -0.342042,1.120182 0,1.105931 0.89690899,2.002837 2.00283999,2.002837 1.105931,0 2.002835,-0.896906 2.002835,-2.002837 0,-0.68123 -0.341089,-1.281701 -0.860801,-1.642744 -0.106396,-0.633725 -0.191919,-1.245597 -0.191919,-1.544883 0,-0.06461 0.01331,-0.124463 0.01895,-0.188123 0.25368,0.0266 0.503556,0.05416 0.740136,0.08361 1.399513,0.171971 1.413768,0.169121 1.584786,1.588588 z m -5.64461599,7.925839 c -0.164373,-0.457005 -0.438001,-1.005222 -1.031822,-1.636096 l 0.803794,-0.804745 -0.895003,-0.894056 -0.86745401,0.868403 c -1.161036,-0.795244 -2.358179,-0.730636 -3.170523,0.08171 -0.885506,0.885504 -0.676481,2.009489 -0.0266,3.315889 0.446553,0.904509 0.52826,1.425171 0.181471,1.771962 -0.356294,0.356294 -0.931113,0.201441 -1.452723,-0.319239 -0.59286,-0.592869 -0.940604,-1.325407 -1.113522,-1.919226 l -1.343459,0.796195 c 0.155813,0.537762 0.575766,1.304502 1.168638,1.935378 l -0.876004,0.876954 0.894056,0.895003 0.941561,-0.940608 c 1.241795,0.876004 2.494045,0.75819 3.306389,-0.05413 0.831349,-0.833249 0.904509,-1.764362 0.191919,-3.243685 -0.494058,-1.060327 -0.612822,-1.580987 -0.320189,-1.872674 0.256532,-0.256529 0.712587,-0.329688 1.306406,0.264133 0.658429,0.658428 0.876952,1.297854 0.995718,1.636093 z" /></g><g style="font-size:278.389px;letter-spacing:-10.8402px;stroke-width:23.1991" aria-label="PriceBuddy"><path style="fill:var(--logo-text,#030712)" d="M 361.94594,232.79257 V 37.920267 h 72.93792 q 24.77662,0 42.59352,8.073281 17.8169,7.794892 27.28212,22.827899 9.74362,14.754617 9.74362,35.912183 0,20.60079 -9.74362,35.63379 -9.46522,14.75462 -27.28212,22.8279 -17.8169,8.07328 -42.59352,8.07328 h -61.52397 l 9.18684,-9.74361 v 71.26758 z m 20.60079,-69.59725 -9.18684,-10.022 h 60.96719 q 29.23085,0 44.26386,-12.52751 15.31139,-12.80589 15.31139,-35.91218 0,-23.384678 -15.31139,-36.190572 -15.03301,-12.805895 -44.26386,-12.805895 h -60.96719 l 9.18684,-9.743615 z m 157.86345,69.59725 V 86.638343 h 18.93045 v 39.809627 l -1.94872,-6.95972 q 6.12456,-16.70334 20.60079,-25.333404 14.47623,-8.908448 35.91218,-8.908448 v 19.208842 q -1.11356,0 -2.22711,0 -1.11356,-0.27839 -2.22711,-0.27839 -23.10629,0 -36.19057,14.19784 -13.08429,13.91945 -13.08429,39.80963 v 74.60825 z m 98.56659,0 V 86.638343 h 19.76562 V 232.79257 Z M 648.99878,54.345218 q -6.12456,0 -10.3004,-4.175835 -4.17583,-4.175835 -4.17583,-10.022004 0,-5.846169 4.17583,-9.743615 4.17584,-4.175836 10.3004,-4.175836 6.12455,0 10.30039,3.897447 4.17583,3.897446 4.17583,9.743615 0,6.124558 -4.17583,10.300393 -3.89745,4.175835 -10.30039,4.175835 z M 763.71175,234.18452 q -21.71434,0 -38.97446,-9.46523 -16.98173,-9.74361 -26.72535,-26.44695 -9.74361,-16.98173 -9.74361,-38.69608 0,-21.99273 9.74361,-38.69607 9.74362,-16.70334 26.72535,-26.168566 17.26012,-9.465226 38.97446,-9.465226 18.65206,0 33.68507,7.238114 15.033,7.238114 23.66306,21.714338 l -14.75461,10.02201 q -7.51651,-11.13556 -18.65207,-16.42495 -11.13556,-5.28939 -24.21984,-5.28939 -15.58979,0 -28.11729,7.23811 -12.52751,6.95973 -19.76562,19.76562 -7.23811,12.80589 -7.23811,30.06601 0,17.26012 7.23811,30.06602 7.23811,12.80589 19.76562,20.044 12.5275,6.95973 28.11729,6.95973 13.08428,0 24.21984,-5.28939 11.13556,-5.28939 18.65207,-16.14656 l 14.75461,10.022 q -8.63006,14.19784 -23.66306,21.71434 -15.03301,7.23812 -33.68507,7.23812 z m 144.77897,0 q -22.8279,0 -40.08802,-9.46523 -17.26012,-9.74361 -27.00373,-26.44695 -9.74362,-16.98173 -9.74362,-38.69608 0,-21.71434 9.18684,-38.41768 9.46522,-16.70334 25.61179,-26.168567 16.42495,-9.743615 36.74735,-9.743615 20.60078,0 36.46896,9.465226 16.14656,9.186836 25.3334,26.168566 9.18683,16.70334 9.18683,38.69607 0,1.39195 -0.27839,3.06228 0,1.39195 0,3.06228 H 846.68836 V 150.9462 h 116.64499 l -7.79489,5.84617 q 0,-15.86817 -6.95973,-28.11729 -6.68133,-12.5275 -18.37367,-19.48723 -11.69234,-6.95972 -27.00373,-6.95972 -15.03301,0 -27.00374,6.95972 -11.97072,6.95973 -18.65206,19.48723 -6.68134,12.52751 -6.68134,28.67407 v 3.06228 q 0,16.70334 7.23812,29.50923 7.5165,12.52751 20.60078,19.76562 13.36268,6.95973 30.34441,6.95973 13.36267,0 24.77662,-4.73261 11.69234,-4.73262 20.04401,-14.47623 l 11.13556,12.80589 q -9.74362,11.69234 -24.49824,17.8169 -14.47623,6.12456 -32.01473,6.12456 z" /><path style="fill:var(--logo-text,#030712)" d="M 995.64348,232.79257 V 37.920267 h 99.66322 q 38.4177,0 57.3482,14.197839 18.9304,13.91945 18.9304,36.747349 0,15.033005 -8.0732,26.446955 -7.7949,11.13556 -22.2712,17.8169 -14.1978,6.40294 -33.9634,6.40294 l 5.5678,-13.36267 q 20.6007,0 35.9121,6.40295 15.3114,6.12456 23.6631,18.09528 8.6301,11.69234 8.6301,28.67407 0,25.3334 -20.6008,39.53124 -20.3224,13.91945 -59.5753,13.91945 z m 54.56422,-39.80963 h 46.2126 q 14.1978,0 21.436,-4.73261 7.5165,-5.011 7.5165,-15.03301 0,-10.022 -7.5165,-14.75461 -7.2382,-5.01101 -21.436,-5.01101 h -50.11 v -38.13929 h 41.7583 q 13.9195,0 20.8792,-4.73261 6.9597,-4.73262 6.9597,-14.197842 0,-9.465226 -6.9597,-13.91945 -6.9597,-4.732613 -20.8792,-4.732613 h -37.8609 z m 209.6437,42.31513 q -18.3737,0 -33.1283,-7.23811 -14.4762,-7.23812 -22.8279,-22.54951 -8.0733,-15.58979 -8.0733,-39.25285 V 81.90573 h 52.8939 v 75.72181 q 0,17.53851 6.403,25.05501 6.6813,7.5165 18.652,7.5165 7.7949,0 14.1979,-3.61905 6.4029,-3.61906 10.3004,-11.41395 3.8974,-8.07328 3.8974,-20.60079 V 81.90573 h 52.8939 v 150.88684 h -50.3884 v -42.59352 l 9.7436,11.97073 q -7.7949,16.70334 -22.5495,25.05501 -14.7546,8.07328 -32.0147,8.07328 z m 184.0319,0 q -20.6008,0 -37.5825,-9.46522 -16.7033,-9.74362 -26.7253,-27.00374 -10.022,-17.5385 -10.022,-41.75835 0,-23.94145 10.022,-41.20157 10.022,-17.538509 26.7253,-27.003735 16.9817,-9.465226 37.5825,-9.465226 19.4872,0 32.8499,8.35167 13.6411,8.35167 20.6008,25.611791 6.9597,17.26012 6.9597,43.70707 0,27.00374 -6.6813,44.26385 -6.6813,17.26012 -20.044,25.61179 -13.3627,8.35167 -33.6851,8.35167 z m 11.1356,-42.03674 q 8.9084,0 15.8682,-4.17583 7.2381,-4.17584 11.4139,-12.24912 4.1758,-8.35167 4.1758,-19.76562 0,-11.41395 -4.1758,-19.20884 -4.1758,-8.07328 -11.4139,-12.24912 -6.9598,-4.17583 -15.8682,-4.17583 -9.1869,0 -16.425,4.17583 -6.9597,4.17584 -11.1355,12.24912 -4.1759,7.79489 -4.1759,19.20884 0,11.41395 4.1759,19.76562 4.1758,8.07328 11.1355,12.24912 7.2381,4.17583 16.425,4.17583 z m 33.1283,39.53124 v -25.89018 l 0.2784,-49.83163 -2.7839,-49.83163 V 26.227928 h 52.8939 V 232.79257 Z m 139.2115,2.5055 q -20.6008,0 -37.5826,-9.46522 -16.7033,-9.74362 -26.7253,-27.00374 -10.022,-17.5385 -10.022,-41.75835 0,-23.94145 10.022,-41.20157 10.022,-17.538509 26.7253,-27.003735 16.9818,-9.465226 37.5826,-9.465226 19.4872,0 32.8499,8.35167 13.641,8.35167 20.6007,25.611791 6.9598,17.26012 6.9598,43.70707 0,27.00374 -6.6814,44.26385 -6.6813,17.26012 -20.044,25.61179 -13.3626,8.35167 -33.685,8.35167 z m 11.1355,-42.03674 q 8.9085,0 15.8682,-4.17583 7.2381,-4.17584 11.4139,-12.24912 4.1759,-8.35167 4.1759,-19.76562 0,-11.41395 -4.1759,-19.20884 -4.1758,-8.07328 -11.4139,-12.24912 -6.9597,-4.17583 -15.8682,-4.17583 -9.1868,0 -16.4249,4.17583 -6.9598,4.17584 -11.1356,12.24912 -4.1758,7.79489 -4.1758,19.20884 0,11.41395 4.1758,19.76562 4.1758,8.07328 11.1356,12.24912 7.2381,4.17583 16.4249,4.17583 z m 33.1283,39.53124 v -25.89018 l 0.2784,-49.83163 -2.7839,-49.83163 V 26.227928 h 52.8939 V 232.79257 Z m 99.4019,56.51297 q -11.9708,0 -24.2199,-3.89745 -11.9707,-3.61905 -19.4872,-9.74361 l 18.3737,-37.02574 q 4.7326,4.17584 10.8571,6.40295 6.403,2.5055 12.5275,2.5055 8.6301,0 13.6411,-3.89745 5.011,-3.89744 8.6301,-12.24911 l 6.9597,-17.53851 4.1758,-5.28939 51.2236,-126.667 h 50.3884 l -65.143,157.0114 q -7.7949,19.48723 -18.0953,30.3444 -10.022,11.13556 -22.5495,15.58979 -12.2491,4.45422 -27.2821,4.45422 z m 20.6008,-50.11002 -66.535,-157.28979 h 54.2858 l 48.9965,121.93439 z" /></g></g></svg>';

  // Parsed rather than assigned via innerHTML — the "never innerHTML" rule holds
  // even for a static literal, and DOMParser keeps SVG in the right namespace.
  function logoNode() {
    const doc = new DOMParser().parseFromString(LOGO_SVG, 'image/svg+xml');
    const svg = doc.documentElement;
    svg.setAttribute('class', 'pb-logo');
    svg.removeAttribute('width');
    svg.removeAttribute('height');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'PriceBuddy');
    return document.importNode(svg, true);
  }

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

  // `healing.reason` from the meta-extraction response.
  const HEAL_FAILURE_COPY = {
    timeout: 'AI detection ran out of time on the server. The fields below are from the plain scrape — try again, or set the selectors by hand.',
    error: 'AI detection failed on the server. The fields below are from the plain scrape.',
    disabled: 'AI detection is turned off on your PriceBuddy instance.',
    not_needed: 'PriceBuddy already found everything without the AI.',
  };

  // Mirrors App\Enums\ScraperService. `http` is a plain curl fetch; `api` drives a
  // real browser, which is the only thing that works on pages that render their
  // price with JavaScript.
  const SCRAPER_SERVICES = [
    { value: 'http', label: 'HTTP', hint: 'Faster. Works when the price is in the page source.' },
    { value: 'api', label: 'Browser', hint: 'Slower, but reads pages that render with JavaScript.' },
  ];
  const DEFAULT_SCRAPER_SERVICE = 'http';

  const THEME_KEY = 'pricebuddy.theme';

  let host = null; // shadow host element
  let root = null; // shadow root
  let picking = null; // field key currently being picked, or null
  let hoverEl = null;

  let currentState = null;
  let currentStoreId = null;          // set when editing an existing store
  let currentStoreSettings = { scraper_service: 'http' }; // preserved on update

  // A PUT replaces `scrape_strategy` and `domains` wholesale — both are JSON
  // casts filled from the request, with no server-side merge. Anything the panel
  // doesn't echo back is therefore deleted, so these hold the parts of an
  // existing store the Tune UI doesn't model.
  let currentStoreDomains = null;     // full domain list; the panel only knows one
  let currentStrategyExtras = {};     // per field: prepend/append and anything new
  let apiBase = '';                   // PriceBuddy base URL, for building product links

  // Whether the "does a store already exist for this domain?" lookup actually
  // succeeded. Saving is blocked until it has: on a failed lookup we don't know
  // the store's current strategy, and buildStorePayload always emits all three
  // fields, so saving would silently overwrite a working config with defaults.
  let storeLookupOk = false;

  let theme = 'dark';
  let activeTab = 'track';
  let tuneMode = 'auto';              // Tune sub-tab: 'auto' | 'manual'

  // Cached async data so switching tabs doesn't re-hit the API.
  let detected = null;               // last *auto* meta-extraction result
  let testResult = null;             // last "Test all" result (draft strategy)
  let insightsVM = null;             // built Insights view-model (null = not tracked)
  let trackVM = null;                // Track view-model
  let loaded = { track: false, insights: false, tune: false };

  // Client-side (SPA) navigation changes the product without reloading the page,
  // which would otherwise leave every cache above pointing at the previous one.
  let lastUrl = location.href;
  let urlTimer = null;

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
      // From the domain, never document.title — see V.storeNameFromHost. A store
      // is shared by every product on the domain, so naming it after whichever
      // product happened to be open is wrong and not easily undone.
      storeName: V.storeNameFromHost(location.host) || V.bareDomain(location.host),
      scraperService: DEFAULT_SCRAPER_SERVICE,
      strategy: {
        title: { type: 'schema_org', value: '' },
        price: { type: 'schema_org', value: '' },
        image: { type: 'schema_org', value: '' },
      },
    };
  }

  async function loadState() {
    const stored = (await chrome.storage.local.get(stateKey()))[stateKey()];
    if (!stored) {
      return defaultState();
    }
    // Shallow merge over the defaults: a draft saved before a field existed
    // would otherwise come back missing it.
    const base = defaultState();
    return { ...base, ...stored, strategy: { ...base.strategy, ...(stored.strategy || {}) } };
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

  // The domain list to send. An update replaces the array, so sending only the
  // host we happen to be on would collapse a store like
  // [target.com.au, www.target.com.au] down to whichever one the user was
  // viewing. Keep what's there and only add the current host if it's new.
  function buildDomains() {
    const existing = Array.isArray(currentStoreDomains) ? currentStoreDomains : [];
    const wanted = V.bareDomain(location.host);
    const known = existing.some((d) => V.bareDomain(d && d.domain) === wanted);
    return known ? existing : [...existing, { domain: location.host }];
  }

  function buildStorePayload(state) {
    const strategy = {};
    for (const { key } of FIELDS) {
      const s = state.strategy[key] || { type: 'schema_org', value: '' };
      if (s.type === 'schema_org') {
        // `value` must be absent for schema_org — the API rejects one. prepend /
        // append are dropped too: StrategyExtractor returns before applying them
        // for this type, and the admin form hides them, so keeping them would
        // just be dead data.
        strategy[key] = { type: 'schema_org' };
      } else {
        // Spread the extras first so type/value always win, but prepend/append
        // (and any field a future PriceBuddy adds) survive the round trip.
        strategy[key] = { ...(currentStrategyExtras[key] || {}), type: s.type, value: (s.value || '').trim() };
      }
    }
    return {
      name: state.storeName || V.bareDomain(location.host),
      domains: buildDomains(),
      // Spread the store's existing settings and override only the scraper. A PUT
      // replaces `settings` wholesale, so anything not echoed back is deleted —
      // including keys the panel doesn't model, like `ai_self_healing_disabled`
      // (a per-store opt-out) and `locale_settings`.
      settings: {
        ...currentStoreSettings,
        scraper_service: state.scraperService || DEFAULT_SCRAPER_SERVICE,
      },
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

  // Only ever hand http(s) URLs to window.open / href. Values arrive from the
  // user's PriceBuddy instance and from the API URL they typed, so a stray
  // `javascript:` should never become clickable.
  function safeUrl(url) {
    try {
      const parsed = new URL(String(url), location.href);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
    } catch {
      return null;
    }
  }

  function openExternal(url) {
    const href = safeUrl(url);
    if (href) {
      window.open(href, '_blank', 'noopener,noreferrer');
    }
  }

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

  // Status banner.
  //
  // `statusSeq` increments on every write so a caller can tell whether the
  // message it put up is still the one showing — see withProgressNote(), which
  // uses it to retract its own "still working" note without stomping on a newer
  // message that arrived first.
  const STATUS_ICON = { info: '⌾', success: '✓', error: '⚠' };
  // Info and success are transient; an error stays until something replaces it,
  // since it's the one the user actually has to act on.
  const STATUS_TTL_MS = { info: 9000, success: 6000, error: 0 };

  let statusSeq = 0;
  let statusTimer = null;

  function clearStatus() {
    const status = root && root.getElementById('pb-status');
    if (status) {
      status.innerHTML = '';
      status.className = 'pb-status';
    }
    clearTimeout(statusTimer);
    statusTimer = null;
  }

  function setStatus(text, kind = 'info') {
    const status = root && root.getElementById('pb-status');
    if (!status) {
      return statusSeq;
    }

    statusSeq += 1;
    clearTimeout(statusTimer);
    statusTimer = null;

    if (!text) {
      clearStatus();
      return statusSeq;
    }

    status.innerHTML = '';
    status.className = `pb-status pb-status-on pb-${kind}`;
    status.append(
      el('span', { className: 'pb-status-icon', textContent: STATUS_ICON[kind] || STATUS_ICON.info }),
      el('span', { className: 'pb-status-text', textContent: text }),
    );

    const ttl = STATUS_TTL_MS[kind];
    if (ttl) {
      const seq = statusSeq;
      statusTimer = setTimeout(() => {
        // Only retract if nothing newer has been shown since.
        if (statusSeq === seq) {
          clearStatus();
        }
      }, ttl);
    }
    return statusSeq;
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
  // Server capabilities
  //
  // PriceBuddy answers URL-matching questions server-side where it can, which is
  // both far cheaper and immune to the normalisation drift a client-side mirror
  // would suffer. Older instances lack those endpoints, so every use is gated on
  // a capability flag with a fallback behind it.
  //
  // Cached with a TTL rather than revalidated via the endpoint's ETag: a 304 is
  // still a round trip, and the goal is no request at all on most panel opens.
  // ---------------------------------------------------------------------------

  const CAPS_TTL_MS = 24 * 60 * 60 * 1000;
  const CAPS_FAIL_TTL_MS = 60 * 60 * 1000; // retry sooner after a failure
  const NO_CAPS = {
    products_filter_url: false,
    products_current_url: false,
    products_sparse_fieldsets: false,
    stores_filter_domain: false,
  };

  let caps = null;
  let limits = {};

  // Keyed by instance so pointing the extension at a different server doesn't
  // inherit the previous one's capabilities.
  function capsKey() {
    return `pb:caps:${apiBase}`;
  }

  async function loadCapabilities() {
    if (caps) {
      return caps;
    }

    const key = capsKey();
    const cached = (await chrome.storage.local.get(key))[key];
    if (cached && cached.caps && cached.expires > Date.now()) {
      caps = cached.caps;
      limits = cached.limits || {};
      return caps;
    }

    const res = await send({ type: 'pb:client-config' });
    const payload = res.ok && res.data && res.data.data;
    if (payload && payload.capabilities) {
      caps = { ...NO_CAPS, ...payload.capabilities };
      limits = payload.limits || {};
    } else {
      // 404 (instance predates the endpoint) and 403 (token predates the
      // `client-config:read` ability) are indistinguishable to us and mean the
      // same thing: use the fallbacks. Cached briefly so re-minting a token or
      // upgrading the server is picked up without waiting a full day.
      caps = { ...NO_CAPS };
      limits = {};
    }

    await chrome.storage.local.set({
      [key]: { caps, limits, expires: Date.now() + (payload ? CAPS_TTL_MS : CAPS_FAIL_TTL_MS) },
    });
    return caps;
  }

  // How long to let an extraction run, from the server's own published ceiling
  // rather than a number hardcoded here — the two would drift the moment an
  // instance raised its budget for AI healing. The headroom covers request
  // overhead so the client never aborts a request the server would have answered.
  const EXTRACTION_HEADROOM_MS = 10_000;

  async function extractionTimeoutMs() {
    await loadCapabilities();
    const budget = Number(limits.meta_extraction_timeout_seconds);
    return Number.isFinite(budget) && budget > 0
      ? budget * 1000 + EXTRACTION_HEADROOM_MS
      : undefined; // let the client library apply its own default
  }

  // A capability flag can be stale for up to its TTL — an upgrade only ever adds
  // capabilities (a stale `false` just means we take the slow path), but a
  // rollback leaves a stale `true`. So every gated call still has to cope with
  // the server rejecting the parameter, which shows up as a 4xx. 401/403 are
  // real auth problems worth surfacing rather than silently working around.
  function isCapabilityMiss(res) {
    return res.status >= 400 && res.status < 500 && res.status !== 401 && res.status !== 403;
  }

  // ---------------------------------------------------------------------------
  // Data loaders
  // ---------------------------------------------------------------------------

  // A slow call shouldn't look like a frozen one. Extraction scrapes the live
  // page and may then run AI healing server-side, so 10-15s is normal and a
  // minute is possible on some instances.
  function withProgressNote(promise, note, afterMs = 6000) {
    let noteSeq = null;
    const timer = setTimeout(() => { noteSeq = setStatus(note, 'info'); }, afterMs);
    return promise.finally(() => {
      clearTimeout(timer);
      // The note describes work that has now finished. Retract it — but only if
      // it's still the message on screen, so a result or error set by the caller
      // in the meantime survives.
      if (noteSeq !== null && statusSeq === noteSeq) {
        clearStatus();
      }
    });
  }

  // Ask PriceBuddy to extract (auto-detecting / matching a store) for this page.
  // `heal` is deliberately omitted: PriceBuddy defaults it off, and the AI path
  // is slow, best-effort, and may return a different strategy than the one being
  // tested. It's offered as an explicit action instead — see onHeal().
  async function ensureDetected() {
    if (detected) {
      return detected;
    }
    const res = await withProgressNote(
      send({ type: 'pb:meta-extraction', url: location.href, timeoutMs: await extractionTimeoutMs() }),
      'Still reading this page — PriceBuddy is scraping it live…',
    );
    detected = res.ok ? res.data : { error: res.error, status: res.status };
    return detected;
  }

  // Explicit "let the AI work it out". Separate from auto-detect because it can
  // take the server's whole extraction budget and may still come back with
  // nothing — the response says which via `healing.reason`.
  async function onHeal() {
    setStatus('Asking PriceBuddy to work out the selectors… this can take a while.', 'info');
    const res = await withProgressNote(
      send({ type: 'pb:meta-extraction', url: location.href, heal: true, timeoutMs: await extractionTimeoutMs() }),
      'Still working — the AI is reading the page…',
      8000,
    );

    if (!res.ok) {
      setStatus(`Error: ${res.error}`, 'error');
      return;
    }

    detected = res.data;
    const healing = res.data.healing || {};
    if (healing.applied) {
      const found = FIELDS.filter(({ key }) => detectedField(key, currentState || defaultState()).has).length;
      setStatus(`AI detection filled in ${found} of ${FIELDS.length} fields. Review, then save.`, 'success');
    } else {
      setStatus(HEAL_FAILURE_COPY[healing.reason] || 'AI detection produced nothing usable.', 'info');
    }
    renderContent();
  }

  // Stores matching this page's domain. Single source of truth — the Track tab's
  // "N stores" pill and Tune's existing-store lookup both go through here.
  //
  // `filter[domain]` (exact, singular) does the host normalisation server-side,
  // so we can hand it `location.host` untouched. The older `filter[domains]`
  // (plural) is an `AllowedFilter::partial()`, i.e. a LIKE, which is why the
  // fallback still has to tighten the result set itself.
  //
  async function findStoresForDomain() {
    if ((await loadCapabilities()).stores_filter_domain) {
      const res = await send({ type: 'pb:get-store', domain: location.host, exact: true });
      if (res.ok) {
        return { ok: true, stores: (res.data && res.data.data) || [] };
      }
      if (!isCapabilityMiss(res)) {
        return { ok: false, stores: [] };
      }
      // Fall through to the partial filter.
    }

    const wanted = V.bareDomain(location.host);
    const res = await send({ type: 'pb:get-store', domain: wanted });
    if (!res.ok) {
      return { ok: false, stores: [] };
    }
    const stores = (res.data && res.data.data) || [];
    return {
      ok: true,
      stores: stores.filter((s) => (s.domains || []).some((d) => V.bareDomain(d && d.domain) === wanted)),
    };
  }

  // Find how many stores already match this domain (for the Track "N stores" pill).
  async function lookupStores() {
    return (await findStoresForDomain()).stores;
  }

  // The products API caps `per_page` at 100 server-side and offers no URL filter,
  // so finding the product for this page means paging. Bounded so a large library
  // can't spin forever; if we hit the bound we say so rather than reporting
  // "not tracked", which would tempt the user into creating a duplicate.
  //
  // TODO: collapses to a single request once PriceBuddy grows `filter[url]`.
  const PRODUCTS_PER_PAGE = 100;
  const MAX_PRODUCT_PAGES = 20; // 2,000 products

  // Matching needs nothing but each product's id and its tracked URLs. Asking for
  // a sparse fieldset plus the `urls` include keeps `price_cache` out of the
  // response entirely — it embeds a full {date: price} history per store, which
  // grows with tracking duration and otherwise dominates the payload by orders of
  // magnitude. The detail request that follows still returns everything.
  const LEAN_LIST_PARAMS = { 'fields[products]': 'id', include: 'urls' };

  // Instances predating the sparse-fieldset/include support reject those params.
  // Fall back once and remember, rather than paying the failure on every page.
  let leanListSupported = true;

  async function listProductsPage(page) {
    const base = { per_page: PRODUCTS_PER_PAGE, page };

    if (leanListSupported) {
      const res = await send({ type: 'pb:list-products', params: { ...base, ...LEAN_LIST_PARAMS } });
      if (res.ok) {
        return res;
      }
      // A rejected fieldset or include surfaces as a 4xx. Auth failures (401/403)
      // would fail the plain request too, so pass those straight back.
      const rejectedParams = res.status >= 400 && res.status < 500
        && res.status !== 401 && res.status !== 403;
      if (!rejectedParams) {
        return res;
      }
      console.info('PriceBuddy: instance rejected the lean product query; using the full payload.');
      leanListSupported = false;
    }

    return send({ type: 'pb:list-products', params: base });
  }

  // One request, exact, and matched by rules the extension never has to mirror.
  // Returns undefined to mean "couldn't use this path" so the caller falls
  // through to paging; a genuine error is returned as a result object.
  async function findViaUrlFilter() {
    const res = await send({
      type: 'pb:list-products',
      params: { 'filter[url]': location.href, 'fields[products]': 'id', per_page: 5 },
    });

    if (!res.ok) {
      return isCapabilityMiss(res) ? undefined : { id: null, error: res.error, status: res.status };
    }

    const products = (res.data && res.data.data) || [];
    // The filter deliberately returns every match rather than assuming one, so
    // more than one is possible where two products share a normalised URL. We
    // can't tell them apart from here — take the first and say so.
    if (products.length > 1) {
      console.info(`PriceBuddy: ${products.length} tracked products match this URL; showing the first.`);
    }
    return { id: products.length ? products[0].id : null };
  }

  /**
   * @returns {Promise<{id:?number, exhausted?:boolean, error?:string, status?:number}>}
   */
  async function findTrackedProductId(target) {
    if ((await loadCapabilities()).products_filter_url) {
      const viaFilter = await findViaUrlFilter();
      if (viaFilter) {
        return viaFilter;
      }
    }

    for (let page = 1; page <= MAX_PRODUCT_PAGES; page += 1) {
      const res = await listProductsPage(page);
      if (!res.ok) {
        return { id: null, error: res.error, status: res.status };
      }

      const body = res.data || {};
      const products = body.data || [];
      for (const product of products) {
        for (const url of V.trackedUrls(product)) {
          if (V.normalizeUrl(url) === target) {
            return { id: product.id };
          }
        }
      }

      // Stop on the last page. Prefer the pagination meta; fall back to a short
      // page for responses that don't carry it.
      const lastPage = Number((body.meta || {}).last_page) || null;
      const isLastPage = lastPage ? page >= lastPage : products.length < PRODUCTS_PER_PAGE;
      if (isLastPage || products.length === 0) {
        return { id: null };
      }
    }
    return { id: null, exhausted: true };
  }

  // Locate the tracked product for this page and build the Insights view-model.
  async function loadInsights() {
    const target = V.normalizeUrl(location.href);
    const found = await findTrackedProductId(target);
    if (found.error) {
      return { error: found.error, status: found.status };
    }
    if (found.exhausted) {
      return {
        truncated: true,
        error: `Searched the first ${MAX_PRODUCT_PAGES * PRODUCTS_PER_PAGE} tracked products without finding this page.`,
      };
    }
    const matchId = found.id;
    if (!matchId) {
      return null; // not tracked
    }
    // Pull the full detail with the materialized insights block. `current_url`
    // asks the server to mark which price_cache entry is the page we're on —
    // it matches on urls.id, so unlike comparing URLs here it can't be thrown
    // off by the affiliate tagging baked into price_cache[].url.
    const params = { include: 'insights' };
    if ((await loadCapabilities()).products_current_url) {
      params.current_url = location.href;
    }

    let detail = await send({ type: 'pb:get-product', id: matchId, params });
    if (!detail.ok && params.current_url && isCapabilityMiss(detail)) {
      // Stale capability (server rolled back) — retry without it.
      delete params.current_url;
      detail = await send({ type: 'pb:get-product', id: matchId, params });
    }
    if (!detail.ok) {
      return { error: detail.error, status: detail.status };
    }
    const product = (detail.data && detail.data.data) || detail.data;
    return V.buildInsights(product, product.insights || null, location.href);
  }

  // ---------------------------------------------------------------------------
  // Client-side navigation
  //
  // Retailers routinely swap the product without a page load, which would leave
  // every cache below pointing at the previous one. There's no reliable event for
  // this from an isolated world (patching history.pushState only sees the
  // isolated world's copy), so poll while the panel is open — cheap, and only
  // runs once the user has actually opened the panel.
  // ---------------------------------------------------------------------------

  function resetPageCaches() {
    detected = null;
    testResult = null;
    insightsVM = null;
    trackVM = null;
    currentState = null;
    currentStoreId = null;
    currentStoreSettings = { scraper_service: 'http' };
    currentStoreDomains = null;
    currentStrategyExtras = {};
    storeLookupOk = false;
    loaded = { track: false, insights: false, tune: false };
  }

  function onUrlMaybeChanged() {
    if (location.href === lastUrl) {
      return;
    }
    lastUrl = location.href;
    resetPageCaches();
    if (root && host && host.style.display !== 'none') {
      setStatus('Page changed — reloading for this product…', 'info');
      renderContent();
    }
  }

  function watchUrl() {
    if (urlTimer) {
      return;
    }
    urlTimer = setInterval(onUrlMaybeChanged, 1000);
    window.addEventListener('popstate', onUrlMaybeChanged);
    window.addEventListener('hashchange', onUrlMaybeChanged);
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
    // Note: #pb-status deliberately lives outside #pb-content (built once in
    // buildPanel) so a message survives the re-render that usually follows it —
    // e.g. onTrack's "Tracking …" confirmation, which switches tab immediately.
    const render = activeTab === 'track' ? renderTrack : (activeTab === 'insights' ? renderInsights : renderTune);
    Promise.resolve()
      .then(() => render(box))
      .catch((err) => {
        console.error('PriceBuddy: failed to render the panel.', err);
        setStatus(`Couldn't render this tab: ${err && err.message ? err.message : err}`, 'error');
      });
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

    // Actions. When the page is already tracked, offering "Track this product"
    // as the primary action alongside an "already tracking" note is contradictory
    // — and acting on it creates a duplicate. Lead with Insights instead.
    const alreadyTracked = !!insightsVM && !insightsVM.error;
    const trackBtn = el('button', {
      className: `pb-btn pb-btn-block ${alreadyTracked ? 'pb-btn-soft' : 'pb-btn-primary'}`,
    }, [
      el('span', { className: 'pb-btn-icon', textContent: alreadyTracked ? '⧉' : '+' }),
      document.createTextNode(alreadyTracked ? ' Track again as a new product' : ' Track this product'),
    ]);
    trackBtn.addEventListener('click', onTrack);

    if (alreadyTracked) {
      const seeInsights = el('button', {
        className: 'pb-btn pb-btn-primary pb-btn-block',
        textContent: 'View insights →',
      });
      seeInsights.addEventListener('click', () => setTab('insights'));
      box.append(el('div', { className: 'pb-track-actions' }, [seeInsights]));
    }

    const secondary = el('div', { className: 'pb-row2' }, [
      buttonTo('Add another store', () => { tuneMode = 'manual'; setTab('tune'); }),
      buttonTo('Scrape settings', () => setTab('tune')),
    ]);

    box.append(el('div', { className: 'pb-track-actions' }, [trackBtn, secondary]));

    if (alreadyTracked) {
      box.append(el('div', {
        className: 'pb-inline-note',
        textContent: 'This page is already tracked in PriceBuddy.',
      }));
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

    if (insightsVM && insightsVM.truncated) {
      // Not an error, and importantly not "untracked" — saying untracked here
      // would invite the user to track a duplicate.
      box.append(emptyState(
        '⌕',
        'Too many products to search',
        `${insightsVM.error} It may still be tracked — check in PriceBuddy before tracking it again.`,
      ));
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
      // The backend tells us when there aren't enough data points to trust the
      // deal score; say so rather than presenting it as settled.
      if (vm.verdict.lowConfidence) {
        card.append(el('div', { className: 'pb-verdict-caveat' }, [
          el('span', { textContent: '⌾ ' }),
          el('span', { textContent: 'Based on limited price history so far.' }),
        ]));
      }
      if (vm.verdict.cta && safeUrl(vm.verdict.cta.url)) {
        const cta = el('button', { className: 'pb-verdict-cta', textContent: vm.verdict.cta.label });
        cta.addEventListener('click', () => openExternal(vm.verdict.cta.url));
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
        if (safeUrl(r.url)) {
          row.classList.add('pb-store-link');
          row.addEventListener('click', () => openExternal(r.url));
        }
        list.append(row);
      }
      box.append(list);
    }

    // All-stores min / avg / max. With a single store these are the same numbers
    // as the "you're here" chips above, so showing both is just noise.
    if (vm.allStats && vm.storeCount > 1) {
      box.append(el('div', { className: 'pb-allstats' }, [
        allStat('All min', vm.allStats.min),
        allStat('All avg', vm.allStats.avg),
        allStat('All max', vm.allStats.max),
      ]));
    }

    const productHref = apiBase && vm.productId
      ? safeUrl(`${apiBase}/admin/products/${encodeURIComponent(vm.productId)}`)
      : null;
    if (productHref) {
      box.append(el('a', {
        className: 'pb-open-link',
        textContent: 'Open in PriceBuddy →',
        href: productHref,
        target: '_blank',
        rel: 'noopener noreferrer',
      }));
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

    // Store name. Editable because it's permanent and shared by every product on
    // the domain — and because when a store already exists this renames it.
    const nameRow = el('div', { className: 'pb-storename' }, [
      el('label', { className: 'pb-field-tag', htmlFor: 'pb-store-name', textContent: 'Store name' }),
    ]);
    const nameInput = el('input', {
      id: 'pb-store-name',
      type: 'text',
      className: 'pb-input',
      value: state.storeName || '',
      placeholder: V.bareDomain(location.host),
      spellcheck: false,
    });
    nameInput.addEventListener('input', async () => {
      state.storeName = nameInput.value;
      await saveState(state);
      const btn = root.getElementById('pb-save-btn');
      if (btn) {
        btn.textContent = saveButtonLabel(state);
      }
    });
    nameRow.append(nameInput);
    box.append(nameRow);

    // Scraper service. Exposed because the default (plain HTTP) silently returns
    // nothing on pages that render their price with JavaScript — the failure looks
    // like a bad selector rather than the wrong fetch method, which is very hard
    // to diagnose from inside the panel.
    const current = state.scraperService || DEFAULT_SCRAPER_SERVICE;
    const scraperRow = el('div', { className: 'pb-storename' }, [
      el('label', { className: 'pb-field-tag', htmlFor: 'pb-scraper', textContent: 'Fetched with' }),
    ]);
    const scraperWrap = el('div', { className: 'pb-select-wrap pb-select-wide' });
    const scraperSel = el('select', { id: 'pb-scraper', className: 'pb-select' });
    for (const svc of SCRAPER_SERVICES) {
      const opt = el('option', { value: svc.value, textContent: svc.label });
      if (svc.value === current) {
        opt.selected = true;
      }
      scraperSel.append(opt);
    }
    scraperWrap.append(scraperSel, el('span', { className: 'pb-select-caret', textContent: '▾' }));
    const scraperHint = el('div', {
      className: 'pb-hint',
      textContent: (SCRAPER_SERVICES.find((x) => x.value === current) || SCRAPER_SERVICES[0]).hint,
    });
    scraperSel.addEventListener('change', async () => {
      state.scraperService = scraperSel.value;
      await saveState(state);
      // Results were produced by the previous fetch method, so they no longer
      // describe what saving would do. Drop them rather than leave them looking
      // current.
      testResult = null;
      detected = null;
      renderContent();
      setStatus('Fetch method changed — run “Test all” to check it.', 'info');
    });
    scraperRow.append(scraperWrap, scraperHint);
    box.append(scraperRow);

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
      className: `pb-btn pb-btn-primary pb-btn-grow ${storeLookupOk ? '' : 'pb-btn-blocked'}`,
      textContent: saveButtonLabel(state),
      title: storeLookupOk ? '' : "Store lookup failed — saving is blocked so it can't overwrite a working config",
    });
    saveBtn.addEventListener('click', onSaveStore);
    const testBtn = el('button', { className: 'pb-btn pb-btn-soft', textContent: 'Test all' });
    testBtn.addEventListener('click', onTestAll);
    footer.append(saveBtn, testBtn);
    box.append(footer);
  }

  function saveButtonLabel(state) {
    const name = (state.storeName || '').trim() || V.bareDomain(location.host);
    return `${currentStoreId ? 'Update' : 'Save to'} ${name}`;
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

    // Only worth offering when the plain scrape came up short — if all three
    // resolved there is nothing for the AI to improve, and it's an expensive,
    // best-effort call.
    if (found < FIELDS.length) {
      const healBtn = el('button', {
        className: 'pb-btn pb-btn-soft pb-btn-block pb-heal-btn',
        textContent: '✦ Try AI detection',
        title: 'Ask your PriceBuddy instance to work out the selectors. Slower, and may still find nothing.',
      });
      healBtn.addEventListener('click', onHeal);
      wrap.append(healBtn);
    }

    box.append(wrap);
  }

  function renderTuneManual(box, state) {
    const wrap = el('div', { className: 'pb-tune-body' });
    // setMatch() looks rows up by id, so it can only run once they're in the
    // shadow root — collect them here and apply after the append below.
    const matchRows = [];
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

      // Live match preview (populated by Test all). Restored from the last test
      // result so switching sub-tabs or re-rendering doesn't discard it.
      card.append(el('div', { id: `pb-match-${key}`, className: 'pb-match pb-match-idle' }, [
        el('span', { className: 'pb-match-icon', textContent: '·' }),
        el('span', { className: 'pb-match-tag', textContent: 'not tested' }),
        el('span', { className: 'pb-match-text pb-mono', textContent: 'Run “Test all” to preview' }),
      ]));

      wrap.append(card);
      if (testResult) {
        const v = testResult[key];
        matchRows.push([key, v !== null && v !== undefined && v !== '', v]);
      }
    }
    box.append(wrap);
    for (const [key, ok, value] of matchRows) {
      setMatch(key, ok, value);
    }
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
    const res = await withProgressNote(
      send({
        type: 'pb:meta-extraction',
        url: location.href,
        store: buildStorePayload(state),
        timeoutMs: await extractionTimeoutMs(),
      }),
      'Still testing — PriceBuddy is scraping the page live…',
    );
    if (!res.ok) {
      setStatus(`Error: ${res.error}`, 'error');
      return;
    }
    // Kept separate from `detected`: this is the *draft* strategy's result, and
    // folding it into the auto-detect cache would make the Auto-detect sub-tab
    // present the user's manual edits as PriceBuddy's own detection.
    testResult = res.data;
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

  // Re-run the store lookup after it failed, so a transient network/token problem
  // doesn't force the user to close and reopen the panel.
  function showRetryLookup() {
    const status = root && root.getElementById('pb-status');
    if (!status || status.querySelector('.pb-retry')) {
      return;
    }
    const btn = el('button', { className: 'pb-retry', textContent: 'Retry lookup' });
    btn.addEventListener('click', async () => {
      setStatus('Checking store…', 'info');
      const state = currentState || (await loadState());
      await prepareStoreForTune(state);
      currentState = state;
      if (storeLookupOk) {
        loaded.tune = true;
        renderContent();
        setStatus('Store config loaded — safe to save now.', 'success');
      } else {
        setStatus('Still no answer from PriceBuddy. Check your connection and token in settings.', 'error');
        showRetryLookup();
      }
    });
    status.append(btn);
  }

  // Look up an existing store for this domain and fold its saved strategy into
  // the draft, so Tune opens in "update" mode when the store already exists.
  async function prepareStoreForTune(state) {
    const found = await findStoresForDomain();
    if (!found.ok) {
      // Unknown whether a store exists, so we also don't know its saved strategy.
      // Leave the draft alone and let onSaveStore refuse rather than overwrite.
      storeLookupOk = false;
      currentStoreId = null;
      return;
    }
    storeLookupOk = true;
    // Note: GET /api/stores goes through the Filament StoreTransformer, which
    // returns the raw model attribute `scrape_strategy`. The meta-extraction
    // endpoint uses App\Http\Resources\StoreResource instead, which renames the
    // same data to `scrape_settings`. Both spellings are correct in context —
    // see detectedField() for the other one.
    const existing = found.stores[0] || null;
    if (existing) {
      currentStoreId = existing.id;
      currentStoreSettings = existing.settings || { scraper_service: DEFAULT_SCRAPER_SERVICE };
      state.scraperService = currentStoreSettings.scraper_service || DEFAULT_SCRAPER_SERVICE;
      if (existing.name) {
        state.storeName = existing.name;
      }
      currentStoreDomains = Array.isArray(existing.domains) ? existing.domains : null;
      const strat = existing.scrape_strategy || {};
      currentStrategyExtras = {};
      for (const { key } of FIELDS) {
        const d = strat[key];
        if (d && d.type) {
          state.strategy[key] = { type: d.type, value: d.value || '' };
          // Everything the Tune UI doesn't model — prepend/append today — kept so
          // buildStorePayload can put it back. BWS, for one, reconstructs image
          // URLs with them, and a save that dropped them would break scraping.
          const { type, value, ...extras } = d;
          currentStrategyExtras[key] = extras;
        }
      }
      await saveState(state);
    } else {
      currentStoreId = null;
      currentStoreSettings = { scraper_service: 'http' };
      currentStoreDomains = null;
      currentStrategyExtras = {};
    }
  }

  async function onSaveStore() {
    // buildStorePayload always emits title/price/image, so saving before we know
    // what the domain's store currently holds can replace a working strategy with
    // defaults. Refuse instead, and offer to retry the lookup.
    if (!storeLookupOk) {
      setStatus(
        "Can't save yet — PriceBuddy didn't return the existing store for this domain, "
        + 'so saving now could overwrite a working scrape strategy. Press “Retry lookup”.',
        'error',
      );
      showRetryLookup();
      return;
    }

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
        btn.textContent = saveButtonLabel(state);
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
      logoNode(),
      el('span', { className: 'pb-spacer' }),
    ]);
    const themeBtn = el('button', { id: 'pb-theme', className: 'pb-icon-btn', textContent: theme === 'dark' ? '☀' : '☾', title: 'Toggle theme' });
    themeBtn.addEventListener('click', toggleTheme);
    const closeBtn = el('button', { className: 'pb-icon-btn pb-close', textContent: '×', title: 'Close' });
    closeBtn.addEventListener('click', () => setHidden(true));
    header.append(themeBtn, closeBtn);
    panel.append(header);

    // Note: the service worker deliberately withholds the API token here — the
    // panel only needs the base URL for building links. See getPublicSettings().
    const settings = await send({ type: 'pb:get-settings' });
    if (!settings.ok || !settings.data || !settings.data.configured) {
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

    // Status lives outside the content container so renderContent() clearing the
    // content doesn't take the last message with it.
    panel.append(el('div', { id: 'pb-status', className: 'pb-status' }));

    // Content container.
    panel.append(el('div', { id: 'pb-content', className: 'pb-content' }));

    root.append(panel);
    applyTheme();
    watchUrl();

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
    .pb-panel { --bg:#0d1117; width: 400px; max-width: calc(100vw - 32px); max-height: 88vh; overflow-y: auto;
      background: var(--bg); color: var(--text); border-radius: 18px; border: 1px solid var(--frame);
      box-shadow: 0 24px 60px -24px rgba(0,0,0,.55); font-family: system-ui, sans-serif; box-sizing: border-box; }
    .pb-panel * { box-sizing: border-box; }
    .pb-mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    .pb-spacer { flex: 1; }
    .pb-best-text { color: var(--teal) !important; }

    /* Header */
    .pb-header { display: flex; align-items: center; gap: 9px; padding: 12px 14px; border-bottom: 1px solid var(--line); }
    .pb-logo { height: 22px; width: auto; flex: none; display: block; }
    .pb-icon-btn { width: 28px; height: 28px; border-radius: 8px; background: var(--chip); border: 1px solid var(--line);
      color: var(--muted); cursor: pointer; font-size: 13px; display: inline-flex; align-items: center; justify-content: center; }
    .pb-icon-btn:hover { color: var(--text); }
    .pb-close { background: transparent; border: none; color: var(--faint); font-size: 18px; }

    /* Tab bar */
    .pb-tabs { display: flex; gap: 4px; margin: 12px 14px 0; padding: 3px; background: var(--chip); border-radius: 11px; }
    .pb-tab { flex: 1; padding: 8px; border-radius: 8px; border: none; cursor: pointer; font: 700 12px/1 system-ui, sans-serif;
      background: transparent; color: var(--muted); }
    .pb-tab-on { background: var(--bg); color: var(--teal); box-shadow: 0 1px 3px rgba(0,0,0,.22); }

    .pb-content { padding-bottom: 4px; }
    .pb-loading { padding: 26px 16px; color: var(--faint); font: 500 12px/1.4 system-ui, sans-serif; text-align: center; }

    /* Status */
    /* Status banner. Gutters match the cards (16px) so it reads as part of the
       column rather than floating. Visibility is class-driven rather than :empty
       because the banner has icon/text children even when idle. */
    .pb-status { display: none; }
    .pb-status-on { display: flex; align-items: flex-start; gap: 8px;
      margin: 10px 16px 0; padding: 9px 11px; border-radius: 11px;
      border: 1px solid transparent; font: 500 11.5px/1.45 system-ui, sans-serif;
      word-break: break-word; }
    .pb-status-icon { flex: none; font-size: 11px; line-height: 1.45; }
    .pb-status-text { flex: 1; min-width: 0; }
    .pb-info { background: var(--chip); border-color: var(--line); color: var(--muted); }
    .pb-success { background: var(--tealdim); border-color: var(--goodln); color: var(--teal); }
    .pb-error { background: var(--redbg); border-color: var(--redln); color: var(--red); }

    /* Buttons */
    .pb-btn { border: none; cursor: pointer; border-radius: 11px; font: 700 12.5px/1 system-ui, sans-serif; padding: 11px 14px; color: var(--text); background: var(--chip); }
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
    .pb-thumb-label { font: 600 8px/1 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--faint); letter-spacing: .05em; }

    /* Domain pill */
    .pb-domain { display: flex; align-items: center; gap: 6px; margin-top: 5px; }
    .pb-domain-dot { width: 6px; height: 6px; border-radius: 2px; background: var(--teal); }
    .pb-domain-text { font: 500 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--muted); }
    .pb-pill { display: inline-flex; align-items: center; gap: 6px; padding: 5px 10px; border-radius: 999px; font: 600 11px/1 system-ui, sans-serif; }
    .pb-pill-good { background: var(--tealdim); border: 1px solid var(--goodln); color: var(--teal); }
    .pb-pill-neutral { background: var(--chip); border: 1px solid var(--line); color: var(--muted); }
    .pb-pill-icon { font-size: 11px; }

    /* Track tab */
    .pb-track-id { display: flex; gap: 12px; padding: 14px 16px 4px; }
    .pb-track-meta { flex: 1; min-width: 0; }
    .pb-track-title { font: 700 13.5px/1.35 system-ui, sans-serif; color: var(--text); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .pb-detect-card { margin: 12px 16px 0; padding: 12px 14px; border-radius: 14px; background: var(--card); border: 1px solid var(--line); display: flex; align-items: center; gap: 12px; }
    .pb-detect-price { font: 800 22px/1 system-ui, sans-serif; letter-spacing: -.02em; color: var(--text); }
    .pb-detect-sub { font: 500 10.5px/1 system-ui, sans-serif; color: var(--faint); margin-top: 5px; }
    .pb-track-actions { padding: 14px 16px 6px; display: flex; flex-direction: column; gap: 8px; }
    .pb-row2 { display: flex; gap: 8px; }
    .pb-row2 .pb-btn { flex: 1; padding: 10px; }
    .pb-inline-note { margin: 2px 16px 12px; background: none; border: none; color: var(--muted); font: 500 11.5px/1.4 system-ui, sans-serif; cursor: pointer; text-align: left; padding: 0; }
    .pb-link-text { color: var(--teal); font-weight: 700; }

    /* Insights tab */
    .pb-ins-id { display: flex; gap: 11px; padding: 14px 16px 10px; align-items: center; }
    .pb-ins-meta { flex: 1; min-width: 0; }
    .pb-ins-title { font: 700 12.5px/1.3 system-ui, sans-serif; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .pb-ins-sub { font: 500 10.5px/1 system-ui, sans-serif; color: var(--faint); margin-top: 4px; }

    /* Verdict card */
    .pb-verdict { margin: 0 16px 12px; padding: 12px 13px; border-radius: 14px; background: var(--tealdim); border: 1px solid var(--goodln); }
    .pb-verdict-head { display: flex; align-items: center; gap: 9px; }
    .pb-verdict-icon { flex: none; width: 26px; height: 26px; border-radius: 8px; background: var(--teal); color: var(--onTeal); display: flex; align-items: center; justify-content: center; font: 800 14px/1 system-ui, sans-serif; }
    .pb-verdict-headline { font: 800 14.5px/1.15 system-ui, sans-serif; letter-spacing: -.01em; color: var(--text); }
    .pb-verdict-detail { font: 500 11.5px/1.45 system-ui, sans-serif; color: var(--muted); margin-top: 8px; }
    .pb-verdict-caveat { font: 500 10.5px/1.4 system-ui, sans-serif; color: var(--amber); margin-top: 7px; }
    .pb-verdict-cta { width: 100%; margin-top: 11px; padding: 10px; border-radius: 10px; background: var(--teal); border: none; color: var(--onTeal); font: 700 12.5px/1 system-ui, sans-serif; cursor: pointer; }

    /* "You're here" card */
    .pb-here-card { margin: 0 16px 12px; padding: 12px 13px; border-radius: 14px; background: var(--card); border: 1px solid var(--line); }
    .pb-here-head { display: flex; align-items: center; gap: 8px; }
    .pb-here-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--muted); }
    .pb-here-label { font: 700 9px/1 system-ui, sans-serif; letter-spacing: .07em; text-transform: uppercase; color: var(--faint); }
    .pb-here-store { font: 600 11px/1 system-ui, sans-serif; color: var(--muted); }
    .pb-here-priceline { display: flex; align-items: baseline; gap: 6px; margin-top: 7px; }
    .pb-here-price { font: 800 24px/1 system-ui, sans-serif; letter-spacing: -.02em; color: var(--text); }
    .pb-here-sub { font: 500 10px/1 system-ui, sans-serif; color: var(--faint); }
    .pb-here-stats { display: flex; gap: 8px; margin-top: 10px; }
    .pb-chip { flex: 1; padding: 7px 9px; border-radius: 9px; background: var(--chip); }
    .pb-chip-label { font: 500 8.5px/1 system-ui, sans-serif; color: var(--faint); text-transform: uppercase; letter-spacing: .06em; }
    .pb-chip-value { font: 700 12px/1 system-ui, sans-serif; color: var(--text); margin-top: 4px; }

    .pb-spark-wrap { margin: 10px 0 2px; overflow: hidden; }
    .pb-spark { width: 100%; height: 40px; display: block; }

    .pb-stores { padding: 2px 16px 4px; display: flex; flex-direction: column; }
    .pb-store-row { display: flex; align-items: center; gap: 10px; padding: 8px 2px; border-bottom: 1px solid var(--line); }
    .pb-store-link { cursor: pointer; }
    .pb-store-link:hover { opacity: .82; }
    .pb-store-dir { font-size: 13px; width: 14px; flex: none; }
    .pb-store-price { font: 800 15px/1 system-ui, sans-serif; color: var(--text); }
    .pb-store-name { font: 600 12px/1 system-ui, sans-serif; color: var(--muted); }
    .pb-badge { font: 700 9px/1 system-ui, sans-serif; letter-spacing: .06em; text-transform: uppercase; padding: 3px 6px; border-radius: 5px; }
    .pb-badge-best { color: var(--teal); background: var(--tealdim); }

    .pb-callout { margin: 10px 16px 0; padding: 9px 11px; border-radius: 11px; display: flex; align-items: center; gap: 8px; }
    .pb-callout-good { background: var(--tealdim); color: var(--teal); }
    .pb-callout-warn { background: var(--amberdim); color: var(--amber); }
    .pb-callout-icon { font-size: 12px; }
    .pb-callout-text { font: 700 11.5px/1.3 system-ui, sans-serif; }

    .pb-allstats { display: flex; gap: 8px; padding: 12px 16px 16px; }
    .pb-allstat { flex: 1; padding: 9px 11px; border-radius: 11px; background: var(--card); border: 1px solid var(--line); }
    .pb-allstat-label { font: 500 9px/1 system-ui, sans-serif; color: var(--faint); text-transform: uppercase; letter-spacing: .06em; }
    .pb-allstat-value { font: 700 13px/1 system-ui, sans-serif; color: var(--text); margin-top: 5px; }

    .pb-open-link { display: block; padding: 0 16px 16px; font: 700 11.5px/1 system-ui, sans-serif; color: var(--teal); text-decoration: none; }

    /* Empty states */
    .pb-empty { padding: 26px 22px; text-align: center; }
    .pb-empty-icon { font-size: 26px; color: var(--faint); }
    .pb-empty-title { font: 700 14px/1.2 system-ui, sans-serif; color: var(--text); margin-top: 8px; }
    .pb-empty-text { font: 500 12px/1.5 system-ui, sans-serif; color: var(--muted); margin: 6px 0 16px; }

    /* Tune tab */
    .pb-tune-head { display: flex; align-items: center; gap: 8px; padding: 14px 16px 10px; }
    .pb-tune-title { font: 800 13px/1 system-ui, sans-serif; letter-spacing: -.01em; color: var(--text); }
    .pb-storename { display: flex; flex-direction: column; gap: 5px; padding: 0 16px 10px; }
    .pb-storename .pb-input { width: 100%; }
    .pb-subtabs { display: flex; gap: 4px; margin: 0 16px; padding: 3px; background: var(--chip); border-radius: 10px; }
    .pb-subtab { flex: 1; padding: 7px; border-radius: 8px; border: none; cursor: pointer; font: 600 11.5px/1 system-ui, sans-serif; background: transparent; color: var(--muted); }
    .pb-subtab-on { background: var(--card); color: var(--text); box-shadow: 0 1px 2px rgba(0,0,0,.18); }
    .pb-tune-body { padding: 12px 16px 4px; display: flex; flex-direction: column; gap: 10px; }
    .pb-field-tag { font: 700 9.5px/1 system-ui, sans-serif; letter-spacing: .08em; color: var(--faint); text-transform: uppercase; }

    .pb-auto-field { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 12px; background: var(--card); border: 1px solid var(--line); }
    .pb-auto-field .pb-field-tag { width: 44px; flex: none; }
    .pb-auto-meta { flex: 1; min-width: 0; }
    .pb-auto-value { font: 600 12.5px/1.3 system-ui, sans-serif; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .pb-auto-value.pb-miss { color: var(--faint); font-style: italic; }
    .pb-auto-src { display: flex; align-items: center; gap: 6px; margin-top: 3px; font-size: 10px; color: var(--muted); }
    .pb-dot-sep { width: 3px; height: 3px; border-radius: 50%; background: var(--faint); }
    .pb-conf { display: inline-flex; align-items: center; gap: 4px; }
    .pb-conf-dot { width: 6px; height: 6px; border-radius: 50%; }
    .pb-edit-btn { flex: none; padding: 5px 10px; border-radius: 8px; background: transparent; border: 1px solid var(--line); color: var(--muted); font: 600 11px/1 system-ui, sans-serif; cursor: pointer; }

    .pb-manual-field { padding: 11px 12px; border-radius: 12px; background: var(--card); border: 1px solid var(--line); }
    .pb-manual-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
    .pb-pick-btn { padding: 5px 9px; border-radius: 7px; cursor: pointer; font: 600 10.5px/1 system-ui, sans-serif; background: transparent; color: var(--muted); border: 1px solid var(--line); }
    .pb-pick-on { background: var(--teal); color: var(--onTeal); border-color: var(--teal); }
    .pb-manual-controls { display: flex; gap: 7px; align-items: stretch; }
    .pb-select-wrap { position: relative; flex: none; }
    .pb-select { appearance: none; padding: 8px 26px 8px 10px; border-radius: 9px; background: var(--chip); border: 1px solid var(--line); color: var(--text); font: 600 11px/1 system-ui, sans-serif; cursor: pointer; }
    .pb-select-caret { position: absolute; right: 9px; top: 50%; transform: translateY(-50%); pointer-events: none; color: var(--faint); font-size: 9px; }
    .pb-input { flex: 1; min-width: 0; padding: 8px 10px; border-radius: 9px; background: var(--input); border: 1px solid var(--line); color: var(--text); font-size: 11.5px; outline: none; }
    .pb-input:disabled { opacity: .45; }
    .pb-match { display: flex; align-items: center; gap: 7px; margin-top: 8px; padding: 7px 10px; border-radius: 8px; }
    .pb-match-idle { background: var(--chip); border: 1px solid var(--line); color: var(--faint); }
    .pb-match-ok { background: var(--tealdim); border: 1px solid var(--goodln); color: var(--teal); }
    .pb-match-bad { background: var(--redbg); border: 1px solid var(--redln); color: var(--red); }
    .pb-match-icon { font-size: 11px; }
    .pb-match-tag { font: 600 10px/1 system-ui, sans-serif; letter-spacing: .04em; text-transform: uppercase; opacity: .8; }
    .pb-match-text { font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; }

    .pb-select-wide { width: 100%; }
    .pb-select-wide .pb-select { width: 100%; }
    .pb-hint { font: 500 10.5px/1.4 system-ui, sans-serif; color: var(--faint); margin-top: 5px; }
    .pb-heal-btn { margin-top: 2px; font-weight: 600; }
    .pb-tune-foot { display: flex; gap: 8px; padding: 12px 16px 16px; }
    /* Save is still clickable when blocked — it explains why rather than going dead. */
    .pb-btn-blocked { background: var(--chip); color: var(--faint); border: 1px dashed var(--redln); }
    .pb-retry { flex: none; align-self: center; margin-left: 2px; padding: 3px 8px; border-radius: 6px; cursor: pointer; background: var(--chip);
      border: 1px solid var(--line); color: var(--text); font: 600 10.5px/1 system-ui, sans-serif; }
    .pb-retry:hover { border-color: var(--teal); color: var(--teal); }
  `;
})();
