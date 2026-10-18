import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import worker from "../src/worker.ts";

const origin = "https://collection.example.test",
  providerOrigin = "https://guestbook.example.test";
const source = (resource) => ({
  kind: "guestbook.resource",
  version: 1,
  resource,
  configuration: 1,
});
const a = source("00000000-0000-4000-8000-000000000001"),
  b = source("00000000-0000-4000-8000-000000000002");
function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON");
  sqlite.exec(
    readFileSync(new URL("../migrations/0001.sql", import.meta.url), "utf8"),
  );
  sqlite.exec(
    readFileSync(
      new URL("../migrations/0002_scoped_sources.sql", import.meta.url),
      "utf8",
    ),
  );
  const faults = { lostInsert: false, failedReconciliation: false };
  const statement = (sql, params = []) => ({
    bind(...values) {
      return statement(sql, values);
    },
    async first() {
      const result = sqlite.prepare(sql).get(...params) ?? null;
      if (faults.lostInsert && sql.startsWith("INSERT INTO cards")) {
        faults.lostInsert = false;
        faults.insertLost = true;
        throw Error("Committed INSERT acknowledgement lost");
      }
      if (
        faults.failedReconciliation &&
        faults.insertLost &&
        sql.startsWith("SELECT id,status FROM cards")
      )
        throw Error("Reconciliation unavailable");
      return result;
    },
    async all() {
      return { results: sqlite.prepare(sql).all(...params) };
    },
    async run() {
      const result = sqlite.prepare(sql).run(...params);
      return { success: true, meta: { changes: Number(result.changes) } };
    },
  });
  const DB = {
    prepare: statement,
    async batch(list) {
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const item of list) results.push(await item.run());
        sqlite.exec("COMMIT");
        return results;
      } catch (cause) {
        sqlite.exec("ROLLBACK");
        throw cause;
      }
    },
  };
  const calls = [];
  const state = {
    eligible: true,
    mutate: (value) => value,
    redirect: false,
    fail: false,
  };
  const item = (scope, id = "same-item") => ({
    contract: 1,
    provider: "guestbook",
    ...(scope ? { resource: scope.resource } : {}),
    id,
    title:
      scope?.resource === a.resource ? "Fictional Trail" : "Fictional Launch",
    description: "A fictional approved contribution",
    visibility: state.eligible ? "public" : "private",
    url:
      providerOrigin +
      (scope ? `/r/${scope.resource}/c/${scope.configuration}` : "") +
      "/item/" +
      id,
    image:
      providerOrigin + (scope ? `/r/${scope.resource}` : "") + "/media/" + id,
  });
  const env = {
    DB,
    OWNER_API_TOKEN: "fictional-owner",
    PUBLIC_ORIGIN: origin,
    PROVIDER_ORIGIN: providerOrigin,
    PROVIDER_ID: "guestbook",
    PROVIDER_MOUNT: "/guestbook",
    ITEM_PROVIDER: {
      async fetch(request) {
        calls.push(request);
        if (state.fail) throw Error("Fictional provider unavailable");
        if (state.redirect)
          return new Response(null, {
            status: 302,
            headers: { Location: "https://unapproved.example.test/" },
          });
        const url = new URL(request.url);
        const match = url.pathname.match(
          /^\/r\/([^/]+)\/c\/(\d+)\/(api\/items)(?:\/([^/]+))?$/,
        );
        let scope, id;
        if (match) {
          scope = { ...a, resource: match[1], configuration: Number(match[2]) };
          id = match[4];
          if (
            ![a.resource, b.resource].includes(scope.resource) ||
            scope.configuration !== 1
          )
            return new Response(null, { status: 404 });
        } else if (url.pathname === "/api/items") {
        } else if (url.pathname.startsWith("/api/items/"))
          id = url.pathname.slice("/api/items/".length);
        else return new Response(null, { status: 404 });
        const value = id
          ? item(scope, id)
          : {
              contract: 1,
              provider: "guestbook",
              ...(scope ? { resource: scope.resource } : {}),
              items: [item(scope)],
            };
        return Response.json(state.mutate(value));
      },
    },
  };
  globalThis.BUILD_SHA = "f".repeat(40);
  globalThis.MANIFEST = { contract: 1, id: "showcase" };
  const request = (path, body, auth = true, writeOrigin = origin) =>
    worker.fetch(
      new Request(origin + path, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          ...(auth ? { Authorization: "Bearer fictional-owner" } : {}),
          Origin: writeOrigin,
          "Content-Type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      env,
      { waitUntil() {} },
    );
  const collect = (scope = a, id = "same-item") =>
    request("/api/cards", { item: id, status: "published", source: scope });
  return {
    sqlite,
    faults,
    env,
    state,
    calls,
    item,
    request,
    collect,
    close() {
      assert.deepEqual(sqlite.prepare("PRAGMA foreign_key_check").all(), []);
      sqlite.close();
    },
  };
}

test("forward migration preserves authored/legacy records and settings while separating resource/configuration identity", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("PRAGMA foreign_keys=ON");
    db.exec(
      readFileSync(new URL("../migrations/0001.sql", import.meta.url), "utf8"),
    );
    db.prepare("INSERT INTO cards VALUES(?,?,?,?,?,?,?,?)").run(
      "legacy",
      "Keep title",
      "Keep description",
      null,
      "guestbook",
      "same-item",
      0,
      "published",
    );
    db.prepare("INSERT INTO settings VALUES(?,?)").run(
      "config",
      '{"ownerExtension":"preserve"}',
    );
    const prior = db.prepare("SELECT * FROM cards").all();
    db.exec(
      readFileSync(
        new URL("../migrations/0002_scoped_sources.sql", import.meta.url),
        "utf8",
      ),
    );
    assert.deepEqual(
      db
        .prepare(
          "SELECT id,title,description,url,provider,item_id,position,status FROM cards",
        )
        .all(),
      prior,
    );
    assert.equal(
      db.prepare("SELECT value FROM settings").get().value,
      '{"ownerExtension":"preserve"}',
    );
    for (const [id, resource, configuration] of [
      ["a", a.resource, 1],
      ["b", b.resource, 1],
      ["a2", a.resource, 2],
    ])
      db.prepare("INSERT INTO cards VALUES(?,?,?,?,?,?,?,?,?,?)").run(
        id,
        "",
        "",
        null,
        "guestbook",
        "same-item",
        1,
        "published",
        resource,
        configuration,
      );
    assert.throws(
      () =>
        db
          .prepare("INSERT INTO cards VALUES(?,?,?,?,?,?,?,?,?,?)")
          .run(
            "collision",
            "",
            "",
            null,
            "guestbook",
            "same-item",
            1,
            "published",
            a.resource,
            1,
          ),
      /UNIQUE/,
    );
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    db.close();
  }
});

test("owner explicitly collects two independently scoped sources, with stable card IDs and no copied metadata", async () => {
  const f = fixture();
  try {
    for (const scope of [a, b]) {
      const response = await f.request(
        "/api/provider?source=" + encodeURIComponent(JSON.stringify(scope)),
      );
      assert.equal(response.status, 200);
      const value = await response.json();
      assert.deepEqual(value.source, scope);
      assert.equal(value.items[0].resource, scope.resource);
    }
    const one = await f.collect(a),
      two = await f.collect(b);
    assert.equal(one.status, 201);
    assert.equal(two.status, 201);
    const first = await one.json(),
      second = await two.json();
    assert.notEqual(first.id, second.id);
    const cards = (
      await (await f.request("/api/cards", undefined, false)).json()
    ).cards;
    assert.equal(cards.length, 2);
    assert.deepEqual(
      cards.map((card) => card.source.resource),
      [a.resource, b.resource],
    );
    assert(
      cards.every((card) =>
        card.image.includes("/r/" + card.source.resource + "/media/"),
      ),
    );
    assert.deepEqual(
      f.sqlite
        .prepare("SELECT title,description,url FROM cards")
        .all()
        .map((row) => ({ ...row })),
      [
        { title: "", description: "", url: null },
        { title: "", description: "", url: null },
      ],
    );
    const retry = await f.collect(a);
    assert.equal(retry.status, 200);
    assert.deepEqual(await retry.json(), {
      id: first.id,
      status: "published",
      outcome: "unchanged",
      source: a,
    });
    assert.equal(
      f.sqlite.prepare("SELECT COUNT(*) AS n FROM cards").get().n,
      2,
    );
    for (const call of f.calls) {
      assert.equal(call.redirect, "manual");
      assert.equal(call.headers.get("Authorization"), null);
      assert.equal(new URL(call.url).origin, providerOrigin);
    }
  } finally {
    f.close();
  }
});

test("only absent source selects legacy; malformed, duplicate and unsupported selection never fetch a fallback", async () => {
  const f = fixture();
  try {
    for (const value of [
      null,
      {},
      [],
      { ...a, version: 2 },
      { ...a, configuration: 0 },
      { ...a, configuration: 1.5 },
      { ...a, resource: "../private" },
      { ...a, target: "https://unapproved.example.test" },
    ]) {
      assert.equal((await f.collect(value)).status, 400);
      assert.equal(
        (
          await f.request(
            "/api/provider?source=" + encodeURIComponent(JSON.stringify(value)),
          )
        ).status,
        400,
      );
    }
    for (const query of [
      "source=" +
        encodeURIComponent(JSON.stringify(a)) +
        "&source=" +
        encodeURIComponent(JSON.stringify(b)),
      "source=" + encodeURIComponent(JSON.stringify(a)) + "&target=x",
      "source=" + "a".repeat(513),
      "resource=" + a.resource,
    ])
      assert.equal((await f.request("/api/provider?" + query)).status, 400);
    assert.equal(
      (
        await f.request("/api/cards", {
          item: "same-item",
          resource: a.resource,
          status: "published",
        })
      ).status,
      400,
    );
    assert.equal(f.calls.length, 0);
    assert.equal(
      (
        await f.request("/api/cards", {
          item: "same-item",
          status: "published",
        })
      ).status,
      201,
    );
    assert.equal(new URL(f.calls.at(-1).url).pathname, "/api/items/same-item");
  } finally {
    f.close();
  }
});

test("foreign resources, configuration paths, item IDs and redirect URLs fail closed before collection", async () => {
  const f = fixture();
  try {
    for (const patch of [
      { resource: b.resource },
      { id: "another-item" },
      { provider: "other" },
      { url: providerOrigin + `/r/${a.resource}/c/2/item/same-item` },
      { url: providerOrigin + "/item/same-item" },
      { image: providerOrigin + `/r/${b.resource}/media/same-item` },
      { image: "https://private.example.test/media/same-item" },
      { url: "https://user:secret@guestbook.example.test/item/same-item" },
      { title: { html: "unsafe" } },
      { visibility: "private" },
    ]) {
      f.state.mutate = (value) => ({ ...value, ...patch });
      assert.equal((await f.collect()).status, 409);
    }
    f.state.mutate = (value) => value;
    assert.equal((await f.collect({ ...a, configuration: 2 })).status, 409);
    f.state.redirect = true;
    assert.equal((await f.collect()).status, 409);
    assert.equal(
      f.sqlite.prepare("SELECT COUNT(*) AS n FROM cards").get().n,
      0,
    );
  } finally {
    f.close();
  }
});

test("revocation removes all public content and export metadata while retaining explicit source identity", async () => {
  const f = fixture();
  try {
    const saved = await (await f.collect()).json();
    f.sqlite
      .prepare("UPDATE cards SET title=?,description=?,url=? WHERE id=?")
      .run(
        "Stale private title",
        "Stale private description",
        "https://stale.example.test/",
        saved.id,
      );
    const available = (await (await f.request("/api/export")).json()).cards[0];
    assert.equal(available.sourceState, "available");
    assert.equal(available.title, "Fictional Trail");
    f.state.eligible = false;
    assert.deepEqual(
      (await (await f.request("/api/cards", undefined, false)).json()).cards,
      [],
    );
    const html = await (await f.request("/", undefined, false)).text();
    assert.doesNotMatch(html, /Stale private|Fictional Trail/);
    const exported = (await (await f.request("/api/export")).json()).cards[0];
    assert.equal(exported.sourceState, "unavailable");
    assert.equal(exported.source_resource, a.resource);
    for (const field of ["title", "description", "url", "image"])
      assert.equal(Object.hasOwn(exported, field), false);
    assert.equal(
      (await f.request("/api/cards", { id: saved.id, status: "published" }))
        .status,
      409,
    );
    f.state.fail = true;
    assert.equal(
      (await (await f.request("/api/export")).json()).cards[0].sourceState,
      "unavailable",
    );
    f.state.fail = false;
    f.state.eligible = true;
    const restored = (
      await (await f.request("/api/cards", undefined, false)).json()
    ).cards[0];
    assert.equal(restored.id, saved.id);
    assert.equal(restored.title, "Fictional Trail");
  } finally {
    f.close();
  }
});

test("partially corrupted stored selection never revives a legacy item or copied content", async () => {
  const f = fixture();
  try {
    const saved = await (await f.collect()).json();
    f.calls.length = 0;
    f.sqlite
      .prepare("UPDATE cards SET source_configuration=NULL,title=? WHERE id=?")
      .run("Do not expose", saved.id);
    assert.deepEqual(
      (await (await f.request("/api/cards", undefined, false)).json()).cards,
      [],
    );
    const card = (await (await f.request("/api/export")).json()).cards[0];
    assert.equal(card.sourceState, "unavailable");
    assert.equal(Object.hasOwn(card, "title"), false);
    assert.equal(f.calls.length, 0);
  } finally {
    f.close();
  }
});

test("owner and write-origin checks precede scoped reads and mutations; unavailable app never creates a card", async () => {
  const f = fixture();
  try {
    assert.equal(
      (
        await f.request(
          "/api/provider?source=" + encodeURIComponent(JSON.stringify(a)),
          undefined,
          false,
        )
      ).status,
      401,
    );
    assert.equal(
      (await f.request("/api/cards", { source: a, item: "same-item" }, false))
        .status,
      401,
    );
    assert.equal(f.calls.length, 0);
    f.env.OWNER_API_TOKEN = "";
    assert.equal(
      (
        await f.request(
          "/api/cards",
          { source: a, item: "same-item" },
          true,
          "https://other.example.test",
        )
      ).status,
      401,
    );
    f.env.OWNER_API_TOKEN = "fictional-owner";
    f.state.fail = true;
    assert.equal((await f.collect()).status, 409);
    assert.equal(
      (
        await f.request(
          "/api/provider?source=" + encodeURIComponent(JSON.stringify(a)),
        )
      ).status,
      503,
    );
    assert.equal(
      f.sqlite.prepare("SELECT COUNT(*) AS n FROM cards").get().n,
      0,
    );
  } finally {
    f.close();
  }
});

test("a committed collection INSERT with a lost acknowledgement reconciles the original stable ID", async () => {
  const f = fixture();
  try {
    f.faults.lostInsert = true;
    const response = await f.collect();
    assert.equal(response.status, 200);
    const receipt = await response.json();
    assert.equal(receipt.outcome, "applied");
    assert.equal(f.sqlite.prepare("SELECT id FROM cards").get().id, receipt.id);
    assert.equal((await (await f.collect()).json()).id, receipt.id);
    assert.equal(
      f.sqlite.prepare("SELECT COUNT(*) AS n FROM cards").get().n,
      1,
    );
  } finally {
    f.close();
  }
});

test("an unavailable reconciliation reports unknown and a later explicit export confirms the one committed card", async () => {
  const f = fixture();
  try {
    f.faults.lostInsert = true;
    f.faults.failedReconciliation = true;
    const response = await f.collect();
    assert.equal(response.status, 503);
    const unknown = await response.json();
    assert.equal(unknown.outcome, "unknown");
    assert.match(unknown.message, /may already be collected.*Check/);
    assert.equal(
      f.sqlite.prepare("SELECT COUNT(*) AS n FROM cards").get().n,
      1,
    );
    f.faults.failedReconciliation = false;
    const saved = (await (await f.request("/api/export")).json()).cards[0];
    assert.equal(saved.id, unknown.id);
    assert.equal(saved.sourceState, "available");
    assert.deepEqual(saved.source, a);
    assert.equal((await (await f.collect()).json()).id, unknown.id);
    assert.equal(
      f.sqlite.prepare("SELECT COUNT(*) AS n FROM cards").get().n,
      1,
    );
  } finally {
    f.close();
  }
});

test("concurrent collection requests share one source key and never overwrite another card", async () => {
  const f = fixture();
  try {
    const responses = await Promise.all(
      Array.from({ length: 8 }, () => f.collect()),
    );
    const receipts = await Promise.all(
      responses.map(async (response) => {
        assert([200, 201].includes(response.status));
        return response.json();
      }),
    );
    assert.equal(new Set(receipts.map((row) => row.id)).size, 1);
    assert.equal(
      f.sqlite.prepare("SELECT COUNT(*) AS n FROM cards").get().n,
      1,
    );
  } finally {
    f.close();
  }
});
