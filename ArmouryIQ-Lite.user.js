// ==UserScript==
// @name         ArmouryIQ Lite
// @namespace    https://www.torn.com/
// @version      0.1.5
// @description  Private local-first faction armoury intelligence for TornPDA and userscript managers.
// @author       ArmouryIQ
// @match        https://www.torn.com/factions.php*
// @connect      api.torn.com
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_setClipboard
// @grant        GM_xmlhttpRequest
// @run-at       document-idle
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';

  const APP = 'ArmouryIQ Lite';
  const VERSION = '0.1.5';
  const ROOT_ID = 'aiql-root';
  const STYLE_ID = 'aiql-style';
  const PREFIX = 'aiql_';
  const DAY = 86400000;
  const CATEGORIES = ['weapons','armor','temporary','medical','consumables','drugs','boosters','utilities','loot'];
  const CUSTOM_KEY_URL = 'https://www.torn.com/preferences.php#tab=api?step=addNewKey&title=ArmouryIQ%20Lite&faction=inventory&market=itemmarket&torn=items&key=info';

  const KEYS = {
    api: PREFIX + 'api_key',
    whitelist: PREFIX + 'whitelist_v1',
    catalog: PREFIX + 'catalog_v1',
    live: PREFIX + 'live_v1',
    loans: PREFIX + 'loans_v1',
    history: PREFIX + 'history_v1',
    prices: PREFIX + 'prices_v1',
    state: PREFIX + 'state_v1'
  };
  const CATALOG_CHUNK_PREFIX = PREFIX + 'catalog_chunk_';

  const state = {
    tab: 'dashboard',
    busy: false,
    status: '',
    lastError: '',
    search: '',
    whitelistOnly: false
  };

  const get = (key, fallback) => {
    const value = GM_getValue(key, undefined);
    return value === undefined || value === null ? fallback : value;
  };
  const set = (key, value) => GM_setValue(key, value);
  const del = key => GM_deleteValue(key);
  const num = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const money = value => '$' + Math.round(num(value)).toLocaleString();
  const qty = value => Math.round(num(value)).toLocaleString();
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
  const dateText = value => value ? new Date(value).toLocaleString() : 'Never';
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function loadCatalog() {
    const manifest = get(KEYS.catalog, {});
    if (manifest?.format !== 'chunks-v1') return manifest || {};
    const catalog = {};
    for (let index = 0; index < num(manifest.chunks); index++) {
      const chunk = get(CATALOG_CHUNK_PREFIX + index, []);
      (Array.isArray(chunk) ? chunk : []).forEach(row => {
        if (!Array.isArray(row) || !row[0]) return;
        const [id, name, category, type, marketValue, lastSeen] = row;
        catalog[String(id)] = {key:String(id), id:String(id), name:String(name || ''), category:String(category || 'other'), type:String(type || category || 'Other'), amount:0, market_value:num(marketValue), lastSeen:num(lastSeen)};
      });
    }
    return catalog;
  }

  function saveCatalog(catalog) {
    const previous = get(KEYS.catalog, {});
    const rows = Object.values(catalog).map(item => [String(item.id || item.key), item.name, item.category, item.type, num(item.market_value), num(item.lastSeen)]);
    const size = 175;
    const chunks = Math.ceil(rows.length / size);
    for (let index = 0; index < chunks; index++) set(CATALOG_CHUNK_PREFIX + index, rows.slice(index * size, (index + 1) * size));
    const oldChunks = previous?.format === 'chunks-v1' ? num(previous.chunks) : 0;
    for (let index = chunks; index < oldChunks; index++) del(CATALOG_CHUNK_PREFIX + index);
    set(KEYS.catalog, {format:'chunks-v1', chunks, count:rows.length, updatedAt:Date.now()});
  }

  function isArmouryPage() {
    return location.pathname.endsWith('/factions.php') && location.hash.includes('tab=armoury');
  }

  function apiRequest(url) {
    const apiKey = String(get(KEYS.api, '') || '').trim();
    if (!apiKey) return Promise.reject(new Error('No ArmouryIQ API key is saved.'));
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        headers: {
          Authorization: 'ApiKey ' + apiKey,
          'User-Agent': 'ArmouryIQ-Lite/' + VERSION
        },
        timeout: 30000,
        onload: response => {
          let body;
          try { body = JSON.parse(response.responseText); }
          catch (_) { reject(new Error('Torn returned an unreadable response (HTTP ' + response.status + ').')); return; }
          if (response.status < 200 || response.status >= 300 || body?.error) {
            reject(new Error(body?.error?.error || body?.error?.message || ('HTTP ' + response.status)));
            return;
          }
          resolve(body);
        },
        ontimeout: () => reject(new Error('The Torn API request timed out.')),
        onerror: () => reject(new Error('The Torn API request failed.'))
      });
    });
  }

  async function fetchCategory(category) {
    let offset = 0;
    const limit = 100;
    const items = [];
    let inventoryTimestamp = 0;
    while (offset < 10000) {
      const url = 'https://api.torn.com/v2/faction/inventory?cat=' + encodeURIComponent(category) +
        '&limit=' + limit + '&offset=' + offset + '&comment=' + encodeURIComponent('ArmouryIQ Lite');
      const body = await apiRequest(url);
      const rawInventory = body.inventory ?? body.data?.inventory ?? body.response?.inventory;
      const page = Array.isArray(rawInventory)
        ? rawInventory
        : Object.values(rawInventory || {});
      const savedState = get(KEYS.state, {});
      const debug = savedState.apiDebug || {categories: {}};
      debug.categories = debug.categories || {};
      debug.categories[category] = {
        keys: Object.keys(body || {}).slice(0, 12),
        rawType: Array.isArray(rawInventory) ? 'array' : typeof rawInventory,
        count: page.length
      };
      set(KEYS.state, {...savedState, apiDebug: debug});
      page.forEach(item => items.push({...item, _category: category}));
      inventoryTimestamp = Math.max(inventoryTimestamp, num(body.inventory_timestamp));
      offset += page.length;
      const total = Number(body?._metadata?.total);
      if (!page.length || page.length < limit || (Number.isFinite(total) && offset >= total)) break;
    }
    return {items, inventoryTimestamp};
  }

  async function fetchItemCatalog() {
    const body = await apiRequest(
      'https://api.torn.com/v2/torn/items?cat=All&sort=ASC&comment=' +
      encodeURIComponent('ArmouryIQ Lite item catalog')
    );
    const sourceItems = body.items ?? body.data?.items ?? body.response?.items;
    const rawItems = Array.isArray(sourceItems)
      ? sourceItems
      : Object.entries(sourceItems || {}).map(([id, item]) => ({...item, id: item?.id ?? id}));
    const parsed = rawItems
      .filter(item => item && item.id && item.name && item.is_masked !== true)
      .map(item => ({
        id: String(item.id),
        name: String(item.name),
        category: String(item.type || 'Other').toLowerCase(),
        type: String(item.type || 'Other'),
        amount: 0,
        market_value: num(item?.value?.market_price)
      }));
    const savedState = get(KEYS.state, {});
    const debug = savedState.apiDebug || {categories: {}};
    debug.catalog = {
      keys: Object.keys(body || {}).slice(0, 12),
      rawType: Array.isArray(sourceItems) ? 'array' : typeof sourceItems,
      rawCount: rawItems.length,
      parsedCount: parsed.length
    };
    set(KEYS.state, {...savedState, apiDebug: debug});
    return parsed;
  }

  function normalizeInventory(rawItems) {
    const combined = {};
    const loans = {};
    rawItems.forEach(item => {
      const id = String(item.id ?? '');
      const name = String(item.name || ('Item ' + id));
      const category = String(item._category || item.category || item.type || 'other');
      const key = id || name.toLowerCase();
      if (!combined[key]) combined[key] = {id, name, category, amount: 0, type: item.type || category};
      combined[key].amount += num(item.amount);
      const memberId = item?.loaned?.id;
      const memberName = item?.loaned?.name;
      if (memberId && memberName) {
        const loanKey = memberId + '|' + key;
        if (!loans[loanKey]) loans[loanKey] = {
          memberId: String(memberId), memberName: String(memberName), itemId: id,
          itemName: name, category, type: item.type || category, amount: 0,
          uids: []
        };
        loans[loanKey].amount += Math.max(1, num(item.amount));
        (Array.isArray(item.uids) ? item.uids : []).forEach(uid => {
          const value = typeof uid === 'object' ? (uid.uid ?? uid.id) : uid;
          if (value !== undefined && value !== null) loans[loanKey].uids.push(String(value));
        });
      }
    });
    return {inventory: Object.values(combined), loans: Object.values(loans)};
  }

  function mergeCatalog(inventory) {
    const catalog = loadCatalog();
    const whitelist = get(KEYS.whitelist, {});
    const now = Date.now();
    inventory.forEach(item => {
      const key = item.id || item.name.toLowerCase();
      catalog[key] = {...catalog[key], ...item, key, lastSeen: now};
      if (whitelist[key]) {
        whitelist[key].name = item.name;
        whitelist[key].category = item.category;
        whitelist[key].id = item.id;
      }
    });
    saveCatalog(catalog);
    set(KEYS.whitelist, whitelist);
  }

  function appendSnapshot(inventory, sourceTimestamp) {
    const whitelist = get(KEYS.whitelist, {});
    const stocks = {};
    const byKey = Object.fromEntries(inventory.map(item => [item.id || item.name.toLowerCase(), item]));
    Object.values(whitelist).filter(item => item.enabled).forEach(item => {
      stocks[item.key] = num(byKey[item.key]?.amount);
    });
    let history = get(KEYS.history, []);
    const now = Date.now();
    const last = history[history.length - 1];
    if (last && now - num(last.ts) < 15 * 60 * 1000) history[history.length - 1] = {ts: now, sourceTimestamp, stocks};
    else history.push({ts: now, sourceTimestamp, stocks});
    history = history.filter(row => now - num(row.ts) <= 90 * DAY).slice(-720);
    set(KEYS.history, history);
  }

  async function syncInventory() {
    if (state.busy) return;
    state.busy = true;
    state.status = 'Synchronizing armoury…';
    state.lastError = '';
    render();
    try {
      state.status = 'Loading Torn item catalog…';
      renderStatusOnly();
      const catalogItems = await fetchItemCatalog();
      mergeCatalog(catalogItems);
      const catalogPrices = get(KEYS.prices, {});
      catalogItems.forEach(item => {
        if (item.market_value > 0 && !catalogPrices[item.id]) {
          catalogPrices[item.id] = {price: item.market_value, updatedAt: Date.now(), source: 'torn-items'};
        }
      });
      set(KEYS.prices, catalogPrices);

      const results = [];
      for (const category of CATEGORIES) {
        state.status = 'Loading ' + category + '…';
        renderStatusOnly();
        results.push(await fetchCategory(category));
        await sleep(120);
      }
      const allItems = results.flatMap(result => result.items);
      const newest = Math.max(0, ...results.map(result => result.inventoryTimestamp));
      const normalized = normalizeInventory(allItems);
      const live = {updatedAt: Date.now(), sourceTimestamp: newest, inventory: normalized.inventory};
      set(KEYS.live, live);
      set(KEYS.loans, {updatedAt: Date.now(), loans: normalized.loans});
      mergeCatalog(normalized.inventory);
      appendSnapshot(normalized.inventory, newest);
      set(KEYS.state, {...get(KEYS.state, {}), lastSync: Date.now(), lastSuccess: true, version: VERSION});
      state.status = 'Synchronization complete';
    } catch (error) {
      state.lastError = error.message || String(error);
      state.status = 'Synchronization failed';
      set(KEYS.state, {...get(KEYS.state, {}), lastAttempt: Date.now(), lastSuccess: false, lastError: state.lastError});
    } finally {
      state.busy = false;
      render();
    }
  }

  async function validateKey(key) {
    if (!key) throw new Error('Enter the API key Torn generated for ArmouryIQ.');
    set(KEYS.api, key.trim());
    try {
      await apiRequest('https://api.torn.com/v2/faction/inventory?cat=temporary&limit=1&comment=' + encodeURIComponent('ArmouryIQ Lite key test'));
      set(KEYS.state, {...get(KEYS.state, {}), keyValidatedAt: Date.now()});
      return true;
    } catch (error) {
      del(KEYS.api);
      throw new Error('Key validation failed: ' + error.message);
    }
  }

  async function refreshPrices() {
    if (state.busy) return;
    const tracked = Object.values(get(KEYS.whitelist, {})).filter(item => item.enabled && item.id);
    if (!tracked.length) {
      state.status = 'Whitelist at least one item before refreshing prices.';
      renderStatusOnly();
      return;
    }
    state.busy = true;
    state.lastError = '';
    const prices = get(KEYS.prices, {});
    try {
      for (let index = 0; index < tracked.length; index++) {
        const item = tracked[index];
        state.status = `Refreshing market prices ${index + 1}/${tracked.length}: ${item.name}`;
        renderStatusOnly();
        const body = await apiRequest(`https://api.torn.com/v2/market/${encodeURIComponent(item.id)}/itemmarket?offset=0&comment=${encodeURIComponent('ArmouryIQ Lite prices')}`);
        const market = body.itemmarket || body.item_market || body;
        const listings = Array.isArray(market) ? market : (market.listings || market.itemmarket || []);
        const lowest = listings.map(listing => num(listing.price || listing.cost)).filter(price => price > 0).sort((a, b) => a - b)[0] || 0;
        if (lowest) prices[item.key] = {price: lowest, updatedAt: Date.now(), source: 'itemmarket'};
        await sleep(650);
      }
      set(KEYS.prices, prices);
      state.status = 'Market prices refreshed.';
    } catch (error) {
      state.lastError = 'Price refresh stopped: ' + (error.message || String(error));
    } finally {
      state.busy = false;
      render();
    }
  }

  function usageFor(key, days) {
    const history = get(KEYS.history, []).filter(row => Date.now() - num(row.ts) <= days * DAY);
    if (history.length < 2) return {used: 0, avg: 0, span: 0, samples: history.length};
    let used = 0;
    for (let i = 1; i < history.length; i++) {
      const before = num(history[i - 1].stocks?.[key]);
      const after = num(history[i].stocks?.[key]);
      if (before > after) used += before - after;
    }
    const span = Math.max(0, (history[history.length - 1].ts - history[0].ts) / DAY);
    return {used, avg: span > 0 ? used / span : 0, span, samples: history.length};
  }

  function rows() {
    const whitelist = get(KEYS.whitelist, {});
    const live = get(KEYS.live, {inventory: []});
    const prices = get(KEYS.prices, {});
    const byKey = Object.fromEntries((live.inventory || []).map(item => [item.id || item.name.toLowerCase(), item]));
    return Object.values(whitelist).filter(item => item.enabled).map(item => {
      const current = num(byKey[item.key]?.amount);
      const u7 = usageFor(item.key, 7);
      const u30 = usageFor(item.key, 30);
      const rate = Math.max(u7.avg, u30.avg);
      const learned = u7.span >= 6 ? Math.ceil(rate * Math.max(1, num(item.reserveDays) || 14) * 1.15) : 0;
      const recommended = Math.max(num(item.target), learned);
      const toBuy = item.restock === false ? 0 : Math.max(0, recommended - current);
      const daysRemaining = rate > 0 ? current / rate : null;
      const low = num(item.low) || Math.ceil(num(item.target) * 0.5);
      const critical = num(item.critical) || Math.ceil(num(item.target) * 0.25);
      let status = 'HEALTHY';
      if (current <= critical && num(item.target) > 0) status = 'CRITICAL';
      else if (current <= low && num(item.target) > 0) status = 'LOW';
      else if (u7.span < 6) status = 'LEARNING';
      const price = num(prices[item.key]?.price || byKey[item.key]?.market_value);
      return {...item, current, u7, u30, rate, recommended, toBuy, daysRemaining, low, critical, status, price, cost: toBuy * price};
    }).sort((a, b) => ({CRITICAL:1,LOW:2,LEARNING:3,HEALTHY:4}[a.status] - {CRITICAL:1,LOW:2,LEARNING:3,HEALTHY:4}[b.status]) || a.name.localeCompare(b.name));
  }

  function healthSummary(list) {
    const critical = list.filter(r => r.status === 'CRITICAL').length;
    const low = list.filter(r => r.status === 'LOW').length;
    const score = clamp(100 - critical * 12 - low * 5, 0, 100);
    return {critical, low, score, label: score >= 90 ? 'EXCELLENT' : score >= 75 ? 'GOOD' : score >= 60 ? 'WATCH' : score >= 40 ? 'POOR' : 'CRITICAL'};
  }

  function statusPill(status) {
    const className = String(status).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return '<span class="aiql-pill aiql-' + className + '">' + esc(status) + '</span>';
  }

  function nav() {
    const tabs = [['dashboard','Dashboard'],['alerts','Alerts'],['inventory','Inventory'],['restock','Restock'],['usage','Usage'],['loans','Loans'],['reports','Reports'],['whitelist','Whitelist'],['settings','Settings']];
    return '<div class="aiql-nav">' + tabs.map(([id,label]) => '<button data-aiql-tab="' + id + '" class="' + (state.tab === id ? 'active' : '') + '">' + label + '</button>').join('') + '</div>';
  }

  function setupCard() {
    return `<div class="aiql-card aiql-setup">
      <h3>Connect ArmouryIQ to Torn</h3>
      <p>Create a dedicated custom API key with only the selections ArmouryIQ requests.</p>
      <div class="aiql-actions"><button class="aiql-primary" data-aiql-action="create-key">Create ArmouryIQ API Key</button></div>
      <label>Paste the generated key</label>
      <div class="aiql-key-row"><input id="aiql-key-input" type="password" autocomplete="off" placeholder="API key"><button data-aiql-action="reveal-key">Show</button></div>
      <button class="aiql-primary" data-aiql-action="save-key">Validate & Save Key</button>
      <p class="aiql-muted">The key is stored only in this userscript manager on this device. It is excluded from reports and backups.</p>
    </div>`;
  }

  function dashboard(list) {
    const summary = healthSummary(list);
    const live = get(KEYS.live, {});
    const totalCost = list.reduce((sum, row) => sum + row.cost, 0);
    const totalValue = list.reduce((sum, row) => sum + row.current * row.price, 0);
    const priorities = list.filter(row => row.status === 'CRITICAL' || row.status === 'LOW').slice(0, 8);
    return `<div class="aiql-grid aiql-kpis">
      <div class="aiql-card"><span>Health</span><strong>${summary.score}%</strong><small>${summary.label}</small></div>
      <div class="aiql-card"><span>Critical</span><strong>${summary.critical}</strong><small>Immediate attention</small></div>
      <div class="aiql-card"><span>Low Stock</span><strong>${summary.low}</strong><small>Plan restock</small></div>
      <div class="aiql-card"><span>Tracked</span><strong>${list.length}</strong><small>Whitelisted items</small></div>
      <div class="aiql-card"><span>Restock Cost</span><strong>${money(totalCost)}</strong><small>Known prices only</small></div>
      <div class="aiql-card"><span>Tracked Value</span><strong>${money(totalValue)}</strong><small>Known prices only</small></div>
    </div>
    <div class="aiql-card"><div class="aiql-card-head"><h3>Priority Items</h3><button data-aiql-action="sync" ${state.busy?'disabled':''}>${state.busy?'Syncing…':'Sync Now'}</button></div>
      <div class="aiql-muted">Last sync: ${esc(dateText(live.updatedAt))}</div>
      ${priorities.length ? table(priorities, 'priority') : '<div class="aiql-empty">No low or critical whitelisted items.</div>'}
    </div>`;
  }

  function table(list, mode) {
    const marketLink = row => row.id ? 'https://www.torn.com/page.php?sid=ItemMarket#/market/view=search&itemID=' + encodeURIComponent(row.id) : '#';
    const body = list.map(row => `<tr>
      <td><strong>${esc(row.name)}</strong><small>${esc(row.category)}</small></td>
      <td>${qty(row.current)}</td><td>${qty(row.target)}</td>
      <td>${mode === 'usage' ? row.u7.avg.toFixed(2) + '/day' : qty(row.toBuy)}</td>
      <td>${row.daysRemaining === null ? '—' : row.daysRemaining.toFixed(1) + 'd'}</td>
      <td>${statusPill(row.status)}</td>
      <td><a class="aiql-link" href="${marketLink(row)}" target="_blank">Market</a></td>
    </tr>`).join('');
    return `<div class="aiql-table-wrap"><table><thead><tr><th>Item</th><th>Current</th><th>Target</th><th>${mode === 'usage' ? 'Usage' : 'Need'}</th><th>Remaining</th><th>Status</th><th></th></tr></thead><tbody>${body}</tbody></table></div>`;
  }

  function inventory(list) {
    return `<div class="aiql-card"><div class="aiql-card-head"><h3>Tracked Inventory</h3><button data-aiql-action="sync" ${state.busy?'disabled':''}>Sync Now</button></div>${list.length ? table(list,'inventory') : '<div class="aiql-empty">No items are whitelisted yet. Open Whitelist after syncing.</div>'}</div>`;
  }

  function restock(list) {
    const needed = list.filter(row => row.toBuy > 0);
    const total = needed.reduce((sum,row) => sum + row.cost, 0);
    return `<div class="aiql-card"><div class="aiql-card-head"><h3>Restock Center</h3><div class="aiql-actions"><button data-aiql-action="prices" ${state.busy?'disabled':''}>Refresh Prices</button><button data-aiql-action="copy-restock">Copy List</button></div></div><div class="aiql-banner">${needed.length} item(s) need stock · Estimated ${money(total)}</div>${needed.length ? table(needed,'restock') : '<div class="aiql-empty">All tracked items meet their recommended stock.</div>'}</div>`;
  }

  function alerts(list) {
    const stock = list.filter(row => row.status === 'CRITICAL' || row.status === 'LOW');
    const loanData = get(KEYS.loans, {loans: []});
    const whitelist = get(KEYS.whitelist, {});
    const overLoans = (loanData.loans || []).map(loan => {
      const rule = whitelist[loan.itemId] || Object.values(whitelist).find(item => item.name === loan.itemName);
      if (!rule || rule.loanLimit === '') return null;
      const over = Math.max(0, num(loan.amount) - num(rule.loanLimit));
      return over ? {...loan, over, limit: num(rule.loanLimit)} : null;
    }).filter(Boolean);
    const loanRows = overLoans.map(row => `<tr><td><strong>${esc(row.memberName)}</strong></td><td>${esc(row.itemName)}</td><td>${qty(row.amount)}</td><td>${qty(row.limit)}</td><td>${qty(row.over)}</td></tr>`).join('');
    return `<div class="aiql-card"><h3>Stock Alerts</h3>${stock.length ? table(stock, 'priority') : '<div class="aiql-empty">No low or critical stock alerts.</div>'}</div>
      <div class="aiql-card"><h3>Loan Alerts</h3>${loanRows ? `<div class="aiql-table-wrap"><table><thead><tr><th>Member</th><th>Item</th><th>Loaned</th><th>Limit</th><th>Over</th></tr></thead><tbody>${loanRows}</tbody></table></div>` : '<div class="aiql-empty">No members are over a configured loan limit.</div>'}</div>`;
  }

  function usage(list) {
    return `<div class="aiql-card"><h3>Usage Intelligence</h3><p class="aiql-muted">Local estimates use observed inventory decreases and ignore increases/restocks. Six days of history are required before learned targets activate.</p>${list.length ? table(list,'usage') : '<div class="aiql-empty">Whitelist items and collect snapshots to begin learning.</div>'}</div>`;
  }

  function loans() {
    const data = get(KEYS.loans, {loans: []});
    const whitelist = get(KEYS.whitelist, {});
    const rows = (data.loans || []).map(loan => {
      const rule = whitelist[loan.itemId] || Object.values(whitelist).find(i => i.name === loan.itemName) || {};
      const limit = rule.loanLimit === '' ? null : num(rule.loanLimit);
      const over = limit === null ? null : Math.max(0, num(loan.amount) - limit);
      return {...loan, limit, over, status: over === null ? 'NO LIMIT' : over > 0 ? 'OVER LIMIT' : 'OK'};
    }).sort((a,b) => (b.over || 0) - (a.over || 0) || a.memberName.localeCompare(b.memberName));
    const html = rows.map(row => `<tr><td><strong>${esc(row.memberName)}</strong></td><td>${esc(row.itemName)}</td><td>${qty(row.amount)}</td><td>${row.limit === null?'—':qty(row.limit)}</td><td>${row.over === null?'—':qty(row.over)}</td><td>${statusPill(row.status)}</td></tr>`).join('');
    return `<div class="aiql-card"><h3>Loan Monitor</h3><p class="aiql-muted">Loan information is taken from the live faction inventory response.</p>${rows.length ? `<div class="aiql-table-wrap"><table><thead><tr><th>Member</th><th>Item</th><th>Qty</th><th>Limit</th><th>Over</th><th>Status</th></tr></thead><tbody>${html}</tbody></table></div>` : '<div class="aiql-empty">No active loans detected in the latest sync.</div>'}</div>`;
  }

  function itemSuggestionsHTML(query) {
    const term = String(query || '').trim().toLowerCase();
    if (term.length < 3) return '<div class="aiql-picker-hint">Type at least 3 letters to see matching items.</div>';
    const whitelist = get(KEYS.whitelist, {});
    const matches = Object.values(loadCatalog())
      .filter(item => !whitelist[item.key]?.enabled && (item.name.toLowerCase().includes(term) || item.category.toLowerCase().includes(term)))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 12);
    if (!matches.length) return '<div class="aiql-picker-hint">No untracked items match that search.</div>';
    return matches.map(item => `<button type="button" class="aiql-suggestion" data-aiql-add-item="${esc(item.key)}"><span>${esc(item.name)}</span><small>${esc(item.category)}</small><b>+ Add</b></button>`).join('');
  }

  function whitelistUI() {
    const catalog = loadCatalog();
    const whitelist = get(KEYS.whitelist, {});
    const live = get(KEYS.live, {inventory: []});
    const stocks = Object.fromEntries((live.inventory || []).map(i => [i.id || i.name.toLowerCase(), num(i.amount)]));
    const items = Object.values(whitelist).filter(item => item.enabled);
    items.sort((a,b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
    const rows = items.map(item => `<div class="aiql-rule" data-key="${esc(item.key)}">
      <label class="aiql-toggle"><input type="checkbox" data-field="enabled" ${item.enabled?'checked':''}><span></span></label>
      <div class="aiql-rule-name"><strong>${esc(item.name)}</strong><small>${esc(item.category)} · Current ${qty(stocks[item.key])}</small></div>
      <label>Target<input type="number" min="0" data-field="target" value="${num(item.target)}"></label>
      <label>Low<input type="number" min="0" data-field="low" value="${num(item.low)}"></label>
      <label>Critical<input type="number" min="0" data-field="critical" value="${num(item.critical)}"></label>
      <label>Reserve Days<input type="number" min="1" data-field="reserveDays" value="${num(item.reserveDays)||14}"></label>
      <label>Loan Limit<input type="number" min="0" data-field="loanLimit" value="${item.loanLimit === ''?'':num(item.loanLimit)}"></label>
      <label class="aiql-check">Restock<input type="checkbox" data-field="restock" ${item.restock!==false?'checked':''}></label>
    </div>`).join('');
    return `<div class="aiql-card"><div class="aiql-card-head"><h3>Add an Item</h3><span>${items.length} tracked</span></div>
      <p class="aiql-muted">Type at least 3 letters, then tap the item you want to track.</p>
      <input id="aiql-item-picker" class="aiql-picker-input" autocomplete="off" placeholder="Example: fla, blood, xan" value="${esc(state.search)}">
      <div id="aiql-item-suggestions" class="aiql-suggestions">${itemSuggestionsHTML(state.search)}</div>
    </div>
    <div class="aiql-card"><div class="aiql-card-head"><h3>Tracked Items</h3><span>${items.length}</span></div>
      ${Object.keys(catalog).length ? (rows || '<div class="aiql-empty">No items tracked yet. Use the item picker above.</div>') : '<div class="aiql-empty">Sync the armoury to discover items.</div>'}
    </div>`;
  }

  function makeReport(kind) {
    const list = rows();
    const summary = healthSummary(list);
    const stamp = new Date().toLocaleString();
    if (kind === 'restock') {
      const needed = list.filter(r => r.toBuy > 0);
      return `AURORA SURREALIS — ARMOURY RESTOCK\nUpdated: ${stamp}\n\n` +
        (needed.length ? needed.map(r => `${r.name}: Need ${qty(r.toBuy)}${r.cost ? ` (${money(r.cost)})` : ''}`).join('\n') : 'No tracked items currently need restocking.') +
        `\n\nEstimated Total: ${money(needed.reduce((s,r)=>s+r.cost,0))}`;
    }
    if (kind === 'usage') {
      return `AURORA SURREALIS — USAGE INTELLIGENCE\nUpdated: ${stamp}\n\n` + list.slice().sort((a,b)=>b.u7.avg-a.u7.avg).slice(0,12).map(r => `${r.name}: ${r.u7.avg.toFixed(2)}/day · ${r.daysRemaining===null?'No usage':r.daysRemaining.toFixed(1)+' days remaining'}`).join('\n');
    }
    return `AURORA SURREALIS — ARMOURY BRIEFING\nUpdated: ${stamp}\n\nOverall Health: ${summary.score}% — ${summary.label}\nCritical Items: ${summary.critical}\nLow-Stock Items: ${summary.low}\nTracked Items: ${list.length}\nEstimated Restock Cost: ${money(list.reduce((s,r)=>s+r.cost,0))}\n\nPRIORITIES\n` +
      (list.filter(r=>['CRITICAL','LOW'].includes(r.status)).slice(0,10).map(r=>`${r.name}: ${qty(r.current)} / ${qty(r.target)} — Need ${qty(r.toBuy)}`).join('\n') || 'No immediate stock priorities.');
  }

  function reports() {
    return `<div class="aiql-grid aiql-report-grid">
      <div class="aiql-card"><h3>Armoury Briefing</h3><p>Overall health and priority problems for staff.</p><button data-aiql-report="briefing">Copy Report</button></div>
      <div class="aiql-card"><h3>Restock Report</h3><p>Items, quantities and known estimated costs.</p><button data-aiql-report="restock">Copy Report</button></div>
      <div class="aiql-card"><h3>Usage Intelligence</h3><p>Highest-use items and estimated days remaining.</p><button data-aiql-report="usage">Copy Report</button></div>
    </div><div class="aiql-card"><h3>Report Preview</h3><pre id="aiql-report-preview">Choose a report above. Nothing is posted automatically.</pre></div>`;
  }

  function settingsUI() {
    const hasKey = Boolean(get(KEYS.api, ''));
    const history = get(KEYS.history, []);
    return `<div class="aiql-grid">
      <div class="aiql-card"><h3>API Key</h3><p>${hasKey?'A key is stored locally on this device.':'No API key saved.'}</p><div class="aiql-actions"><button data-aiql-action="create-key">Create Custom Key</button><button data-aiql-action="replace-key">Replace Key</button><button class="aiql-danger" data-aiql-action="delete-key">Delete Key</button></div></div>
      <div class="aiql-card"><h3>Backup & Restore</h3><p>${history.length} local inventory snapshots are stored.</p><div class="aiql-actions"><button data-aiql-action="export">Export Backup</button><button data-aiql-action="import">Import Backup</button><input id="aiql-import-file" type="file" accept="application/json" hidden></div></div>
      <div class="aiql-card"><h3>Diagnostics</h3><p>Check storage, API configuration and collected data.</p><button data-aiql-action="diagnostics">Run Diagnostics</button><pre id="aiql-diagnostics"></pre></div>
      <div class="aiql-card"><h3>Local Data</h3><p>Clearing TornPDA or userscript storage can remove ArmouryIQ data. Export regular backups.</p><button class="aiql-danger" data-aiql-action="reset">Reset ArmouryIQ</button></div>
    </div>`;
  }

  function content() {
    if (!get(KEYS.api, '')) return setupCard();
    const list = rows();
    if (state.tab === 'dashboard') return dashboard(list);
    if (state.tab === 'alerts') return alerts(list);
    if (state.tab === 'inventory') return inventory(list);
    if (state.tab === 'restock') return restock(list);
    if (state.tab === 'usage') return usage(list);
    if (state.tab === 'loans') return loans();
    if (state.tab === 'reports') return reports();
    if (state.tab === 'whitelist') return whitelistUI();
    return settingsUI();
  }

  function render() {
    const root = document.getElementById(ROOT_ID);
    if (!root) return;
    const open = root.classList.contains('open');
    const list = get(KEYS.api, '') ? rows() : [];
    const summary = healthSummary(list);
    root.innerHTML = `<div class="aiql-header" data-aiql-action="toggle">
      <div><strong>${APP}</strong><small>v${VERSION}</small></div>
      <div class="aiql-header-right">${get(KEYS.api,'')?statusPill(summary.label):statusPill('SETUP')}<span class="aiql-gear" data-aiql-action="settings">⚙</span><span class="aiql-arrow">▼</span></div>
    </div><div class="aiql-body">${get(KEYS.api,'')?nav():''}<div id="aiql-status" class="aiql-status ${state.lastError?'error':''}">${esc(state.lastError || state.status)}</div><div class="aiql-view">${content()}</div></div>`;
    if (open) root.classList.add('open');
    bind(root);
  }

  function renderStatusOnly() {
    const el = document.getElementById('aiql-status');
    if (el) el.textContent = state.status;
  }

  function saveRule(key, field, value) {
    const whitelist = get(KEYS.whitelist, {});
    if (!whitelist[key]) return;
    if (['enabled','restock'].includes(field)) whitelist[key][field] = Boolean(value);
    else whitelist[key][field] = value === '' && field === 'loanLimit' ? '' : Math.max(0, num(value));
    if (field === 'target' && whitelist[key].target > 0) {
      if (!num(whitelist[key].low)) whitelist[key].low = Math.ceil(whitelist[key].target * 0.5);
      if (!num(whitelist[key].critical)) whitelist[key].critical = Math.ceil(whitelist[key].target * 0.25);
    }
    set(KEYS.whitelist, whitelist);
  }

  function exportBackup() {
    const payload = {app: APP, version: VERSION, exportedAt: new Date().toISOString(), data: {
      whitelist: get(KEYS.whitelist, {}), catalog: loadCatalog(), live: get(KEYS.live, {}),
      loans: get(KEYS.loans, {}), history: get(KEYS.history, []), prices: get(KEYS.prices, {})
    }};
    const blob = new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'ArmouryIQ_Lite_Backup_' + new Date().toISOString().slice(0,10) + '.json';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),1000);
  }

  function importBackup(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const payload = JSON.parse(reader.result);
        if (payload.app !== APP || !payload.data) throw new Error('This is not an ArmouryIQ Lite backup.');
        const backup = exportMemory();
        set(PREFIX + 'pre_import_backup', backup);
        set(KEYS.whitelist, payload.data.whitelist || {}); saveCatalog(payload.data.catalog || {});
        set(KEYS.live, payload.data.live || {}); set(KEYS.loans, payload.data.loans || {});
        set(KEYS.history, payload.data.history || []); set(KEYS.prices, payload.data.prices || {});
        state.status = 'Backup imported successfully.'; render();
      } catch (error) { state.lastError = error.message; render(); }
    };
    reader.readAsText(file);
  }

  function exportMemory() {
    return {whitelist:get(KEYS.whitelist,{}),catalog:loadCatalog(),live:get(KEYS.live,{}),loans:get(KEYS.loans,{}),history:get(KEYS.history,[]),prices:get(KEYS.prices,{})};
  }

  function diagnosticsText() {
    const live = get(KEYS.live, {}); const history = get(KEYS.history, []); const whitelist = get(KEYS.whitelist, {});
    const debug = get(KEYS.state, {}).apiDebug || {};
    const categoryDebug = Object.entries(debug.categories || {}).map(([name,info]) => `${name}:${info.count ?? '?'}(${info.rawType || '?'})`).join(', ');
    const checks = [
      ['API key stored', Boolean(get(KEYS.api,''))],
      ['Armoury synchronized', Boolean(live.updatedAt)],
      ['Items discovered', Object.keys(loadCatalog()).length > 0],
      ['Whitelist available', Object.keys(whitelist).length > 0],
      ['At least one tracked item', Object.values(whitelist).some(i=>i.enabled)],
      ['History collecting', history.length > 0],
      ['Backup excludes API key', !JSON.stringify(exportMemory()).includes(String(get(KEYS.api,'')))]
    ];
    return checks.map(([name,ok]) => `${ok?'PASS':'WARNING'} — ${name}`).join('\n') + `\n\nDiscovered items: ${Object.keys(loadCatalog()).length}\nTracked items: ${Object.values(whitelist).filter(item=>item.enabled).length}\nSnapshots: ${history.length}\nCatalog keys: ${(debug.catalog?.keys || []).join(', ') || 'none'}\nCatalog raw: ${debug.catalog?.rawType || 'unknown'} / ${debug.catalog?.rawCount ?? '?'}; parsed: ${debug.catalog?.parsedCount ?? '?'}\nInventory counts: ${categoryDebug || 'none'}\nLast sync: ${dateText(live.updatedAt)}\nVersion: ${VERSION}`;
  }

  function bind(root) {
    root.querySelectorAll('[data-aiql-tab]').forEach(btn => btn.addEventListener('click', () => { state.tab = btn.dataset.aiqlTab; render(); }));
    root.querySelectorAll('[data-aiql-action]').forEach(el => el.addEventListener('click', async event => {
      const action = el.dataset.aiqlAction;
      if (action === 'toggle') { if (event.target.closest('[data-aiql-action="settings"]')) return; root.classList.toggle('open'); return; }
      if (action === 'settings') { event.stopPropagation(); state.tab='settings'; root.classList.add('open'); render(); return; }
      if (action === 'create-key') { window.open(CUSTOM_KEY_URL, '_blank'); return; }
      if (action === 'reveal-key') { const input=root.querySelector('#aiql-key-input'); if(input){ input.type=input.type==='password'?'text':'password'; el.textContent=input.type==='password'?'Show':'Hide'; } return; }
      if (action === 'save-key') {
        const input=root.querySelector('#aiql-key-input'); state.status='Validating key…'; state.lastError=''; renderStatusOnly();
        try { await validateKey(input?.value || ''); state.status='Key saved. Synchronizing…'; render(); await syncInventory(); }
        catch(error){ state.lastError=error.message; state.status=''; render(); } return;
      }
      if (action === 'sync') { await syncInventory(); return; }
      if (action === 'prices') { await refreshPrices(); return; }
      if (action === 'copy-restock') { GM_setClipboard(makeReport('restock')); state.status='Restock report copied.'; renderStatusOnly(); return; }
      if (action === 'replace-key') { del(KEYS.api); render(); return; }
      if (action === 'delete-key') { if(confirm('Delete the locally stored ArmouryIQ API key?')){ del(KEYS.api); render(); } return; }
      if (action === 'export') { exportBackup(); return; }
      if (action === 'import') { root.querySelector('#aiql-import-file')?.click(); return; }
      if (action === 'diagnostics') { const out=root.querySelector('#aiql-diagnostics'); if(out) out.textContent=diagnosticsText(); return; }
      if (action === 'reset' && confirm('Reset ArmouryIQ settings and local history? Export a backup first.')) {
        Object.values(KEYS).forEach(del); state.tab='dashboard'; state.status=''; state.lastError=''; render();
      }
    }));
    root.querySelectorAll('[data-aiql-report]').forEach(btn => btn.addEventListener('click', () => {
      const text=makeReport(btn.dataset.aiqlReport); GM_setClipboard(text); const preview=root.querySelector('#aiql-report-preview'); if(preview) preview.textContent=text; btn.textContent='Copied ✓'; setTimeout(()=>btn.textContent='Copy Report',1200);
    }));
    root.querySelectorAll('.aiql-rule').forEach(rule => {
      rule.querySelectorAll('[data-field]').forEach(input => input.addEventListener('change', () => {
        saveRule(rule.dataset.key, input.dataset.field, input.type==='checkbox'?input.checked:input.value);
        if (input.dataset.field==='enabled' || input.dataset.field==='target') render();
      }));
    });
    const picker=root.querySelector('#aiql-item-picker');
    if(picker) picker.addEventListener('input',()=>{
      state.search=picker.value;
      const suggestions=root.querySelector('#aiql-item-suggestions');
      if(suggestions) suggestions.innerHTML=itemSuggestionsHTML(state.search);
    });
    const suggestionsBox=root.querySelector('#aiql-item-suggestions');
    if(suggestionsBox) suggestionsBox.addEventListener('click',event=>{
      const button=event.target.closest('[data-aiql-add-item]');
      if(!button) return;
      const whitelist=get(KEYS.whitelist,{});
      const key=button.dataset.aiqlAddItem;
      const item=loadCatalog()[key];
      if(item){
        const old=whitelist[key] || {};
        whitelist[key]={...old,key,id:item.id,name:item.name,category:item.category,enabled:true,target:num(old.target),low:num(old.low),critical:num(old.critical),reserveDays:num(old.reserveDays)||14,loanLimit:old.loanLimit ?? '',restock:old.restock !== false,createdAt:old.createdAt || Date.now()};
        set(KEYS.whitelist,whitelist);
        state.search='';
        render();
      }
    });
    const importInput=root.querySelector('#aiql-import-file'); if(importInput) importInput.addEventListener('change',()=>{if(importInput.files?.[0]) importBackup(importInput.files[0]);});
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style=document.createElement('style'); style.id=STYLE_ID; style.textContent=`
      #${ROOT_ID}{margin-top:10px;background:#1d1f24;border:1px solid #343841;border-radius:7px;color:#ddd;box-shadow:0 2px 6px #0006;font:14px Arial,sans-serif;overflow:hidden}
      #${ROOT_ID} *{box-sizing:border-box} .aiql-header{padding:12px 15px;display:flex;align-items:center;justify-content:space-between;cursor:pointer;background:linear-gradient(90deg,#172033,#1d1f24)}
      .aiql-header>div:first-child{display:flex;gap:8px;align-items:baseline}.aiql-header strong{font-size:15px;color:#f2f5ff}.aiql-header small,.aiql-muted{color:#98a2b3}.aiql-header-right{display:flex;gap:10px;align-items:center}.aiql-arrow{transition:.2s}.open .aiql-arrow{transform:rotate(180deg)}.aiql-gear{cursor:pointer;font-size:16px}
      .aiql-body{display:none;padding:12px}.open .aiql-body{display:block}.aiql-nav{display:flex;gap:6px;overflow-x:auto;padding-bottom:10px}.aiql-nav button,.aiql-actions button,.aiql-card button,.aiql-key-row button{white-space:nowrap;border:1px solid #465061;background:#2b3038;color:#e6e9ef;border-radius:5px;padding:7px 10px;font-weight:600;cursor:pointer}.aiql-nav button.active,.aiql-primary{background:#4d73ff!important;border-color:#4d73ff!important;color:#fff!important}.aiql-danger{background:#7f1d1d!important;border-color:#991b1b!important}.aiql-status{min-height:0;color:#86efac;padding:0 2px 8px}.aiql-status:empty{display:none}.aiql-status.error{color:#fca5a5}
      .aiql-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.aiql-kpis{grid-template-columns:repeat(3,minmax(0,1fr));margin-bottom:10px}.aiql-card{background:#24272d;border:1px solid #363b44;border-radius:7px;padding:12px;margin-bottom:10px}.aiql-card h3{margin:0 0 9px;color:#f3f4f6;font-size:15px}.aiql-card p{line-height:1.45}.aiql-card>span{display:block;color:#aeb6c3;font-size:12px}.aiql-card>strong{display:block;color:#fff;font-size:21px;margin:4px 0}.aiql-card>small{color:#8e98a7}.aiql-card-head{display:flex;align-items:center;justify-content:space-between;gap:8px}.aiql-actions{display:flex;flex-wrap:wrap;gap:7px}.aiql-banner{padding:9px;background:#172033;border-radius:5px;margin:8px 0;color:#c7d2fe}.aiql-empty{padding:20px;text-align:center;color:#98a2b3}
      .aiql-table-wrap{overflow:auto;margin-top:9px}table{width:100%;border-collapse:collapse;min-width:680px}th,td{padding:8px;border-bottom:1px solid #373b43;text-align:left}th{color:#b7bfcc;font-size:12px}td small{display:block;color:#8993a1;margin-top:2px}.aiql-link{color:#8fb1ff;text-decoration:none}.aiql-pill{display:inline-block;border-radius:999px;padding:3px 7px;font-size:10px;font-weight:800}.aiql-critical,.aiql-poor,.aiql-over-limit{background:#7f1d1d;color:#fecaca}.aiql-low,.aiql-watch,.aiql-no-limit{background:#78350f;color:#fde68a}.aiql-learning,.aiql-setup{background:#343b4b;color:#cbd5e1}.aiql-healthy,.aiql-good,.aiql-excellent,.aiql-ok{background:#14532d;color:#bbf7d0}
      .aiql-key-row{display:flex;gap:7px;margin:6px 0 10px}.aiql-key-row input,.aiql-picker-input,.aiql-rule input[type=number]{background:#17191e;border:1px solid #424750;color:#fff;border-radius:4px;padding:7px}.aiql-key-row input{flex:1;min-width:0}.aiql-picker-input{width:100%;font-size:16px;padding:10px}.aiql-suggestions{display:flex;flex-direction:column;gap:5px;margin-top:7px}.aiql-suggestion{display:grid!important;grid-template-columns:1fr auto auto;align-items:center;gap:9px;text-align:left!important;background:#1b1e24!important}.aiql-suggestion small{color:#98a2b3}.aiql-suggestion b{color:#93c5fd}.aiql-picker-hint{padding:10px;color:#98a2b3}.aiql-rule{display:grid;grid-template-columns:38px minmax(150px,2fr) repeat(5,minmax(75px,1fr)) 75px;gap:8px;align-items:end;padding:9px 0;border-bottom:1px solid #373b43}.aiql-rule label{font-size:11px;color:#9da6b3}.aiql-rule input[type=number]{display:block;width:100%;margin-top:3px}.aiql-rule-name{align-self:center}.aiql-rule-name small{display:block;color:#8e98a7}.aiql-toggle{align-self:center}.aiql-toggle input{width:20px;height:20px}.aiql-check{align-self:center;text-align:center}.aiql-check input{display:block;margin:5px auto 0}pre{white-space:pre-wrap;word-break:break-word;background:#17191e;border-radius:5px;padding:10px;color:#d8dee9;max-height:420px;overflow:auto}.aiql-report-grid{grid-template-columns:repeat(3,minmax(0,1fr))}
      @media(max-width:800px){.aiql-grid,.aiql-kpis,.aiql-report-grid{grid-template-columns:1fr 1fr}.aiql-rule{grid-template-columns:34px 1fr 80px}.aiql-rule label:nth-of-type(n+3){grid-column:auto}.aiql-card{padding:10px}}
      @media(max-width:520px){.aiql-grid,.aiql-kpis,.aiql-report-grid{grid-template-columns:1fr 1fr}.aiql-rule{grid-template-columns:32px 1fr 75px}.aiql-rule-name{grid-column:2/4}.aiql-header{padding:11px}.aiql-body{padding:9px}}
    `; document.head.appendChild(style);
  }

  function mount() {
    if (!isArmouryPage() || document.getElementById(ROOT_ID)) return;
    injectStyles();
    const root=document.createElement('section'); root.id=ROOT_ID;
    const ups=document.querySelector('.ups-accordion');
    if (ups?.parentElement) ups.parentElement.insertAdjacentElement('afterend',root);
    else {
      const delimiter=document.querySelector('.delimiter-999');
      if (!delimiter?.parentElement) return;
      const holder=document.createElement('div'); delimiter.insertAdjacentElement('afterend',holder); holder.appendChild(root);
    }
    render();
  }

  let lastUrl=location.href;
  const observer=new MutationObserver(()=>{ if(location.href!==lastUrl) lastUrl=location.href; if(isArmouryPage()) mount(); });
  observer.observe(document.documentElement,{childList:true,subtree:true});
  window.addEventListener('hashchange',()=>setTimeout(mount,250));
  setInterval(()=>{ if(isArmouryPage()) mount(); },1000);
  mount();
})();
