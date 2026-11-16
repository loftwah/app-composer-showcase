import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import worker from "../src/worker.ts";
import {
  incrementUsage,
  publicUsageProof,
  readUsageSettings,
  recordUsageAction,
  usageReport,
  usageWindow,
  UsageError,
} from "../src/usage.ts";

globalThis.BUILD_SHA = "f".repeat(40);
globalThis.MANIFEST = { id: "showcase", contract: 1 };
const origin = "https://showcase.example.test";
const token = "fictional-owner";
const migration = (name) =>
  readFileSync(new URL("../migrations/" + name, import.meta.url), "utf8");
function fixture({ enabled = false, publicBlock = false } = {}) {
  const sqlite = new DatabaseSync(":memory:");
  for (const file of [
    "0001.sql",
    "0002_scoped_sources.sql",
    "0003_member_profiles.sql",
    "0004_usage.sql",
  ])
    sqlite.exec(migration(file));
  sqlite
    .prepare("UPDATE usage_settings SET enabled=?,public_block=? WHERE id=1")
    .run(enabled ? 1 : 0, publicBlock ? 1 : 0);
  const statement = (sql, values = []) => ({
    bind: (...next) => statement(sql, next),
    async first() {
      return sqlite.prepare(sql).get(...values) ?? null;
    },
    async all() {
      return { results: sqlite.prepare(sql).all(...values) };
    },
    async run() {
      sqlite.prepare(sql).run(...values);
      return { success: true };
    },
  });
  return { sqlite, db: { prepare: statement } };
}
function call(db, path, { method = "GET", headers = {}, body } = {}) {
  const request = new Request(origin + path, {
    method,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
  return worker.fetch(
    request,
    {
      DB: db,
      OWNER_API_TOKEN: token,
      PUBLIC_ORIGIN: origin,
    },
    { waitUntil() {} },
  );
}
const owner = { Authorization: "Bearer " + token };
const seed = (sqlite, day, kind, key, count) =>
  sqlite
    .prepare("INSERT INTO usage_daily(day,kind,key,count) VALUES(?,?,?,?)")
    .run(day, kind, key, count);
const rows = (sqlite) =>
  sqlite
    .prepare("SELECT day,kind,key,count FROM usage_daily ORDER BY day,kind,key")
    .all()
    .map((row) => ({ ...row }));

test("usage schema stores only aggregate day/kind/key/count rows with strict bounds", () => {
  const sqlite = new DatabaseSync(":memory:");
  try {
    sqlite.exec(migration("0004_usage.sql"));
    const daily = sqlite.prepare("PRAGMA table_info(usage_daily)").all().map((c) => c.name);
    assert.deepEqual(daily, ["day", "kind", "key", "count"]);
    const settings = sqlite.prepare("PRAGMA table_info(usage_settings)").all().map((c) => c.name);
    assert.deepEqual(settings, ["id", "enabled", "public_block", "updated_at"]);
    const identifying = /(^|_)(ip|agent|referrer|cookie|session|visitor|url|query)($|_)/i;
    for (const column of [...daily, ...settings]) assert.doesNotMatch(column, identifying);
    assert.deepEqual(
      { ...sqlite.prepare("SELECT enabled,public_block FROM usage_settings WHERE id=1").get() },
      { enabled: 0, public_block: 0 },
    );
    const insert = sqlite.prepare("INSERT INTO usage_daily(day,kind,key,count) VALUES(?,?,?,?)");
    for (const [day, kind, key, count] of [
      ["2026-02-30", "profile_open", "profile", 1],
      ["2026-13-01", "profile_open", "profile", 1],
      ["2026-11-16", "visit", "profile", 1],
      ["2026-11-16", "profile_open", "", 1],
      ["2026-11-16", "profile_open", "x".repeat(65), 1],
      ["2026-11-16", "link_action", "card", 0],
      ["2026-11-16", "link_action", "card", 100001],
      ["2026-11-16", "link_action", "card", 1.5],
      ["2026-11-16", "link_action", "https://example.test/?query=secret", 1],
      ["2026-11-16", "share_action", "email", 1],
      ["2026-11-16", "profile_open", "card", 1],
    ])
      assert.throws(() => insert.run(day, kind, key, count), /constraint/i, String([day, kind, count]));
    insert.run("2026-11-16", "link_action", "a".repeat(64), 100000);
    assert.equal(sqlite.prepare("SELECT count FROM usage_daily").get().count, 100000);
    assert.throws(
      () => sqlite.prepare("UPDATE usage_settings SET public_block=2 WHERE id=1").run(),
      /constraint/i,
    );
  } finally {
    sqlite.close();
  }
});

test("usage events accept only published cards and allowlisted share methods", async () => {
  const { sqlite, db } = fixture({ enabled: true });
  try {
    sqlite
      .prepare("INSERT INTO cards(id,title,description,url,position,status) VALUES(?,?,?,?,?,?)")
      .run("published-card", "Published", "", "https://example.test/", 0, "published");
    sqlite
      .prepare("INSERT INTO cards(id,title,description,url,position,status) VALUES(?,?,?,?,?,?)")
      .run("draft-card", "Draft", "", "https://example.test/private", 1, "draft");
    const action = (body) =>
      call(db, "/api/usage/action", {
        method: "POST",
        headers: { Origin: origin },
        body,
      });
    assert.equal((await action({ kind: "unknown" })).status, 204);
    assert.equal((await action({ kind: "link_action", card: "draft-card" })).status, 204);
    assert.equal((await action({ kind: "link_action", card: "missing-card" })).status, 204);
    assert.equal((await action({ kind: "link_action", card: "<script>" })).status, 204);
    assert.equal((await action({ kind: "share_action", method: "email" })).status, 204);
    assert.deepEqual(rows(sqlite), []);
    assert.equal((await action({ kind: "link_action", card: "published-card" })).status, 204);
    assert.equal((await action({ kind: "share_action", method: "copy" })).status, 204);
    assert.equal((await action({ kind: "share_action", method: "native", extra: "ignored" })).status, 204);
    const saved = rows(sqlite);
    assert.equal(saved.length, 3);
    assert.deepEqual(saved.map((row) => [row.kind, row.key, row.count]), [
      ["link_action", "published-card", 1],
      ["share_action", "copy", 1],
      ["share_action", "native", 1],
    ]);
    const refused = await call(db, "/api/usage/action", {
      method: "POST",
      headers: { Origin: "https://evil.example.test" },
      body: { kind: "link_action", card: "published-card" },
    });
    assert.equal(refused.status, 403);
    const oversized = await call(db, "/api/usage/action", {
      method: "POST",
      headers: { Origin: origin },
      body: { kind: "link_action", card: "published-card", padding: "x".repeat(2048) },
    });
    assert.equal(oversized.status, 413);
    const malformed = await action("{not json");
    assert.equal(malformed.status, 400);
    assert.equal((await call(db, "/api/usage/action")).status, 405);
    assert.equal(rows(sqlite).length, 3);
  } finally {
    sqlite.close();
  }
});

test("usage is off by default and disabled recording still returns 204 without rows", async () => {
  const { sqlite, db } = fixture();
  try {
    sqlite
      .prepare("INSERT INTO cards(id,title,description,url,position,status) VALUES(?,?,?,?,?,?)")
      .run("published-card", "Published", "", "https://example.test/", 0, "published");
    const response = await call(db, "/api/usage/action", {
      method: "POST",
      headers: { Origin: origin },
      body: { kind: "link_action", card: "published-card" },
    });
    assert.equal(response.status, 204);
    assert.deepEqual((await readUsageSettings(db)), {
      enabled: false,
      publicBlock: false,
      updatedAt: "1970-01-01T00:00:00.000Z",
    });
    assert.deepEqual(rows(sqlite), []);
    assert.equal((await call(db, "/")).status, 200);
    assert.deepEqual(rows(sqlite), []);
  } finally {
    sqlite.close();
  }
});

test("daily counting dedupes one row per key and stops at the cap", async () => {
  const { sqlite, db } = fixture({ enabled: true });
  try {
    await incrementUsage(db, "2026-11-15", "profile_open", "profile");
    await incrementUsage(db, "2026-11-15", "profile_open", "profile");
    assert.deepEqual(rows(sqlite), [
      { day: "2026-11-15", kind: "profile_open", key: "profile", count: 2 },
    ]);
    sqlite.prepare("UPDATE usage_daily SET count=100000").run();
    for (let index = 0; index < 3; index++)
      await incrementUsage(db, "2026-11-15", "profile_open", "profile");
    assert.equal(sqlite.prepare("SELECT count FROM usage_daily").get().count, 100000);
    await recordUsageAction(db, { kind: "share_action", method: "download" }, new Date("2026-11-15T23:59:59Z"));
    assert.equal(
      sqlite.prepare("SELECT count FROM usage_daily WHERE kind='share_action'").get().count,
      1,
    );
  } finally {
    sqlite.close();
  }
});

test("reports include complete UTC days only and keep per-link totals to published cards", async () => {
  const { sqlite, db } = fixture({ enabled: true });
  const now = new Date("2026-11-16T12:00:00Z");
  try {
    for (const [id, title, status] of [
      ["published-card", "Published link", "published"],
      ["draft-card", "PRIVATE DRAFT LINK", "draft"],
    ])
      sqlite
        .prepare("INSERT INTO cards(id,title,description,url,position,status) VALUES(?,?,?,?,?,?)")
        .run(id, title, "", "https://example.test/", 0, status);
    seed(sqlite, "2026-11-08", "profile_open", "profile", 5);
    seed(sqlite, "2026-11-09", "profile_open", "profile", 2);
    seed(sqlite, "2026-11-09", "link_action", "published-card", 1);
    seed(sqlite, "2026-11-15", "link_action", "published-card", 3);
    seed(sqlite, "2026-11-15", "link_action", "draft-card", 7);
    seed(sqlite, "2026-11-15", "share_action", "copy", 2);
    seed(sqlite, "2026-11-16", "profile_open", "profile", 9);
    seed(sqlite, "2026-11-01", "profile_open", "profile", 4);
    const week = await usageReport(db, 7, now);
    assert.deepEqual(week.window, { days: 7, start: "2026-11-09", end: "2026-11-16" });
    assert.deepEqual(week.totals, { profileOpens: 2, linkActions: 11, shareActions: 2 });
    assert.equal(week.days.length, 7);
    assert.equal(week.days[0].day, "2026-11-09");
    assert.equal(week.days.at(-1).day, "2026-11-15");
    assert.equal(week.days.some((day) => day.day === "2026-11-16"), false);
    assert.deepEqual(week.links, [{ id: "published-card", title: "Published link", count: 4 }]);
    assert.doesNotMatch(JSON.stringify(week.links), /PRIVATE DRAFT LINK|draft-card/);
    assert.match(week.definition, /Counted requests\/actions, not people/);
    assert.ok(week.quality.some((note) => /today is excluded/i.test(note)));
    assert.ok(week.quality.some((note) => /No IP address/.test(note)));
    const month = await usageReport(db, 30, now);
    assert.deepEqual(month.window, { days: 30, start: "2026-10-17", end: "2026-11-16" });
    assert.equal(month.totals.profileOpens, 11);
    const quarter = await usageReport(db, 90, now);
    assert.deepEqual(quarter.window, { days: 90, start: "2026-08-18", end: "2026-11-16" });
    assert.deepEqual(usageWindow(7, now), week.window);
    await assert.rejects(usageReport(db, 12, now), (error) => error instanceof UsageError && error.status === 400);
  } finally {
    sqlite.close();
  }
});

test("public proof is absent by default, exposes two totals only, and withdrawal hides it", async () => {
  const { sqlite, db } = fixture();
  try {
    sqlite
      .prepare("INSERT INTO cards(id,title,description,url,position,status) VALUES(?,?,?,?,?,?)")
      .run("published-card", "Published link", "", "https://example.test/", 0, "published");
    seed(sqlite, "2026-11-15", "profile_open", "profile", 12);
    seed(sqlite, "2026-11-15", "link_action", "published-card", 3);
    seed(sqlite, "2026-11-15", "share_action", "copy", 8);
    const before = await (await call(db, "/")).text();
    assert.doesNotMatch(before, /data-usage-block/);
    assert.doesNotMatch(before, /usage-beacon\.js/);
    assert.doesNotMatch(before, /data-usage-card/);
    assert.equal((await call(db, "/api/usage/public")).status, 404);
    sqlite.prepare("UPDATE usage_settings SET enabled=1,public_block=1 WHERE id=1").run();
    const page = await call(db, "/");
    assert.equal(page.status, 200);
    const body = await page.text();
    const block = body.match(/<section class="usage-proof" data-usage-block[\s\S]*?<\/section>/)?.[0] ?? "";
    assert.match(block, /<h2 id="usage-proof-title">Usage proof<\/h2>/);
    assert.match(block, /Recorded profile visits/);
    assert.match(block, /Recorded link actions/);
    assert.match(block, /Counted requests\/actions, not people/);
    assert.match(block, /<dd>12<\/dd>/);
    assert.match(block, /<dd>3<\/dd>/);
    assert.doesNotMatch(block, /share|Share|published-card|Published link|copy/);
    assert.match(body, /usage-beacon\.js/);
    assert.match(body, /data-usage-card="published-card"/);
    const published = await call(db, "/api/usage/public");
    assert.equal(published.status, 200);
    const proof = await published.json();
    assert.deepEqual(proof.totals, { profileOpens: 12, linkActions: 3 });
    assert.deepEqual(proof.window.days, 30);
    assert.equal(Object.hasOwn(proof, "links"), false);
    assert.equal(Object.hasOwn(proof, "shareActions"), false);
    sqlite.prepare("UPDATE usage_settings SET public_block=0 WHERE id=1").run();
    const withdrawn = await (await call(db, "/")).text();
    assert.doesNotMatch(withdrawn, /data-usage-block/);
    assert.match(withdrawn, /usage-beacon\.js/, "recording stays enabled");
    assert.equal((await call(db, "/api/usage/public")).status, 404);
    assert.deepEqual(
      rows(sqlite)
        .filter((row) => row.day === "2026-11-15")
        .map((row) => [row.kind, row.key, row.count]),
      [
        ["link_action", "published-card", 3],
        ["profile_open", "profile", 12],
        ["share_action", "copy", 8],
      ],
      "withdrawal retains owner totals",
    );
    assert.equal((await readUsageSettings(db)).enabled, true);
  } finally {
    sqlite.close();
  }
});

test("public proof has an honest zero state", async () => {
  const { sqlite, db } = fixture({ enabled: true, publicBlock: true });
  try {
    const proof = await publicUsageProof(db, new Date("2026-11-16T12:00:00Z"));
    assert.deepEqual(
      { profileOpens: proof.profileOpens, linkActions: proof.linkActions },
      { profileOpens: 0, linkActions: 0 },
    );
    const body = await (await call(db, "/")).text();
    assert.match(body, /data-usage-block/);
    assert.match(body, /No counts were recorded in this complete-day window\./);
    assert.match(
      body,
      /Today's activity is recorded but appears after the UTC day ends\./,
    );
  } finally {
    sqlite.close();
  }
});

test("owner analytics needs a session and settings use same-origin compare-and-swap", async () => {
  const { sqlite, db } = fixture();
  try {
    sqlite
      .prepare("INSERT INTO cards(id,title,description,url,position,status) VALUES(?,?,?,?,?,?)")
      .run("published-card", "Published link", "", "https://example.test/", 0, "published");
    seed(sqlite, "2026-11-15", "link_action", "published-card", 2);
    assert.equal((await call(db, "/api/usage")).status, 401);
    assert.equal((await call(db, "/api/usage?window=30", { headers: { Authorization: "Bearer wrong" } })).status, 401);
    const report = await call(db, "/api/usage?window=7", { headers: owner });
    assert.equal(report.status, 200);
    const value = await report.json();
    assert.equal(value.contract, 1);
    assert.equal(value.window.days, 7);
    assert.equal(value.totals.linkActions, 2);
    assert.deepEqual(value.links, [{ id: "published-card", title: "Published link", count: 2 }]);
    assert.equal((await call(db, "/api/usage?window=12", { headers: owner })).status, 400);
    const ownerPage = await (await call(db, "/owner", { headers: owner })).text();
    assert.match(ownerPage, /data-usage-panel/);
    assert.match(ownerPage, /data-usage-settings/);
    assert.match(ownerPage, /Published link/);
    assert.match(ownerPage, /usage-studio\.js/);

    const settings = (body, headers = { Origin: origin, ...owner }) =>
      call(db, "/api/usage", { method: "POST", headers, body });
    assert.equal((await settings({ enabled: true, publicBlock: false, expected: { enabled: false, publicBlock: false } }, { Origin: "https://evil.example.test", ...owner })).status, 403);
    assert.equal((await settings({ enabled: true, publicBlock: false, expected: { enabled: false, publicBlock: false } }, { Origin: origin })).status, 401);
    assert.equal((await settings({ enabled: false, publicBlock: true, expected: { enabled: false, publicBlock: false } })).status, 400);
    assert.equal((await settings({ enabled: true, publicBlock: false, expected: { enabled: true, publicBlock: true } })).status, 409);
    const saved = await settings({ enabled: true, publicBlock: false, expected: { enabled: false, publicBlock: false } });
    assert.equal(saved.status, 200);
    assert.equal((await saved.json()).settings.enabled, true);
    const published = await settings({ enabled: true, publicBlock: true, expected: { enabled: true, publicBlock: false } });
    assert.equal(published.status, 200);
    assert.equal((await published.json()).settings.publicBlock, true);
    const withdrawn = await settings({ enabled: false, publicBlock: false, expected: { enabled: true, publicBlock: true } });
    assert.equal(withdrawn.status, 200);
    assert.deepEqual((await withdrawn.json()).settings.enabled, false);
    assert.equal(rows(sqlite).length, 1, "settings changes never delete retained counts");
  } finally {
    sqlite.close();
  }
});

test("only a successful public homepage render counts a profile open", async () => {
  const { sqlite, db } = fixture({ enabled: true });
  try {
    const home = (headers = {}) => call(db, "/", { headers });
    assert.equal((await home({ "User-Agent": "Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Safari/605.1.15", "Sec-Fetch-Dest": "document" })).status, 200);
    assert.equal(rows(sqlite)[0].count, 1);
    await home();
    assert.equal(rows(sqlite)[0].count, 2);
    await home({ "User-Agent": "Googlebot/2.1 (+http://www.google.com/bot.html)" });
    await home({ "User-Agent": "Mozilla/5.0 (compatible; bingbot/2.0)" });
    await home({ "X-Composer-Verification": "1" });
    await home({ "Sec-Fetch-Dest": "image" });
    await home({ "User-Agent": "Mozilla/5.0 HeadlessChrome/120.0.0.0" });
    await call(db, "/", { method: "HEAD" });
    await call(db, "/api/cards");
    await call(db, "/owner", { headers: owner });
    assert.equal(rows(sqlite)[0].count, 2);
    assert.equal(rows(sqlite).length, 1);
    const empty = fixture();
    try {
      await call(empty.db, "/");
      assert.deepEqual(rows(empty.sqlite), []);
    } finally {
      empty.sqlite.close();
    }
  } finally {
    sqlite.close();
  }
});

test("usage storage failure never blocks the public page", async () => {
  const { sqlite, db } = fixture({ enabled: true, publicBlock: true });
  try {
    const broken = {
      prepare(sql) {
        if (sql.includes("usage_")) throw Error("simulated storage failure");
        return db.prepare(sql);
      },
    };
    const response = await call(broken, "/");
    assert.equal(response.status, 200);
    assert.match(await response.text(), /<h1 id="collection-title">/);
    assert.equal((await call(broken, "/api/usage/action", {
      method: "POST",
      headers: { Origin: origin },
      body: { kind: "share_action", method: "copy" },
    })).status, 204);
  } finally {
    sqlite.close();
  }
});

test("the beacon sends only a card or method, never cancels navigation, and reports success only", () => {
  const beacon = readFileSync(
    new URL("../public/brand/usage-beacon.js", import.meta.url),
    "utf8",
  );
  assert.match(beacon, /navigator\.sendBeacon/);
  assert.match(beacon, /keepalive: true/);
  assert.match(beacon, /!event\.isTrusted/);
  assert.match(beacon, /event\.button !== 0/);
  assert.match(beacon, /event\.metaKey/);
  assert.match(beacon, /closest\("a\[data-usage-card\]"\)/);
  assert.match(beacon, /kind: "share_action", method/);
  assert.doesNotMatch(beacon, /preventDefault/);
  assert.doesNotMatch(beacon, /location\.href|document\.URL|querySelector\("a"\)\.href/);
  assert.ok(
    beacon.indexOf("navigator.sendBeacon") < beacon.indexOf("fetch(endpoint"),
    "keepalive fetch is only the fallback",
  );
  const share = readFileSync(
    new URL("../public/brand/page-share.mjs", import.meta.url),
    "utf8",
  );
  assert.ok(share.indexOf("navigator.clipboard.writeText") < share.indexOf("recorded('copy')"));
  assert.ok(share.indexOf("await navigator.share") < share.indexOf("recorded('native')"));
  assert.match(share, /error\?\.name!=='AbortError'/);
});
