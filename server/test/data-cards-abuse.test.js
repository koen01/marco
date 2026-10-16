// Data cards (market, sports, stocks), security review: what a flood of new keys can and cannot do to the sources and
// to the screens. Coins only the builder's preview asked for never push a saved screen's coin out of the markets call,
// more coins than fit in one call never make the server ask every 15 s, the queue of calls to one host is capped (and
// searches have a smaller share), a full cache lets the pickers' searches go first, a preview asks no more cards than a
// screen may have, and crests go through the same gate as every other call. No network: fake answers only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDataHub, dataForItem, DATA_HOSTS, HOST_QUEUE_MAX, HOST_SEARCH_QUEUE_MAX, MARKETS_MAX_IDS } from '../core/dataCore.js';
import { fakeDataCall, FAKE_STOCKS_KEY } from '../core/dataFake.js';
import { crestImage, itemData, setDataFetch } from '../dataFeeds.js';
import { previewItems } from '../routes/data.js';

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4, 0x89]);

/** A CoinGecko that knows every coin it is asked for (price 1). */
function anyCoinHub() {
  let t = Date.parse('2026-10-14T12:00:00Z');
  const calls = [];
  const call = async (req) => {
    calls.push(req);
    const u = new URL(`https://${req.host}${req.path}`);
    if (u.pathname === '/api/v3/coins/markets') {
      const ids = (u.searchParams.get('ids') || '').split(',').filter(Boolean);
      return { status: 200, text: JSON.stringify(ids.map((id) => ({ id, symbol: id.slice(0, 3), name: id, current_price: 1, last_updated: new Date(t).toISOString() }))) };
    }
    return { status: 200, text: JSON.stringify({ coins: [] }) };
  };
  const hub = createDataHub({ call, now: () => t });
  return { hub, calls, step: (ms) => { t += ms; } };
}

const card = (ids) => ({ kind: 'market', props: { coins: ids.map((id) => ({ id, currency: 'eur' })), range: '7d' } });
const marketCalls = (calls) => calls.filter((c) => c.path.startsWith('/api/v3/coins/markets'));

test('coins only a preview asked for never push a screen\'s coin out of the markets call', async () => {
  const { hub, calls, step } = anyCoinHub();
  const screen = card(['zzz-on-the-wall']);
  assert.ok((await dataForItem(hub, screen)).coins[0].price > 0);
  // previews asking for 300 other coins (sorted before the screen's)
  for (let i = 0; i < 50; i++) {
    await dataForItem(hub, card(Array.from({ length: 6 }, (_, j) => `aaa-${i}-${j}`)), undefined, { preview: true });
    step(16_000);
  }
  for (let k = 0; k < 10; k++) {
    step(61_000);
    const d = await dataForItem(hub, screen);
    await new Promise((r) => setTimeout(r, 1));
    assert.ok(d.coins[0].price > 0, 'the screen keeps its price');
  }
  const last = marketCalls(calls).at(-1);
  assert.match(last.path, /zzz-on-the-wall/);
  assert.ok(decodeURIComponent(last.path).split('ids=')[1].split('&')[0].split(',').length <= MARKETS_MAX_IDS);
});

test('more coins than fit in one call: no call every 15 s', async () => {
  const { hub, calls, step } = anyCoinHub();
  // saved screens wanting 300 coins
  for (let i = 0; i < 50; i++) await dataForItem(hub, card(Array.from({ length: 6 }, (_, j) => `c-${String(i).padStart(2, '0')}-${j}`)));
  const before = marketCalls(calls).length;
  // a screen polling every 16 s for four minutes, each time with coins that have no room
  const wall = card(['c-00-0', 'c-00-1']);
  for (let k = 0; k < 15; k++) {
    step(16_000);
    for (let i = 0; i < 50; i++) await dataForItem(hub, card(Array.from({ length: 6 }, (_, j) => `c-${String(i).padStart(2, '0')}-${j}`)));
    await dataForItem(hub, wall);
    await new Promise((r) => setTimeout(r, 1));
  }
  const n = marketCalls(calls).length - before;
  assert.ok(n <= 3, `the normal two minute refresh only (got ${n} calls in 4 minutes)`);
});

test('the queue of one host is capped, and searches have a smaller share', async () => {
  // a gap that never ends: every call after the first waits in the queue
  let release;
  const gap = new Promise((r) => { release = r; });
  const calls = [];
  const hub = createDataHub({ call: async (req) => (calls.push(req), { status: 200, text: '{"coins":[]}' }), sleep: () => gap });
  const results = [];
  for (let i = 0; i < 10; i++) results.push(hub.searchCoins(`text${i}`).then(() => 'ok', (e) => e.code));
  const settled = await Promise.race([Promise.allSettled(results.slice(HOST_SEARCH_QUEUE_MAX)), new Promise((r) => setTimeout(() => r(null), 50))]);
  assert.ok(settled, 'the searches over the share answer at once');
  assert.ok(settled.every((s) => s.value === 'rate_limited'));
  const many = [];
  for (let i = 0; i < HOST_QUEUE_MAX + 20; i++) many.push(hub.get({ host: DATA_HOSTS.coingecko, path: `/api/v3/coins/x${i}/market_chart` }).then(() => 'ok', (e) => e.code));
  const over = await Promise.race([Promise.allSettled(many.slice(HOST_QUEUE_MAX)), new Promise((r) => setTimeout(() => r(null), 50))]);
  assert.ok(over, 'calls over the cap answer at once');
  assert.ok(over.every((s) => s.value === 'rate_limited'));
  // another host has its own queue
  const espn = hub.get({ host: DATA_HOSTS.espn, path: '/apis/site/v2/sports/soccer/esp.1/scoreboard' }).then(() => 'ok', (e) => e.code);
  assert.equal(await espn, 'ok');
  release();
  await Promise.all([...results, ...many]);
  assert.ok(calls.filter((c) => c.host === DATA_HOSTS.coingecko).length <= HOST_QUEUE_MAX + 1, 'never more than the cap (and the one under way) reached the host');
  // once drained, the host takes calls again
  assert.equal(await hub.get({ host: DATA_HOSTS.coingecko, path: '/api/v3/search?query=ok' }).then(() => 'ok', (e) => e.code), 'ok');
});

test('a full cache lets the pickers\' searches go first, not what the screens show', async () => {
  let t = Date.parse('2026-10-14T12:00:00Z');
  const hub = createDataHub({ call: fakeDataCall({ now: () => t }), now: () => t, stocksKey: () => FAKE_STOCKS_KEY, max: 10 });
  await dataForItem(hub, card(['bitcoin']));
  await dataForItem(hub, { kind: 'stocks', props: { symbols: [{ sym: 'AAPL' }] } });
  for (let i = 0; i < 40; i++) {
    t += 1000;
    await hub.searchCoins(`coin${i}`);
  }
  assert.ok(hub._cache.has('markets:eur'), 'the screen\'s markets stay');
  assert.ok(hub._cache.has('q:AAPL'), 'the screen\'s quote stays');
  assert.ok(hub._cache.size <= 10);
});

test('a preview asks no more cards of a kind than one screen may have', () => {
  const items = Array.from({ length: 24 }, (_, i) => ({ id: `cv_m${String(i).padStart(7, '0')}`, kind: 'market', props: { coins: [{ id: `coin-${i}` }] } }))
    .concat(Array.from({ length: 10 }, (_, i) => ({ id: `cv_s${String(i).padStart(7, '0')}`, kind: 'stocks', props: { symbols: [{ sym: `S${i}` }] } })));
  const out = previewItems(items);
  assert.equal(out.filter((x) => x.kind === 'market').length, 6);
  assert.equal(out.filter((x) => x.kind === 'stocks').length, 4);
  assert.deepEqual(out[0].props.coins.map((c) => c.id), ['coin-0']);
});

test('crests go through the host\'s gate: one at a time, however many a display asks for at once', async () => {
  let live = 0;
  let most = 0;
  const crestCalls = [];
  setDataFetch(fakeDataCall({}), {
    crest: async (req) => {
      crestCalls.push(req);
      live++;
      most = Math.max(most, live);
      await new Promise((r) => setTimeout(r, 2));
      live--;
      return { status: 200, bytes: PNG };
    },
  });
  try {
    const d = await itemData({ kind: 'sports', props: { follow: [{ type: 'league', league: 'esp.1' }], show: 'auto', max: 8, crests: true } });
    const tokens = [...new Set(d.groups.flatMap((g) => g.games.flatMap((x) => [x.home.cr, x.away.cr])).filter(Boolean))];
    assert.ok(tokens.length >= 4, 'the fake round has crests');
    const imgs = await Promise.all(tokens.map((tk) => crestImage(tk)));
    assert.ok(imgs.every((i) => i.type === 'image/png'));
    assert.equal(most, 1, 'never two crest calls at the same time');
    assert.ok(crestCalls.every((c) => c.host === DATA_HOSTS.espnImg));
    await Promise.all(tokens.map((tk) => crestImage(tk)));
    assert.equal(crestCalls.length, tokens.length, 'then from the cache');
  } finally {
    setDataFetch();
  }
});
