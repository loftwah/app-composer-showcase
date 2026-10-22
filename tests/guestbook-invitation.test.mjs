import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../src/worker.ts';

const resource = 'fictional-book-0001';
const source = { kind: 'guestbook.resource', version: 1, resource, configuration: 1 };
const config = {
  title: 'Fictional garden',
  intro: 'A public fictional profile',
  theme: 'midnight',
  layout: 'profile',
  handle: 'garden.studio',
  website: '',
  github: '',
  x: '',
  avatar: '',
  banner: '',
  shareImage: '',
  linkedin: '',
};
const limits = { message: 160, alias: 60, width: 1200, height: 900, bytes: 100000 };

function fixture({ mounted = false, state = 'open', configuration = 1 } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  sqlite.exec(readFileSync(new URL('../migrations/0001.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0002_scoped_sources.sql', import.meta.url), 'utf8'));
  const statement = (sql, values = []) => ({
    bind(...next) { return statement(sql, next); },
    async first() { return sqlite.prepare(sql).get(...values) ?? null; },
    async all() { return { results: sqlite.prepare(sql).all(...values) }; },
    async run() { const result = sqlite.prepare(sql).run(...values); return { success: true, meta: { changes: Number(result.changes) } }; },
  });
  const publicOrigin = mounted ? 'https://composer.example.test' : 'https://showcase.example.test';
  const providerOrigin = mounted ? 'https://composer.example.test' : 'https://guestbook.example.test';
  const providerBase = mounted ? '/guestbook' : '';
  const providerPath = `${providerOrigin}${providerBase}/r/${resource}`;
  const calls = [];
  const env = {
    DB: { prepare: statement, async batch(list) { sqlite.exec('BEGIN'); try { const results = []; for (const item of list) results.push(await item.run()); sqlite.exec('COMMIT'); return results; } catch (error) { sqlite.exec('ROLLBACK'); throw error; } } },
    OWNER_API_TOKEN: 'fictional-owner',
    PUBLIC_ORIGIN: publicOrigin,
    PROVIDER_ORIGIN: providerOrigin,
    PROVIDER_BASE: mounted ? '/guestbook' : undefined,
    PROVIDER_ID: 'guestbook',
    PROVIDER_MOUNT: '/guestbook',
    ITEM_PROVIDER: {
      async fetch(request) {
        calls.push(request);
        const path = new URL(request.url).pathname;
        if (path === `${providerBase}/api/items`)
          return Response.json({ contract: 1, provider: 'guestbook', items: [] });
        if (path === `${providerBase}/r/${resource}/api/invitation`)
          return Response.json({
            contract: 1,
            provider: 'guestbook',
            resource,
            invitation: {
              version: 1,
              kind: 'postcard',
              state,
              accepts: state === 'open',
              configuration,
              contribute: `${providerPath}/c/${configuration}/contribute`,
              collection: `${providerPath}/c/${configuration}/`,
              limits,
            },
          });
        return new Response(null, { status: 404 });
      },
    },
  };
  globalThis.BUILD_SHA = 'f'.repeat(40);
  globalThis.MANIFEST = { id: 'showcase', contract: 1 };
  const base = mounted ? '/showcase' : '';
  const currentSetting = () => {
    const row = sqlite.prepare("SELECT value FROM settings WHERE id='invitation'").get();
    return row ? JSON.parse(row.value) : null;
  };
  const request = (path, body, auth = true, origin = publicOrigin) => {
    // Ordinary clients send the setting they observed. Tests that exercise a
    // stale observation pass expected explicitly; omitting it must fail.
    const command = body && path === '/api/invitation' && body.action && !('expected' in body)
      ? { ...body, expected: currentSetting() }
      : body;
    return worker.fetch(new Request(publicOrigin + base + path, {
      method: command === undefined ? 'GET' : 'POST',
      headers: { ...(auth ? { Authorization: 'Bearer fictional-owner' } : {}), Origin: origin, 'Content-Type': 'application/json' },
      ...(command === undefined ? {} : { body: JSON.stringify(command) }),
    }), env, { waitUntil() { } });
  };
  return { sqlite, env, calls, request, currentSetting, publicOrigin, providerPath, close() { sqlite.close(); } };
}

test('an owner links the exact Guestbook and the profile offers the real form only while it is open', async () => {
  const f = fixture();
  try {
    assert.equal((await f.request('/api/invitation', undefined, false)).status, 401);
    assert.equal((await f.request('/api/invitation', { action: 'enable', source }, false)).status, 401);
    assert.equal((await f.request('/api/invitation', { action: 'enable', source }, false, 'https://foreign.example.test')).status, 403);
    assert.equal((await f.request('/api/invitation', { action: 'enable', source: { ...source, resource: '../private' } })).status, 400);
    assert.equal(f.calls.length, 0, 'invalid or unauthenticated selections reach no provider');

    const enabled = await f.request('/api/invitation', { action: 'enable', source });
    assert.equal(enabled.status, 200);
    const receipt = await enabled.json();
    assert.equal(receipt.configured, true);
    assert.deepEqual(receipt.source, source);
    assert.equal(receipt.invitation.state, 'open');
    assert.equal(f.calls.at(-1).headers.get('Authorization'), null, 'the public invitation check carries no owner credential');

    const page = await (await f.request('/', undefined, false)).text();
    assert.match(page, /<h2 id="guestbook-note-title">Leave a note<\/h2>/);
    assert.match(page, /Leave a note in the guestbook/);
    assert.match(page, new RegExp(`href="https://guestbook\\.example\\.test/r/${resource}/c/1/contribute"`));
    assert.match(page, /See approved notes/);
    assert.match(page, /stays private|reviewed by the owner before anyone else/i);
    assert.doesNotMatch(page, /hunter2|OWNER_API_TOKEN|not-a-credential/);

    const exported = await (await f.request('/api/export')).json();
    assert.deepEqual(exported.guestbookInvitation, { version: 1, source });
    assert.equal(exported.cards.length, 0, 'linking an invitation does not feature or copy a contribution');

    const current = await (await f.request('/api/invitation')).json();
    assert.equal(current.invitation.state, 'open');

    assert.equal((await f.request('/api/invitation', { action: 'disable' })).status, 200);
    const closedPage = await (await f.request('/', undefined, false)).text();
    assert.doesNotMatch(closedPage, /guestbook-note-title/);
    assert.equal((await (await f.request('/api/export')).json()).guestbookInvitation, null);
  } finally { f.close(); }
});

test('a stale tab cannot stop or replace a newer invitation choice', async () => {
  const f = fixture();
  try {
    const first = { kind: 'guestbook.resource', version: 1, resource, configuration: 1 };
    const second = { kind: 'guestbook.resource', version: 1, resource, configuration: 2 };
    const enabledA = await (await f.request('/api/invitation', { action: 'enable', source: first, expected: null })).json();
    assert.equal(enabledA.configured, true);
    const settingA = { version: 1, source: first };
    const enabledB = await (await f.request('/api/invitation', { action: 'enable', source: second, expected: settingA })).json();
    assert.equal(enabledB.configured, true);
    assert.deepEqual(enabledB.source, second);

    const staleStop = await f.request('/api/invitation', { action: 'disable', expected: settingA });
    assert.equal(staleStop.status, 409);
    assert.match((await staleStop.json()).error, /changed in another tab/i);
    assert.deepEqual(f.currentSetting(), { version: 1, source: second }, 'the newer choice survives');

    const staleReplace = await f.request('/api/invitation', { action: 'enable', source: first, expected: settingA });
    assert.equal(staleReplace.status, 409);
    assert.deepEqual(f.currentSetting(), { version: 1, source: second });

    const missingExpected = await f.request('/api/invitation', { action: 'disable', expected: undefined });
    assert.equal(missingExpected.status, 400);
    assert.deepEqual(f.currentSetting(), { version: 1, source: second });

    const current = await (await f.request('/api/invitation')).json();
    assert.deepEqual(current.source, second);
    assert.equal((await f.request('/api/invitation', { action: 'disable', expected: { version: 1, source: second } })).status, 200);
    assert.equal(f.currentSetting(), null);
    assert.equal((await f.request('/api/invitation', { action: 'disable', expected: null })).status, 200, 'stopping an already-stopped invitation is a no-op');
  } finally { f.close(); }
});

for (const state of ['paused', 'closed', 'full']) test(`the ${state} contribution state is explained without a deceptive send action`, async () => {
  const f = fixture({ state });
  try {
    assert.equal((await f.request('/api/invitation', { action: 'enable', source })).status, 200);
    const page = await (await f.request('/', undefined, false)).text();
    assert.match(page, /<h2 id="guestbook-note-title">Leave a note<\/h2>/);
    assert.match(page, /reviewed by the owner before anyone else/i);
    assert.doesNotMatch(page, /Leave a note in the guestbook/, 'no send CTA unless the source accepts postcards');
    assert.match(page, state === 'full' ? /review queue is full/i : new RegExp(`${state === 'paused' ? 'paused' : 'closed'}`, 'i'));
    assert.match(page, /See approved notes/, 'browsing approved notes remains useful');
  } finally { f.close(); }
});

test('the active Guestbook configuration is followed after a reviewable configuration advance', async () => {
  const f = fixture({ configuration: 2 });
  try {
    assert.equal((await f.request('/api/invitation', { action: 'enable', source })).status, 200);
    const page = await (await f.request('/', undefined, false)).text();
    assert.match(page, new RegExp(`href="https://guestbook\\.example\\.test/r/${resource}/c/2/contribute"`));
    assert.doesNotMatch(page, /\/c\/1\/contribute/);
  } finally { f.close(); }
});

for (const [name, respond] of [
  ['a foreign resource', () => Response.json({ contract: 1, provider: 'guestbook', resource: 'other-book-0002', invitation: { version: 1, kind: 'postcard', state: 'open', accepts: true, configuration: 1, contribute: 'https://guestbook.example.test/r/other-book-0002/c/1/contribute', collection: 'https://guestbook.example.test/r/other-book-0002/c/1/', limits } })],
  ['a redirect', () => new Response(null, { status: 302, headers: { Location: 'https://unapproved.example.test/' } })],
  ['a foreign contribute URL', () => Response.json({ contract: 1, provider: 'guestbook', resource, invitation: { version: 1, kind: 'postcard', state: 'open', accepts: true, configuration: 1, contribute: 'https://unapproved.example.test/contribute', collection: `https://guestbook.example.test/r/${resource}/c/1/`, limits } })],
  ['a changed limit', () => Response.json({ contract: 1, provider: 'guestbook', resource, invitation: { version: 1, kind: 'postcard', state: 'open', accepts: true, configuration: 1, contribute: `https://guestbook.example.test/r/${resource}/c/1/contribute`, collection: `https://guestbook.example.test/r/${resource}/c/1/`, limits: { ...limits, bytes: 140000 } } })],
]) test(`${name} is unavailable and is never saved as an invitation`, async () => {
  const f = fixture();
  try {
    f.env.ITEM_PROVIDER.fetch = async request => new URL(request.url).pathname.endsWith('/api/items')
      ? Response.json({ contract: 1, provider: 'guestbook', items: [] })
      : respond();
    assert.equal((await f.request('/api/invitation', { action: 'enable', source })).status, 503);
    assert.equal(f.sqlite.prepare("SELECT value FROM settings WHERE id='invitation'").get(), undefined);
    const page = await (await f.request('/', undefined, false)).text();
    assert.doesNotMatch(page, /guestbook-note-title|Leave a note in the guestbook/);
  } finally { f.close(); }
});

test('a saved invitation that can no longer be verified is quiet, not an open or dead form', async () => {
  const f = fixture();
  try {
    assert.equal((await f.request('/api/invitation', { action: 'enable', source })).status, 200);
    f.env.ITEM_PROVIDER.fetch = async () => { throw Error('Fictional provider outage'); };
    const page = await (await f.request('/', undefined, false)).text();
    assert.match(page, /guestbook cannot be reached right now/i);
    assert.doesNotMatch(page, /Leave a note in the guestbook|See approved notes/);
    assert.doesNotMatch(page, /href="https:\/\/guestbook\.example\.test/);
    f.sqlite.prepare("UPDATE settings SET value='{invalid' WHERE id='invitation'").run();
    const invalid = await (await f.request('/', undefined, false)).text();
    assert.match(invalid, /guestbook cannot be reached right now/i);
    assert.doesNotMatch(invalid, /Leave a note in the guestbook/);
  } finally { f.close(); }
});

for (const layout of ['profile', 'grid', 'editorial', 'compact']) test(`the non-profile ${layout} view explains the same contribution relationship`, async () => {
  const f = fixture();
  try {
    assert.equal((await f.request('/api/config', { ...config, layout })).status, 200);
    assert.equal((await f.request('/api/invitation', { action: 'enable', source })).status, 200);
    const page = await (await f.request('/', undefined, false)).text();
    assert.match(page, /Guestbook is where a visitor writes|Leave a note/);
    assert.match(page, /Leave a note in the guestbook/);
  } finally { f.close(); }
});

test('mounted Linkarooie uses the composed Guestbook route while standalone keeps the independent address', async () => {
  for (const mounted of [false, true]) {
    const f = fixture({ mounted });
    try {
      assert.equal((await f.request('/api/invitation', { action: 'enable', source })).status, 200);
      const page = await (await f.request('/', undefined, false)).text();
      const expected = mounted
        ? `href="/guestbook/r/${resource}/c/1/contribute"`
        : `href="https://guestbook.example.test/r/${resource}/c/1/contribute"`;
      assert.match(page, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      assert.match(page, mounted ? /href="\/guestbook\/r\// : /href="https:\/\/guestbook\.example\.test\/r\//);
    } finally { f.close(); }
  }
});

test('the owner studio explains review, approval and separate featuring and can stop inviting', async () => {
  const f = fixture();
  try {
    await f.request('/api/config', config);
    const before = await (await f.request('/owner')).text();
    assert.match(before, /Guestbook is where a visitor writes a short postcard/);
    assert.match(before, /owner reviews it privately/);
    assert.match(before, /Featuring is a separate choice/);
    assert.doesNotMatch(before, /Leave a note in the guestbook/);
    assert.equal((await f.request('/api/invitation', { action: 'enable', source })).status, 200);
    const after = await (await f.request('/owner')).text();
    assert.match(after, /Stop inviting notes from this Guestbook/);
    assert.match(after, /name="expected"/, 'the owner form carries the observed setting');
    assert.match(after, /Open\. Visitors can send a note/);
    assert.match(after, /Review and approve notes in the Guestbook studio/);
    assert.equal((await f.request('/api/invitation', { action: 'disable' })).status, 200);
    const disabled = await (await f.request('/owner')).text();
    assert.doesNotMatch(disabled, /Stop inviting notes from this Guestbook/);
  } finally { f.close(); }
});
