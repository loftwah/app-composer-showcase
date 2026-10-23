import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import {
  memberProfileBridge,
  publicMemberProfile,
} from "../src/member-profiles.ts";
const receipt = JSON.parse(
  readFileSync(
    new URL("../docs/examples/river-publication.json", import.meta.url),
    "utf8",
  ),
);
const png = readFileSync(
  new URL("../public" + receipt.image.path, import.meta.url),
);
const issuer = "https://composer.test",
  origin = "https://showcase.test",
  token = "fictional-bridge-token",
  source = "a".repeat(40);
function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  for (const file of [
    "0001.sql",
    "0002_scoped_sources.sql",
    "0003_member_profiles.sql",
  ])
    sqlite.exec(
      readFileSync(new URL("../migrations/" + file, import.meta.url), "utf8"),
    );
  const owner = JSON.stringify({
    title: "Existing owner",
    intro: "Owner bio",
    theme: "midnight",
    layout: "profile",
    shareImage: "https://art.test/owner.jpg",
    privateExtension: "OWNER PRIVATE",
  });
  sqlite.prepare("INSERT INTO settings VALUES(?,?)").run("config", owner);
  sqlite
    .prepare(
      "INSERT INTO cards(id,title,description,url,position,status) VALUES('owner-link','Owner','private owner card','https://example.test/',0,'draft')",
    )
    .run();
  let beforeWrite;
  const statement = (sql, values = []) => ({
    bind: (...next) => statement(sql, next),
    async first() {
      if (sql.startsWith("UPDATE member_profiles")) await beforeWrite?.();
      return sqlite.prepare(sql).get(...values) ?? null;
    },
    async all() {
      return { results: sqlite.prepare(sql).all(...values) };
    },
    async run() {
      return {
        success: true,
        meta: { changes: sqlite.prepare(sql).run(...values).changes },
      };
    },
  });
  const env = {
    DB: { prepare: statement },
    PUBLIC_ORIGIN: origin,
    PROFILE_ORIGIN: origin,
    PROVIDER_ORIGIN: "https://guestbook.test",
    PROVIDER_ID: "guestbook",
    PROVIDER_MOUNT: "/guestbook",
    COMPOSER_ISSUER: issuer,
    COMPOSER_PROFILE_BRIDGE_TOKEN: token,
    ASSETS: {
      async fetch() {
        return new Response(png, { headers: { "content-type": "image/png" } });
      },
    },
    ITEM_PROVIDER: {
      async fetch() {
        return Response.json({ contract: 1, provider: "guestbook", items: [] });
      },
    },
  };
  const request = (actor, operation, extra = {}, options = {}) =>
    new Request(origin + (options.base ?? "") + "/api/member-profiles", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "X-Composer-Source": source,
        "X-Composer-Target": origin + (options.base ?? ""),
        ...options.headers,
      },
      body: JSON.stringify({
        version: 1,
        actor: { issuer, subject: actor },
        operation,
        ...extra,
      }),
    });
  const call = async (actor, operation, extra = {}, options = {}) => {
    const response = await memberProfileBridge(
      request(actor, operation, extra, options),
      options.env ?? env,
      options.base ?? "",
      source,
    );
    return { status: response.status, body: await response.json() };
  };
  const update = (actor, state, operation, command) =>
    call(actor, operation, {
      resource: state.resource,
      expectedRevision: state.revision,
      ...(command === undefined ? {} : { command }),
    });
  return {
    sqlite,
    env,
    owner,
    call,
    update,
    request,
    onWrite(fn) {
      beforeWrite = fn;
    },
    close() {
      sqlite.close();
    },
  };
}
const config = (name, handle) => ({
  title: name,
  handle,
  intro: "Fictional independent profile",
  theme: "daylight",
  layout: "profile",
  website: "https://example.org/",
});
test("two distinct stable authenticated profiles preserve owner tables; drafts never enter public pages and handle changes never transfer ownership", async () => {
  const f = fixture();
  try {
    let a = (await f.call("account-A", "create")).body,
      b = (await f.call("account-B", "create")).body;
    assert.notEqual(a.resource, b.resource);
    assert.notEqual(a.shareCard.profile.id, b.shareCard.profile.id);
    assert.equal(
      (await f.call("account-A", "create")).body.resource,
      a.resource,
    );
    a = (
      await f.update("account-A", a, "config", config("River Morgan", "river"))
    ).body;
    b = (
      await f.update("account-B", b, "config", {
        ...config("Sam Finch", "sam"),
        theme: "midnight",
        intro: "A different fictional creator",
      })
    ).body;
    a = (
      await f.update("account-A", a, "cards", {
        action: "create",
        title: "Music workshop",
        description: "Public project",
        url: "https://example.org/music",
        status: "published",
      })
    ).body;
    a = (
      await f.update("account-A", a, "cards", {
        action: "create",
        title: "PRIVATE DRAFT SENTINEL",
        url: "https://private.example.org/",
        status: "draft",
      })
    ).body;
    a = (await f.update("account-A", a, "publish")).body;
    b = (await f.update("account-B", b, "publish")).body;
    for (const [actor, other] of [
      ["account-A", b],
      ["account-B", a],
    ])
      for (const operation of [
        "read",
        "config",
        "export",
        "share-card",
        "publish",
        "hide",
      ])
        assert.equal(
          (
            await f.call(actor, operation, {
              resource: other.resource,
              expectedRevision: other.revision,
              command: { title: "Forged" },
            })
          ).status,
          404,
        );
    const pub = await publicMemberProfile(
        new Request(origin + "/p/river/"),
        f.env,
        "",
        "/p/river/",
      ),
      markup = await pub.text();
    assert.equal(pub.status, 200);
    assert.match(markup, /River Morgan/);
    assert.match(markup, /Music workshop/);
    assert.doesNotMatch(
      markup,
      /PRIVATE|account-A|owner_subject|owner_issuer|Sam Finch/,
    );
    assert.match(
      markup,
      /rel="canonical" href="https:\/\/showcase.test\/p\/river\/"/,
    );
    a = (
      await f.update("account-A", a, "config", {
        title: "UNPUBLISHED NAME",
        handle: "river-new",
      })
    ).body;
    assert.doesNotMatch(
      await (
        await publicMemberProfile(
          new Request(origin + "/p/river/"),
          f.env,
          "",
          "/p/river/",
        )
      ).text(),
      /UNPUBLISHED NAME/,
    );
    a = (await f.update("account-A", a, "publish")).body;
    assert.equal(
      (
        await publicMemberProfile(
          new Request(origin + "/p/river/"),
          f.env,
          "",
          "/p/river/",
        )
      ).status,
      404,
    );
    assert.equal(a.resource, (await f.call("account-A", "read")).body.resource);
    assert.equal(
      (await f.call("account-B", "read", { resource: a.resource })).status,
      404,
    );
    assert.equal(
      f.sqlite.prepare("SELECT value FROM settings WHERE id='config'").get()
        .value,
      f.owner,
    );
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM cards").get().n, 1);
  } finally {
    f.close();
  }
});
test("bridge refuses wrong secret, owner credential, stale source, target and foreign issuer before any writes; standalone disabled", async () => {
  const f = fixture();
  try {
    for (const headers of [
      { Authorization: "Bearer owner-token" },
      { Authorization: "Bearer wrong" },
      { "X-Composer-Source": "b".repeat(40) },
      { "X-Composer-Target": "https://foreign.test" },
    ])
      assert.ok(
        [403, 409].includes(
          (await f.call("account-A", "create", {}, { headers })).status,
        ),
      );
    assert.equal(
      (
        await f.call("account-A", "create", {
          actor: { issuer: "https://foreign.test", subject: "account-A" },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await f.call(
          "account-A",
          "create",
          {},
          { env: { ...f.env, COMPOSER_PROFILE_BRIDGE_TOKEN: undefined } },
        )
      ).status,
      404,
    );
    assert.equal(
      f.sqlite.prepare("SELECT COUNT(*) n FROM member_profiles").get().n,
      0,
    );
  } finally {
    f.close();
  }
});
test("real SQLite CAS rejects interleaved save, duplicate handle and stale publication without losing drafts", async () => {
  const f = fixture();
  try {
    let a = (await f.call("account-A", "create")).body,
      b = (await f.call("account-B", "create")).body;
    a = (await f.update("account-A", a, "config", config("River", "river")))
      .body;
    a = (await f.update("account-A", a, "publish")).body;
    b = (await f.update("account-B", b, "config", config("Sam", "river"))).body;
    assert.equal((await f.update("account-B", b, "publish")).status, 409);
    let once = true;
    f.onWrite(async () => {
      if (!once) return;
      once = false;
      f.sqlite
        .prepare("UPDATE member_profiles SET revision=revision+1 WHERE id=?")
        .run(a.resource);
    });
    assert.equal(
      (await f.update("account-A", a, "config", { intro: "Do not overwrite" }))
        .status,
      409,
    );
    assert.equal(
      (await f.call("account-A", "read")).body.draft.config.intro,
      "Fictional independent profile",
    );
    assert.equal((await f.update("account-A", a, "hide")).status, 409);
  } finally {
    f.close();
  }
});
test("per-profile achievements, tags, presentation, private export, publication, adopted exact card and guarded rollback work in SQLite", async () => {
  const f = fixture();
  try {
    let a = (await f.call("account-A", "create")).body;
    a = (
      await f.update("account-A", a, "config", {
        ...config(receipt.text.name, receipt.text.handle),
        intro: receipt.text.description,
      })
    ).body;
    a = (
      await f.update("account-A", a, "cards", {
        action: "create",
        title: "Fictional writing",
        url: "https://example.org/writing",
        status: "published",
      })
    ).body;
    a = (
      await f.update("account-A", a, "presentation", {
        id: a.draft.cards[0].id,
        pinned: true,
        icon: "book",
        group: "Writing",
      })
    ).body;
    a = (
      await f.update("account-A", a, "achievements", {
        action: "create",
        expectedRevision: 0,
        item: {
          title: "Private milestone",
          description: "PRIVATE MILESTONE",
          date: "2026",
          url: "",
          icon: "star",
          status: "draft",
        },
      })
    ).body;
    const cardReceipt = {
      format: "linkarooie.share-card",
      version: 1,
      image: receipt.image,
      preset: receipt.preset,
      renderer: receipt.renderer,
      text: {
        name: receipt.text.name,
        handle: receipt.text.handle,
        description: receipt.text.description,
      },
      profile: {
        id: a.shareCard.profile.id,
        revision: a.shareCard.profile.revision,
      },
    };
    const adopted = await f.update("account-A", a, "share-card", {
      action: "adopt",
      expectedRevision: a.shareCard.profile.revision,
      receipt: cardReceipt,
    });
    assert.equal(adopted.status, 200, JSON.stringify(adopted.body));
    a = adopted.body;
    assert.equal(a.shareCard.approved.sha256, receipt.image.sha256);
    a = (await f.update("account-A", a, "publish")).body;
    for (const base of ["", "/showcase"]) {
      const page = await publicMemberProfile(
          new Request(origin + base + "/p/" + a.handle + "/"),
          f.env,
          base,
          "/p/" + a.handle + "/",
        ),
        markup = await page.text();
      assert.match(
        markup,
        new RegExp(origin + base + receipt.image.path.replaceAll(".", "\\.")),
      );
      assert.match(markup, /og:image:type" content="image\/png/);
      assert.doesNotMatch(
        markup,
        /PRIVATE MILESTONE|Private milestone|owner_subject/,
      );
      const data = await (
        await publicMemberProfile(
          new Request(origin + base + "/p/" + a.handle + "/api/profile"),
          f.env,
          base,
          "/p/" + a.handle + "/api/profile",
        )
      ).json();
      assert.equal(data.profile.cards.length, 1);
      assert.equal(data.profile.achievements.length, 0);
    }
    const before = a.shareCard.profile.shareImage;
    a = (
      await f.update("account-A", a, "share-card", {
        action: "rollback",
        expectedRevision: a.shareCard.profile.revision,
      })
    ).body;
    assert.notEqual(a.shareCard.profile.shareImage, before);
    a = (await f.update("account-A", a, "publish")).body;
    assert.equal(a.shareCard.approved, null);
    const exported = await f.call("account-A", "export", {
      resource: a.resource,
    });
    assert.match(JSON.stringify(exported.body), /PRIVATE MILESTONE/);
    assert.doesNotMatch(
      JSON.stringify(exported.body),
      /OWNER PRIVATE|owner_subject|account-A/,
    );
  } finally {
    f.close();
  }
});
test("missing-profile write is refused; own settings export/review stays read-only and does not widen the file scope", async () => {
  const f = fixture();
  try {
    assert.deepEqual((await f.call("nobody", "read")).body, {
      ok: true,
      version: 1,
      profile: null,
    });
    assert.equal(
      (
        await f.call("nobody", "config", {
          expectedRevision: 1,
          command: config("No implicit profile", "none"),
        })
      ).status,
      404,
    );
    let a = (await f.call("account-A", "create")).body;
    a = (await f.update("account-A", a, "config", config("River", "river")))
      .body;
    const response = await f.call("account-A", "profile-settings", {
      resource: a.resource,
      command: { action: "export" },
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.revision, a.revision);
    assert.equal(
      response.body.result.file.format,
      "linkarooie.profile-settings",
    );
    assert.equal(response.body.result.file.config.title, "River");
    assert.doesNotMatch(
      JSON.stringify(response.body.result.file),
      /cards|owner|shareImage|_shareCard/,
    );
    const reviewed = await f.update("account-A", a, "profile-settings", {
      action: "review",
      file: response.body.result.file,
    });
    assert.equal(reviewed.status, 200);
    assert.equal(reviewed.body.revision, a.revision);
    assert.equal(reviewed.body.result.saved, false);
  } finally {
    f.close();
  }
});
test("unavailable asset, another-profile receipt and stale card cannot replace an approved manual image", async () => {
  const f = fixture();
  try {
    let a = (await f.call("account-A", "create")).body,
      b = (await f.call("account-B", "create")).body;
    a = (
      await f.update("account-A", a, "config", {
        ...config(receipt.text.name, receipt.text.handle),
        intro: receipt.text.description,
        shareImage: "https://art.test/approved.jpg",
      })
    ).body;
    const card = {
      format: "linkarooie.share-card",
      version: 1,
      profile: {
        id: a.shareCard.profile.id,
        revision: a.shareCard.profile.revision,
      },
      text: {
        name: receipt.text.name,
        handle: receipt.text.handle,
        description: receipt.text.description,
      },
      image: receipt.image,
      preset: receipt.preset,
      renderer: receipt.renderer,
    };
    const command = {
      action: "adopt",
      expectedRevision: a.shareCard.profile.revision,
      receipt: card,
    };
    assert.equal(
      (await f.update("account-B", b, "share-card", command)).status,
      400,
    );
    const savedAssets = f.env.ASSETS;
    f.env.ASSETS = {
      async fetch() {
        return new Response("missing", { status: 404 });
      },
    };
    assert.equal(
      (await f.update("account-A", a, "share-card", command)).status,
      409,
    );
    assert.equal(
      (await f.call("account-A", "read")).body.shareCard.profile.shareImage,
      "https://art.test/approved.jpg",
    );
    f.env.ASSETS = savedAssets;
    a = (await f.update("account-A", a, "share-card", command)).body;
    const old = a;
    a = (
      await f.update("account-A", a, "config", {
        intro: "Newer saved profile text",
      })
    ).body;
    assert.equal(a.shareCard.stale, true);
    assert.equal(
      (
        await f.update("account-A", a, "share-card", {
          action: "rollback",
          expectedRevision: old.shareCard.profile.revision,
        })
      ).status,
      409,
    );
    a = (
      await f.update("account-A", a, "share-card", {
        action: "rollback",
        expectedRevision: a.shareCard.profile.revision,
      })
    ).body;
    assert.equal(
      a.shareCard.profile.shareImage,
      "https://art.test/approved.jpg",
    );
  } finally {
    f.close();
  }
});
test("malformed saved document stays intact and never appears as a public or private profile", async () => {
  const f = fixture();
  try {
    const a = (await f.call("account-A", "create")).body;
    const damaged = JSON.stringify({
      version: 1,
      settings: { config: '{"private":"DO NOT EXPOSE"}' },
      cards: [],
      presentation: {},
      invitation: null,
    });
    f.sqlite
      .prepare(
        "UPDATE member_profiles SET draft=?,published=?,handle=?,visibility=? WHERE id=?",
      )
      .run(damaged, damaged, "river", "published", a.resource);
    const current = await f.call("account-A", "read");
    assert.equal(current.status, 503);
    assert.doesNotMatch(JSON.stringify(current.body), /DO NOT EXPOSE/);
    await assert.rejects(
      publicMemberProfile(
        new Request(origin + "/p/river/"),
        f.env,
        "",
        "/p/river/",
      ),
      (error) => error.status === 503,
    );
    assert.equal(
      f.sqlite
        .prepare("SELECT draft FROM member_profiles WHERE id=?")
        .get(a.resource).draft,
      damaged,
    );
  } finally {
    f.close();
  }
});
test("published source references obey next-request Guestbook revocation and private tags remain unpublished", async () => {
  const f = fixture();
  try {
    const selected = {
      kind: "guestbook.resource",
      version: 1,
      resource: "fictional-book",
      configuration: 1,
    };
    let eligible = true;
    f.env.ITEM_PROVIDER = {
      async fetch(request) {
        assert.match(
          new URL(request.url).pathname,
          /\/r\/fictional-book\/c\/1\/api\/items\/note-1/,
        );
        return Response.json({
          contract: 1,
          provider: "guestbook",
          resource: "fictional-book",
          id: "note-1",
          title: "Source-controlled postcard",
          description: "Only while approved",
          visibility: eligible ? "public" : "private",
          url: "https://guestbook.test/r/fictional-book/c/1/item/note-1",
          image: "https://guestbook.test/r/fictional-book/media/note-1",
        });
      },
    };
    let a = (await f.call("account-A", "create")).body;
    a = (await f.update("account-A", a, "config", config("River", "river")))
      .body;
    a = (
      await f.update("account-A", a, "cards", {
        action: "create",
        source: selected,
        item: "note-1",
        status: "published",
      })
    ).body;
    const tag = {
      label: "PRIVATE TAG SENTINEL",
      description: "",
      citationLabel: "",
      citationURL: "",
      relatedLabel: "",
      relatedURL: "",
      status: "draft",
    };
    a = (
      await f.update("account-A", a, "tags", {
        action: "create",
        expectedRevision: 0,
        item: tag,
      })
    ).body;
    a = (await f.update("account-A", a, "publish")).body;
    const read = () =>
      publicMemberProfile(
        new Request(origin + "/p/river/"),
        f.env,
        "",
        "/p/river/",
      );
    let markup = await (await read()).text();
    assert.match(markup, /Source-controlled postcard/);
    assert.doesNotMatch(markup, /PRIVATE TAG SENTINEL/);
    assert.equal(
      (
        await f.update("account-A", a, "cards", {
          action: "edit",
          id: a.draft.cards[0].id,
          title: "Forged provider text",
          url: "https://example.org/",
        })
      ).status,
      400,
    );
    eligible = false;
    markup = await (await read()).text();
    assert.doesNotMatch(
      markup,
      /Source-controlled postcard|Only while approved|note-1/,
    );
    const exported = await f.call("account-A", "export", {
      resource: a.resource,
    });
    assert.equal(exported.body.cards[0].sourceState, "unavailable");
    assert.doesNotMatch(
      JSON.stringify(exported.body.cards[0]),
      /Source-controlled postcard|Only while approved/,
    );
    assert.equal(
      f.sqlite.prepare("SELECT COUNT(*) n FROM member_profiles").get().n,
      1,
    );
  } finally {
    f.close();
  }
});
