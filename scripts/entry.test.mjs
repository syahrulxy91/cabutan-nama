import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
const qrSource = readFileSync(new URL('../dist/qr.js', import.meta.url), 'utf8');
const first = '00000000-0000-4000-8000-000000000001';
const second = '00000000-0000-4000-8000-000000000002';
const absent = '00000000-0000-4000-8000-000000000003';
const origin = 'https://cabutan-nama.example';
const titles = { [first]: 'Cabutan Pertama', [second]: 'Cabutan Kedua' };
const accountA = { uid: 'A', email: 'a@example.test' };
const accountB = { uid: 'B', email: 'b@example.test' };

function app(url, { account = null, storage = new Map(), getOwn = () => null, draw, claim, taken = () => [], timers = {} } = {}) {
  let address = new URL(url, origin);
  let observer;
  let rejectLogin;
  let signIns = 0;
  let nextAccount = accountA;
  const calls = [];
  const elements = new Map();
  const listeners = new Map();
  const bodyClasses = new Map();
  const tick = () => new Promise(resolve => setImmediate(resolve));
  const element = selector => {
    if (!elements.has(selector)) {
      const handlers = new Map();
      elements.set(selector, {
        hidden: false, innerHTML: '', open: false,
        addEventListener(event, handler) { handlers.set(event, handler); },
        setAttribute() {}, removeAttribute() {}, focus() { this.focused = true; },
        showModal() { this.open = true; },
        close() { this.open = false; },
        querySelector(query) {
          if (query === '.confirm-countdown' && !this.innerHTML.includes('class="confirm-countdown"')) return null;
          return element(query);
        },
        querySelectorAll: () => [element('choice')],
        dispatch(event, target) { return handlers.get(event)({ target, preventDefault() {} }); }
      });
    }
    return elements.get(selector);
  };
  const context = {
    URL, URLSearchParams, clearTimeout, clearInterval, setTimeout, setInterval, ...timers,
    location: {
      get hash() { return address.hash; },
      set hash(value) {
        if (value === address.hash) return;
        address.hash = value;
        queueMicrotask(() => listeners.get('hashchange')());
      },
      get href() { return address.href; },
      get origin() { return address.origin; },
      get pathname() { return address.pathname; },
      get search() { return address.search; }
    },
    history: { replaceState(_state, _title, value) { address = new URL(value, address); } },
    sessionStorage: { setItem: (k, v) => storage.set(k, v), getItem: k => storage.get(k) ?? null, removeItem: k => storage.delete(k) },
    FormData: class { constructor(form) { this.fields = form.elements; } },
    document: { querySelector: element, querySelectorAll: () => [], body: { classList: { toggle(name, enabled) { bodyClasses.set(name, enabled); } } } },
    window: {
      addEventListener: (type, handler) => listeners.set(type, handler),
      scrollTo() {},
      cabutFirebase: {
        observe(callback) { observer = callback; callback(account); },
        async signIn() {
          signIns++;
          if (rejectLogin) {
            const code = rejectLogin;
            rejectLogin = undefined;
            throw Object.assign(new Error(code), { code });
          }
          account = nextAccount;
          observer(account);
          return { user: account };
        },
        async signOut() { account = null; observer(null); },
        async call(action, data) {
          calls.push([action, data?.id, data?.ownerView]);
          if (action === 'list') return Object.entries(titles).map(([id, title]) => ({ id, title }));
          if (!titles[data.id]) throw new Error('Program tidak ditemui.');
          if (action === 'claim' && claim) await claim();
          const own = action === 'draw' ? draw() : await getOwn();
          return { id: data.id, title: titles[data.id], now: Date.now(), revision: 'r', confirmed: 0, names: ['Aina', 'Azmi'], taken: taken(), own, records: [] };
        }
      }
    }
  };
  runInNewContext(qrSource + '\nglobalThis.drawQrModules = window.drawQrModules;\n' + source, context);
  const click = (selector, act) => element(selector).dispatch('click', { closest: () => ({ dataset: { act } }) });
  return {
    calls, storage, tick, element, bodyClasses, click,
    get address() { return address; },
    get signIns() { return signIns; },
    get account() { return account; },
    get content() { return element('#app').innerHTML; },
    async go(hash) { context.location.hash = hash; await tick(); },
    failLogin(code) { rejectLogin = code; },
    useAccount(user) { nextAccount = user; },
    async enter(mode) {
      if (mode === 'login-user' && element('#app').innerHTML.includes('data-act="login-participant"')) {
        await click('#app', 'login-participant');
        await tick();
        return;
      }
      await click('#app', 'login');
      assert.match(element('#dialog').innerHTML, /Pengguna.*Penyelaras/);
      await click('#dialog', mode);
      await tick();
    },
    async paste(link) {
      const form = { elements: { link: { value: link } }, querySelector: element };
      await element('#app').dispatch('submit', { closest: () => form });
      await tick();
    }
  };
}

test('a slow result request completes without restarting the animation or refreshing again', async () => {
  const scheduled = new Map();
  let sequence = 0;
  const timers = {
    setTimeout(callback) { scheduled.set(++sequence, callback); return sequence; },
    clearTimeout(id) { scheduled.delete(id); },
    setInterval() {},
    clearInterval() {}
  };
  const named = { name: 'Aina', row: 0, status: 'named' };
  let own = named;
  let pendingResult;
  const result = { ...named, status: 'pending', recipient: 1, recipientName: 'Azmi' };
  const page = app('/#/peserta/' + first, {
    timers,
    getOwn: () => pendingResult ?? own,
    draw: () => {
      const now = Date.now();
      own = { ...result, recipient: null, recipientName: null, revealAt: now + 2000, confirmBy: now + 12000 };
      return own;
    }
  });
  await page.enter('login-user');
  assert.doesNotMatch(page.content, /Sudah mengundi/);
  await page.go('#/peserta/' + first + '/undian');
  page.element('#draw-consent').checked = true;
  page.element('#draw-name-confirmed').checked = true;
  await page.click('#app', 'draw');
  assert.match(page.content, /Sedang mencabut nama/);
  assert.equal(scheduled.size, 1);

  let sendResult;
  pendingResult = new Promise(resolve => { sendResult = resolve; });
  const [[timer, fetchResult]] = scheduled;
  scheduled.delete(timer);
  const refresh = fetchResult();
  assert.equal(scheduled.size, 0, 'no new result timer while the request is pending');
  own = { ...own, ...result };
  sendResult(own);
  await refresh;
  assert.match(page.content, /Nama penerima hadiah.*Azmi/);
  assert.doesNotMatch(page.content, /Sedang mencabut nama/);
  await page.go('#/peserta/' + first);
  assert.match(page.content, /Sudah mengundi/);
  assert.match(page.content, /Lihat keputusan/);
});

test('login layout is active until the user selects a mode', async () => {
  const page = app('/?program=' + first);
  assert.equal(page.bodyClasses.get('login-view'), true);
  await page.enter('login-user');
  assert.equal(page.bodyClasses.get('login-view'), false);

  const signedInWithoutMode = app('/#/urus', { account: accountA });
  assert.equal(signedInWithoutMode.bodyClasses.get('login-view'), true);
  await signedInWithoutMode.enter('login-coordinator');
  assert.equal(signedInWithoutMode.bodyClasses.get('login-view'), false);
});

test('a lost draw response recovers the existing result without drawing twice', async () => {
  const named = { name: 'Aina', row: 0, status: 'named' };
  const result = { ...named, status: 'confirmed', recipient: 1, recipientName: 'Azmi' };
  const unavailable = Object.assign(new Error('offline'), { code: 'functions/unavailable' });
  let disconnected = false;
  let own = named;
  let scheduled;
  const page = app('/#/peserta/' + first, {
    timers: {
      setInterval() {}, clearInterval() {},
      setTimeout(callback, delay) { scheduled = { callback, delay }; return 1; },
      clearTimeout() { scheduled = undefined; }
    },
    getOwn() {
      if (disconnected) throw unavailable;
      return own;
    },
    draw() {
      own = result;
      disconnected = true;
      throw unavailable;
    }
  });
  await page.enter('login-user');
  await page.go('#/peserta/' + first + '/undian');
  page.element('#draw-consent').checked = true;
  page.element('#draw-name-confirmed').checked = true;
  await page.click('#app', 'draw');
  assert.match(page.content, /Cuba lagi/);
  assert.doesNotMatch(page.content, /data-act="draw"/);
  for (const delay of [750, 1500, 3000]) {
    assert.equal(scheduled?.delay, delay);
    await scheduled.callback();
  }
  assert.equal(scheduled, undefined);
  disconnected = false;
  await page.click('#app', 'refresh');
  assert.match(page.content, /Nama penerima hadiah.*Azmi/);
  assert.equal(page.calls.filter(([action]) => action === 'draw').length, 1);
});

test('participant deep link keeps the program on login, reload and account switch', async () => {
  const page = app('/#/peserta/' + first);
  page.failLogin('auth/popup-closed-by-user');
  await page.enter('login-user');
  assert.match(page.element('.entry-error').textContent, /Tetingkap log masuk ditutup/);
  await page.enter('login-user');
  assert.match(page.content, /Cabutan Pertama/);
  assert.equal(page.address.searchParams.get('program'), first);
  assert.equal(page.element('#admin-link').hidden, true);
  assert.equal(page.element('#participant-link').href, '#/peserta/' + first);
  assert.equal(page.element('.brand').href, '#/peserta/' + first);
  const reloaded = app(page.address.href, { account: page.account, storage: page.storage });
  await reloaded.tick();
  assert.match(reloaded.content, /Cabutan Pertama/);
  assert.equal(reloaded.signIns, 0);
  await reloaded.element('#switch-account').dispatch('click');
  reloaded.useAccount(accountB);
  await reloaded.enter('login-user');
  assert.match(reloaded.content, /b@example.test/);
  assert.equal(reloaded.address.hash, '#/peserta/' + first);
});

test('coordinator mode shows both tabs and points to the selected program', async () => {
  const page = app('/#/urus');
  await page.enter('login-coordinator');
  assert.match(page.content, /Panel urusetia/);
  assert.equal(page.element('#admin-link').hidden, false);
  assert.match(page.content, /aria-label="Kod QR program"/);
  assert.match(page.content, new RegExp('program=' + first + '#/peserta/' + first));
  await page.element('#app').dispatch('change', { id: 'admin-program', value: second, matches: () => false });
  await page.tick();
  assert.equal(page.element('#participant-link').href, '#/peserta/' + second);
  await page.go('#/peserta/' + second);
  assert.match(page.content, /Cabutan Kedua/);
  assert.equal(page.element('#admin-link').hidden, false);
  await page.go('#/urus');
  assert.equal(page.element('#participant-link').href, '#/peserta/' + second);
});

test('generic, malformed and missing links offer recovery without opening Urusetia', async () => {
  const page = app('/#/peserta');
  await page.enter('login-user');
  assert.match(page.content, /Buka program/);
  await page.paste('/#/peserta');
  assert.match(page.element('.form-error').textContent, /pautan peserta/);
  await page.paste('/?program=' + absent);
  assert.match(page.content, /Program tidak ditemui/);
  await page.paste('/#/peserta/' + first);
  assert.match(page.content, /Cabutan Pertama/);
  await page.go('#/peserta/rosak');
  assert.match(page.content, /Pautan program tidak sah/);
  await page.go('#/urus');
  assert.match(page.content, /mod Pengguna/);
  assert.equal(page.element('#admin-link').hidden, true);
  assert.equal(page.calls.some(([action]) => action === 'list'), false);
  await page.enter('login-coordinator');
  assert.match(page.content, /Cipta program/);
  assert.equal(page.signIns, 1);
});

test('link survives a missing fragment and an explicit program takes priority', async () => {
  const page = app('/?program=' + second);
  await page.enter('login-user');
  assert.match(page.content, /Cabutan Kedua/);
  assert.equal(page.address.hash, '#/peserta/' + second);
  await page.go('#/peserta/' + first);
  assert.match(page.content, /Cabutan Pertama/);
  assert.equal(page.address.searchParams.get('program'), first);
});

test('a conflicting claim refreshes the roster and focuses the remaining choices', async () => {
  let claims = [];
  const page = app('/#/peserta/' + first, {
    taken: () => claims,
    claim() {
      claims = [0];
      throw Object.assign(new Error('Nama sudah dipilih'), { code: 'functions/already-exists' });
    }
  });
  await page.enter('login-user');
  await page.element('#app').dispatch('change', { id: 'participant-name', value: '0', matches: () => false });
  await page.click('#app', 'accept-name');
  assert.deepEqual(page.calls.map(([action]) => action), ['get', 'claim', 'get']);
  assert.match(page.content, /Pilih semula daripada senarai terkini/);
  assert.doesNotMatch(page.content, /<option value="0"/);
  assert.equal(page.element('#participant-name').focused, true);
});

test('an owner can refresh just the records and refresh the catalog explicitly', async () => {
  const page = app('/#/urus');
  await page.enter('login-coordinator');
  await page.click('#app', 'refresh');
  assert.deepEqual(page.calls.map(([action]) => action), ['list', 'get', 'get']);
  await page.click('#app', 'refresh-programs');
  assert.deepEqual(page.calls.map(([action]) => action), ['list', 'get', 'get', 'list', 'get']);
});

test('the completed draw allows name correction and route changes focus the heading', async () => {
  const page = app('/#/peserta/' + first, { getOwn: () => ({ name: 'Aina', row: 0, status: 'confirmed', recipient: 1 }) });
  await page.enter('login-user');
  assert.match(page.content, /Betulkan nama dalam senarai/);
  await page.go('#/peserta/' + first + '/undian');
  assert.equal(page.element('h1, h2').focused, true);
});
