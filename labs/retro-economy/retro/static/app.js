'use strict';

const STORAGE_KEY = 'mistshore.session.v1';

function createUUID(cryptoProvider = globalThis.crypto) {
  if (typeof cryptoProvider?.randomUUID === 'function') return cryptoProvider.randomUUID();
  if (typeof cryptoProvider?.getRandomValues !== 'function') {
    throw new Error('Secure randomness is unavailable');
  }
  // getRandomValues is also available on ordinary HTTP LAN origins.
  const bytes = new Uint8Array(16);
  cryptoProvider.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

class SessionClient {
  constructor({ storage, fetch, uuid, onState = () => {}, onStatus = () => {} }) {
    this.storage = storage;
    this.fetch = fetch;
    this.uuid = uuid;
    this.onState = onState;
    this.onStatus = onStatus;
    this.state = null;
    this.listings = [];
    this.storageError = null;
    this.session = { token: null, pendingJoin: null, pendingAction: null };
    this.tail = Promise.resolve();
    this.busy = false;
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (!saved || typeof saved !== 'object' ||
            !(saved.token === null || typeof saved.token === 'string') ||
            (saved.pendingJoin && typeof saved.pendingJoin.join_id !== 'string') ||
            (saved.pendingAction && typeof saved.pendingAction.action_id !== 'string')) {
          throw new Error('invalid session');
        }
        this.session = saved;
      }
    } catch (_) { this.storageError = '無法讀取角色紀錄。請允許本機儲存，或明確重設此瀏覽器角色。'; }
  }

  save(next) {
    // Memory changes only after durable storage succeeds; never send an unrecorded intent.
    this.storage.setItem(STORAGE_KEY, JSON.stringify(next));
    this.session = next;
  }

  enqueue(operation) {
    const job = this.tail.then(async () => {
      this.busy = true;
      this.onStatus('busy');
      try {
        if (this.storageError) throw new Error(this.storageError);
        await operation();
      } catch (error) {
        this.onStatus(error.unauthorized ? 'unauthorized' : 'offline',
          error.unauthorized ? '角色憑證無效；紀錄已保留。請連回原本的伺服器，或明確重設角色。' :
          this.storageError || '連線或儲存暫時不可用。紀錄已保留，重試會使用同一個動作。');
      } finally { this.busy = false; }
    });
    this.tail = job.catch(() => {});
    return job;
  }

  async request(path, body) {
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 8000);
    try {
      const headers = {};
      if (this.session.token) headers.Authorization = `Bearer ${this.session.token}`;
      if (body) headers['Content-Type'] = 'application/json';
      const response = await this.fetch(path, {
        method: body ? 'POST' : 'GET', headers, cache: 'no-store', signal: abort.signal,
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (response.status === 401) {
        const error = new Error('unauthorized'); error.unauthorized = true; throw error;
      }
      if (response.status >= 500) throw new Error('server unavailable');
      const data = await response.json();
      if (typeof data.ok !== 'boolean' || (!data.ok && !data.error)) throw new Error('invalid reply');
      return data;
    } finally { clearTimeout(timeout); }
  }

  apply(state, listings = []) {
    if (state) {
      this.state = state;
      this.listings = listings;
      this.onState(state, listings);
    }
  }

  async refresh(message) {
    const data = await this.request('/api/state');
    if (!data.ok || !data.state) throw new Error('state unavailable');
    this.apply(data.state, data.listings || []);
    this.onStatus('ready', message);
  }

  async sendJoin() {
    const data = await this.request('/api/join', this.session.pendingJoin);
    if (data.ok && (typeof data.token !== 'string' || !data.state)) throw new Error('invalid join');
    this.save({ ...this.session, token: data.ok ? data.token : null, pendingJoin: null });
    if (data.ok) await this.refresh(data.message);
    else this.onStatus('rejected', data.error.message);
  }

  async sendAction() {
    const data = await this.request('/api/action', this.session.pendingAction);
    this.save({ ...this.session, pendingAction: null });
    // A replay can contain an old result. Read current state before rendering, including after reload.
    await this.refresh(data.ok ? data.message : data.error.message);
  }

  join(name, profession) {
    return this.enqueue(async () => {
      if (this.session.token) return this.refresh();
      if (!this.session.pendingJoin) this.save({ ...this.session, pendingJoin: { name: name.trim(), profession, join_id: this.uuid() } });
      await this.sendJoin();
    });
  }

  act(action) {
    return this.enqueue(async () => {
      if (!this.session.token) return;
      if (!this.session.pendingAction) this.save({ ...this.session, pendingAction: { action_id: this.uuid(), action: { ...action } } });
      await this.sendAction();
    });
  }

  resume() {
    return this.enqueue(async () => {
      if (this.session.pendingJoin) return this.sendJoin();
      if (this.session.pendingAction) return this.sendAction();
      if (this.session.token) return this.refresh('已載入上次的旅程。');
      this.onStatus('ready');
    });
  }

  poll() {
    // Skip queued polls while a request is outstanding; never accumulate offline traffic.
    if (this.busy || !this.session.token || this.storageError) return Promise.resolve();
    return this.enqueue(async () => {
      if (this.session.pendingAction) await this.sendAction();
      else await this.refresh();
    });
  }

  reset() {
    if (this.busy) return false;
    this.storage.removeItem(STORAGE_KEY);
    this.session = { token: null, pendingJoin: null, pendingAction: null };
    this.storageError = null;
    this.state = null;
    this.listings = [];
    return true;
  }
}
if (typeof module !== 'undefined') module.exports = { SessionClient, STORAGE_KEY, createUUID };

function startGame() {
  const $ = id => document.getElementById(id);
  const directions = { west: [-1, 0], east: [1, 0], north: [0, -1], south: [0, 1] };
  const locations = { '-3,0': '礫坡', '0,0': '霧岸鎮', '2,0': '路障', '3,0': '霧影遭遇', '4,0': '望潮塔', '0,4': '潮林' };
  const allowed = new Set(['-3,0', '-2,0', '-1,0', '0,0', '1,0', '2,0', '3,0', '4,0', '0,1', '0,2', '0,3', '0,4']);
  const itemNames = { ore: '礦石', herb: '藥草', kit: '修補組', medicine: '行路藥' };
  let marketSnapshot = '';
  let phase = 'ready';
  let reconnecting = false;
  let client;
  let browserStorage;
  try { browserStorage = window.localStorage; }
  catch (_) { browserStorage = { getItem() { throw new Error('unavailable'); }, setItem() { throw new Error('unavailable'); }, removeItem() { throw new Error('unavailable'); } }; }

  function controls() {
    const s = client.state;
    const locked = phase === 'busy' || phase === 'offline' || phase === 'unauthorized' || Boolean(client.storageError);
    $('join').disabled = locked || Boolean(client.session.token);
    $('retry').hidden = !['offline', 'unauthorized'].includes(phase);
    $('reset-session').disabled = phase === 'busy';
    for (const button of document.querySelectorAll('[data-move]')) {
      const [dx, dy] = directions[button.dataset.move];
      button.disabled = !s || locked || !allowed.has(`${s.x + dx},${s.y + dy}`);
    }
    $('gather').disabled = !s || locked || !['-3,0', '0,4'].includes(`${s.x},${s.y}`);
    $('craft').disabled = !s || locked || s.x !== 0 || s.y !== 0 ||
      (s.profession === 'smith' ? s.items.ore < 2 : s.items.herb < 3);
    for (const id of ['list-item', 'list-quantity', 'list-price', 'list-submit']) $(id).disabled = !s || locked;
    document.querySelectorAll('[data-market-action]').forEach(button => {
      const listing = client.listings.find(row => row.id === Number(button.dataset.listingId));
      button.disabled = !s || locked || !listing || listing.status !== 'open' ||
        (button.dataset.marketAction === 'buy' && s.coins < listing.price);
    });
  }

  function renderMarket(s, listings) {
    $('market').hidden = false;
    const snapshot = JSON.stringify([s.id, listings]);
    if (snapshot === marketSnapshot) return; // Keep focused buttons stable between unchanged polls.
    marketSnapshot = snapshot;
    $('market-empty').hidden = listings.length > 0;
    const rows = listings.map(listing => {
      const row = document.createElement('li');
      row.className = 'market-row';
      row.dataset.listingId = listing.id;
      row.dataset.status = listing.status;
      const details = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = `${itemNames[listing.item]} × ${listing.quantity}`;
      const seller = document.createElement('span');
      seller.className = 'market-seller';
      seller.textContent = listing.seller_name;
      const status = document.createElement('small');
      status.className = 'market-status';
      status.textContent = `#${listing.id} · ${{ open: '掛單中', sold: '已售出', cancelled: '已取消' }[listing.status]}`;
      details.append(title, seller, status);
      const price = document.createElement('span');
      price.className = 'market-price';
      price.textContent = `${listing.price} 金幣／整筆`;
      row.append(details, price);
      if (listing.status === 'open') {
        const own = listing.seller_id === s.id;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = own ? 'secondary' : 'primary';
        button.dataset.marketAction = own ? 'cancel' : 'buy';
        button.dataset.listingId = listing.id;
        button.textContent = own ? '取消掛單' : '購買';
        button.setAttribute('aria-label', `${button.textContent} #${listing.id} ${itemNames[listing.item]} × ${listing.quantity}`);
        button.addEventListener('click', () => client.act({ type: own ? 'cancel' : 'buy', listing_id: listing.id }));
        row.append(button);
      }
      return row;
    });
    $('market-list').replaceChildren(...rows);
  }

  function render(s, listings) {
    $('join-card').hidden = true;
    $('character-card').hidden = false;
    $('player-name').textContent = s.name;
    $('profession-label').textContent = s.profession === 'smith' ? '鐵匠' : '藥師';
    $('coins').textContent = s.coins;
    $('hp').textContent = `${s.hp} / 3`;
    for (const item of ['ore', 'herb', 'kit', 'medicine']) $(`inventory-${item}`).textContent = s.items[item];
    $('tower-status').textContent = `${['尚未出發', '路障已修補', '霧影已通過'][s.tower_stage]}${s.tower_reward_claimed ? ' · 首次獎勵已領' : ''}`;
    $('location').textContent = locations[`${s.x},${s.y}`] || (s.x > 0 ? '塔路' : s.y > 0 ? '潮林小徑' : '礫坡小徑');
    $('coordinates').textContent = `${s.x}, ${s.y}`;
    $('player-marker').setAttribute('transform', `translate(${360 + s.x * 90} ${156 + s.y * 85})`);
    $('player-marker').classList.add('arrived');
    $('map').setAttribute('aria-label', `霧岸鎮地圖，目前在${$('location').textContent}，座標 ${s.x}, ${s.y}。西側礫坡，南側潮林，東側望潮塔。`);
    const smith = s.profession === 'smith';
    $('recipe').textContent = smith ? '2 礦石 → 1 修補組' : '3 藥草 → 1 行路藥';
    $('craft').textContent = smith ? '製作修補組' : '製作行路藥';
    const own = smith ? s.items.kit : s.items.medicine;
    const raw = smith ? s.items.ore : s.items.herb;
    const needed = smith ? 2 : 3;
    const town = s.x === 0 && s.y === 0;
    const destination = smith ? '礫坡' : '潮林';
    const remaining = smith ? Math.abs(s.x + 3) + s.y : Math.abs(s.x) + Math.abs(s.y - 4);
    const homeward = s.y > 0 ? `向北走 ${s.y} 格` : `${s.x < 0 ? '向東' : '向西'}走 ${Math.abs(s.x)} 格`;
    const approach = smith
      ? (s.y > 0 ? `${homeward}回鎮，再向西走 3 格` : `向西走 ${remaining} 格`)
      : (s.x !== 0 ? `${homeward}回鎮，再向南走 4 格` : `向南走 ${remaining} 格`);
    let step = own > 0 ? 2 : raw >= needed ? 1 : 0;
    let title = remaining === 0 ? `已抵達${destination}，可以採集` : `前往${destination}採集`;
    let hint = `需要 ${needed} ${smith ? '礦石' : '藥草'}，目前 ${raw}。` +
      (remaining === 0 ? `再按「採集」${needed - raw} 次，即可帶原料回鎮製作。` : `${approach}抵達${destination}，再按「採集」。`);
    if (step === 1) {
      title = town ? '原料齊了，可以製作' : '帶著原料回鎮製作';
      hint = town ? `按「${smith ? '製作修補組' : '製作行路藥'}」，${smith ? '2 礦石做成修補組' : '3 藥草做成行路藥'}。`
        : `${homeward}回到霧岸鎮，再按「${smith ? '製作修補組' : '製作行路藥'}」。`;
    }
    if (step === 2) { title = '補給齊了，向東登塔'; hint = '沿東側塔路前進 4 格；路障消耗 1 修補組，霧影消耗 1 行路藥。'; }
    if (s.x > 0 && s.tower_stage > 0) {
      step = 2; title = '沿塔路向東，抵達望潮塔';
      hint = s.tower_stage === 1 ? '霧影在東側：有行路藥便能通過，否則會被送回鎮。'
        : `霧影已散。再向東 ${4 - s.x} 格就能首次登頂，獲得 8 金幣。`;
    }
    const missingOther = (smith ? s.items.medicine : s.items.kit) === 0;
    if (s.tower_stage === 0 && missingOther && (step === 2 || (step === 0 && town))) {
      title = '這次出發，還缺異職補給';
      hint = `你需要${smith ? '藥師的行路藥' : '鐵匠的修補組'}。到旅人市場向另一位旅人購買；也可採集製作自己的成品掛單，交換下一輪補給。`;
    }
    if (s.tower_reward_claimed && s.x === 4) {
      step = 3; title = '你看見了霧後的海';
      hint = '首次登頂獎勵已領，下次不再發獎。向西走 4 格回鎮，製作並交易補給，便能再走一輪。';
    } else if (s.tower_reward_claimed && s.tower_stage === 2 && s.x > 0) {
      // The saved reward is lifetime-only: the same state can be a return trip
      // or a later ascent. Present both routes without inventing round history.
      step = 2; title = '本輪霧影已通過';
      hint = `可前往東側塔頂（還有 ${4 - s.x} 格），或向西走 ${s.x} 格回鎮。首次獎勵已領，再次登頂不再發獎。`;
    }
    $('guide-title').textContent = title;
    $('guide-detail').textContent = hint;
    document.querySelectorAll('[data-step]').forEach(el => {
      if (Number(el.dataset.step) === 2) {
        // Keep the numbered span; update only the adjacent label text node.
        el.lastChild.textContent = s.tower_reward_claimed && s.tower_stage === 2 && s.x > 0 && s.x < 4
          ? '塔路往返' : '向東登塔';
      }
      el.classList.toggle('current', Number(el.dataset.step) === step);
      el.classList.toggle('complete', Number(el.dataset.step) < step);
    });
    $('world').classList.toggle('victory', s.tower_reward_claimed);
    renderMarket(s, listings);
    controls();
  }

  client = new SessionClient({ storage: browserStorage, fetch: window.fetch.bind(window),
    uuid: () => createUUID(), onState: render,
    onStatus: (next, message) => {
      if (next === 'offline' || next === 'unauthorized') reconnecting = true;
      if (next === 'ready' && reconnecting) {
        message = message || '已重新連線，旅程已恢復。';
        reconnecting = false;
      }
      phase = next;
      $('connection').textContent = { busy: '同步中', ready: '已保存', rejected: '請調整後再試', offline: '等待重連', unauthorized: '角色連線異常' }[next];
      $('connection').dataset.status = next;
      if (message) $('message').textContent = message;
      controls();
    },
  });
  function move(direction) {
    const button = document.querySelector(`[data-move="${direction}"]`);
    if (button.disabled || client.busy) return;
    const [dx, dy] = directions[direction];
    client.act({ type: 'move', dx, dy });
  }
  $('join-form').addEventListener('submit', event => { event.preventDefault(); client.join($('name').value, $('profession').value); });
  document.querySelectorAll('[data-move]').forEach(button => button.addEventListener('click', () => move(button.dataset.move)));
  $('gather').addEventListener('click', () => client.act({ type: 'gather' }));
  $('craft').addEventListener('click', () => client.act({ type: 'craft', item: client.state.profession === 'smith' ? 'kit' : 'medicine' }));
  $('list-form').addEventListener('submit', event => {
    event.preventDefault();
    if (client.busy || $('list-submit').disabled || !$('list-form').reportValidity()) return;
    client.act({ type: 'list', item: $('list-item').value,
      quantity: Number($('list-quantity').value), price: Number($('list-price').value) });
  });
  $('retry').addEventListener('click', () => client.resume());
  $('reset-session').addEventListener('click', () => {
    if (client.busy || !window.confirm('重設會移除此瀏覽器的角色憑證，無法再以此瀏覽器接回舊角色。伺服器上的角色不會刪除。確定重設？')) return;
    try { if (client.reset()) window.location.reload(); }
    catch (_) { $('message').textContent = '無法重設，請先允許瀏覽器本機儲存。'; }
  });
  const keys = { ArrowLeft: 'west', a: 'west', ArrowRight: 'east', d: 'east', ArrowUp: 'north', w: 'north', ArrowDown: 'south', s: 'south' };
  document.addEventListener('keydown', event => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.repeat || /INPUT|SELECT|TEXTAREA/.test(event.target.tagName) || event.target.isContentEditable) return;
    const direction = keys[event.key] || keys[event.key.toLowerCase()];
    if (direction && client.state) { event.preventDefault(); move(direction); }
  });
  controls();
  client.resume();
  setInterval(() => { if (!document.hidden) client.poll(); }, 1500);
}

if (typeof document !== 'undefined') startGame();
