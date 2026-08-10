// Thin client for the PriceBuddy HTTP API.
//
// Only two endpoints are needed for the store helper:
//   GET  /api/user            -> verify the token (ability: user:detail)
//   POST /api/meta-extraction -> live-test a scrape strategy (ability: meta-extraction:extract)
//
// Tokens are minted in PriceBuddy under the user's profile / API key management,
// scoped with the abilities above. See README.md.

// Without a timeout a hung request leaves the panel on a spinner with no way
// out. That was not hypothetical: before PriceBuddy bounded it, an unreachable
// AI healing provider blocked `meta-extraction` for that provider's whole
// timeout — 120s on a default Ollama config.
//
// The extraction budget is now the server's to decide and it publishes it as
// `limits.meta_extraction_timeout_seconds` in /api/client-config, so callers
// pass `timeoutMs` from that rather than hardcoding a number here. This value
// is only the fallback for an instance that publishes no limit.
const DEFAULT_TIMEOUT_MS = 15_000;
const EXTRACTION_FALLBACK_TIMEOUT_MS = 35_000;

export class PriceBuddyClient {
  /**
   * @param {{apiUrl: string, token: string}} config
   */
  constructor({ apiUrl, token }) {
    this.apiUrl = String(apiUrl || '').replace(/\/+$/, '');
    this.token = String(token || '').trim();
  }

  get configured() {
    return this.apiUrl.length > 0 && this.token.length > 0;
  }

  /**
   * @param {string} path
   * @param {RequestInit & {timeoutMs?: number}} [options]
   * @returns {Promise<any>}
   */
  async request(path, options = {}) {
    if (!this.configured) {
      throw new Error('PriceBuddy is not configured. Open the extension options to set an API URL and token.');
    }

    const { timeoutMs = DEFAULT_TIMEOUT_MS, ...init } = options;
    const url = `${this.apiUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response;
    try {
      response = await fetch(url, {
        ...init,
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token}`,
          ...(init.headers || {}),
        },
      });
    } catch (err) {
      if (err.name === 'AbortError') {
        const timeout = new Error(
          `PriceBuddy didn't respond within ${Math.round(timeoutMs / 1000)}s. It may still be working — try again in a moment.`,
        );
        timeout.status = 0;
        timeout.timedOut = true;
        throw timeout;
      }
      throw new Error(`Could not reach ${this.apiUrl}. Check the URL and that the instance is online. (${err.message})`);
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();
    let body;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }

    if (!response.ok) {
      const message = (body && (body.message || body.error)) || `HTTP ${response.status}`;
      const error = new Error(message);
      error.status = response.status;
      error.body = body;
      throw error;
    }

    return body;
  }

  /**
   * Verify the token and return the authenticated account.
   * @returns {Promise<{id:number,name:string,email:string}>}
   */
  async getUser() {
    return this.request('/api/user');
  }

  /**
   * Which server-side matching features this instance supports, so the panel can
   * choose between one request and paging thousands of products.
   *
   * Gated on the `client-config:read` ability, so a token minted before that
   * ability existed gets a 403 while an older instance gets a 404. Both mean the
   * same thing to callers — no capabilities, use the fallbacks — so neither is
   * special-cased here; `loadCapabilities()` in the panel treats any failure
   * alike.
   *
   * @returns {Promise<{data:{capabilities:Record<string,boolean>, app_version:string}}>}
   */
  async getClientConfig() {
    return this.request('/api/client-config');
  }

  /**
   * Run a live extraction. Passing `store` lets the caller test a draft
   * scrape strategy without saving anything in PriceBuddy.
   *
   * @param {string} pageUrl
   * @param {object} [store] partial store config (name, domains, settings, scrape_strategy)
   * @returns {Promise<{title:?string, price:?number, image:?string, description:?string, availability:?string, store:object}>}
   */
  async metaExtraction(pageUrl, store, options = {}) {
    const payload = { url: pageUrl };
    if (store && Object.keys(store).length > 0) {
      payload.store = store;
    }
    // Healing defaults to false server-side: it's slow, best-effort, and can
    // return a *different* strategy than the draft under test. Opt in only for
    // an explicit "let the AI work it out" action.
    if (options.heal) {
      payload.heal = true;
    }

    const result = await this.request('/api/meta-extraction', {
      method: 'POST',
      body: JSON.stringify(payload),
      timeoutMs: options.timeoutMs || EXTRACTION_FALLBACK_TIMEOUT_MS,
    });

    // The endpoint wraps the resource in a `data` key.
    return result && result.data ? result.data : result;
  }

  /**
   * List tracked products. The transformer embeds a `price_cache` array where
   * each entry carries a `url` and a `history` map of {date: price} — enough to
   * render a price-history sparkline without a dedicated endpoint.
   *
   * `price_cache` is also the bulk of the response: the history map grows one
   * entry per day per store, unbounded. Callers that only need to identify a
   * product should pass a sparse fieldset and the `urls` include instead:
   *
   *     listProducts({ 'fields[products]': 'id', include: 'urls', per_page: 100 })
   *
   * `per_page` is capped at 100 server-side, and there is no URL filter, so
   * locating a product by URL currently means paging. See `findTrackedProductId`
   * in the panel; it collapses to one request if PriceBuddy gains `filter[url]`.
   *
   * @param {Record<string,string|number>} [params]
   * @returns {Promise<{data: Array<object>, meta?: {last_page?: number}}>}
   */
  async listProducts(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return this.request(`/api/products${qs ? `?${qs}` : ''}`);
  }

  /**
   * Fetch a single product. Pass `{ include: 'insights' }` to embed the
   * materialized insights block (price stats, percentile, deal score, daily-best
   * series) used by the panel's Insights tab.
   *
   * @param {number} id
   * @param {Record<string,string|number>} [params]
   * @returns {Promise<{data: object}>}
   */
  async getProduct(id, params = {}) {
    const qs = new URLSearchParams(params).toString();
    return this.request(`/api/products/${id}${qs ? `?${qs}` : ''}`);
  }

  /**
   * Track a new product. `create_store: true` lets PriceBuddy auto-build a
   * store config from the URL when no store matches the domain yet.
   *
   * @param {{title:string, url:string, image?:string, favourite?:boolean, notify_price?:number}} payload
   * @returns {Promise<{data: object}>}
   */
  async createProduct(payload) {
    return this.request('/api/products', {
      method: 'POST',
      body: JSON.stringify({ create_store: true, ...payload }),
    });
  }

  /**
   * Look up stores whose domain matches. PriceBuddy filters via Spatie
   * QueryBuilder; the list transformer returns the model's `scrape_strategy`
   * attribute (not `scrape_settings`). Returns `{data: [...]}` (possibly empty).
   *
   * Two filters exist and they are not the same:
   *   `filter[domain]`  (exact)   normalises the host server-side — pass
   *                               `location.host` verbatim, port and all.
   *   `filter[domains]` (partial) a LIKE; callers must tighten the results
   *                               themselves. Older instances have only this.
   *
   * @param {string} domain
   * @param {boolean} [exact] use the exact filter (needs a recent instance)
   * @returns {Promise<{data: Array<object>}>}
   */
  async getStoreByDomain(domain, exact = false) {
    const qs = new URLSearchParams(
      exact ? { 'filter[domain]': domain } : { 'filter[domains]': domain },
    ).toString();
    return this.request(`/api/stores?${qs}`);
  }

  /**
   * Create a store. Requires name, domains[].domain, settings.scraper_service,
   * and a scrape_strategy entry (type required) for title/price/image.
   *
   * @param {object} payload
   * @returns {Promise<{data: object}>}
   */
  async createStore(payload) {
    return this.request('/api/stores', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  /**
   * Update an existing store. Fields are optional; strategy values are only
   * required for non-schema_org types.
   *
   * @param {number} id
   * @param {object} payload
   * @returns {Promise<{data: object}>}
   */
  async updateStore(id, payload) {
    return this.request(`/api/stores/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  }
}
