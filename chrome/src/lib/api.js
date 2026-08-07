// Thin client for the PriceBuddy HTTP API.
//
// Only two endpoints are needed for the store helper:
//   GET  /api/user            -> verify the token (ability: user:detail)
//   POST /api/meta-extraction -> live-test a scrape strategy (ability: meta-extraction:extract)
//
// Tokens are minted in PriceBuddy under the user's profile / API key management,
// scoped with the abilities above. See README.md.

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
   * @param {RequestInit} [options]
   * @returns {Promise<any>}
   */
  async request(path, options = {}) {
    if (!this.configured) {
      throw new Error('PriceBuddy is not configured. Open the extension options to set an API URL and token.');
    }

    const url = `${this.apiUrl}${path}`;
    let response;
    try {
      response = await fetch(url, {
        ...options,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token}`,
          ...(options.headers || {}),
        },
      });
    } catch (err) {
      throw new Error(`Could not reach ${this.apiUrl}. Check the URL and that the instance is online. (${err.message})`);
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
   * Run a live extraction. Passing `store` lets the caller test a draft
   * scrape strategy without saving anything in PriceBuddy.
   *
   * @param {string} pageUrl
   * @param {object} [store] partial store config (name, domains, settings, scrape_strategy)
   * @returns {Promise<{title:?string, price:?number, image:?string, description:?string, availability:?string, store:object}>}
   */
  async metaExtraction(pageUrl, store) {
    const payload = { url: pageUrl };
    if (store && Object.keys(store).length > 0) {
      payload.store = store;
    }

    const result = await this.request('/api/meta-extraction', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    // The endpoint wraps the resource in a `data` key.
    return result && result.data ? result.data : result;
  }

  /**
   * List tracked products. The transformer embeds a `price_cache` array where
   * each entry carries a `url` and a `history` map of {date: price} — enough to
   * render a price-history sparkline without a dedicated endpoint.
   *
   * @param {Record<string,string|number>} [params]
   * @returns {Promise<{data: Array<object>}>}
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
   * @param {string} domain
   * @returns {Promise<{data: Array<object>}>}
   */
  async getStoreByDomain(domain) {
    const qs = new URLSearchParams({ 'filter[domains]': domain }).toString();
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
