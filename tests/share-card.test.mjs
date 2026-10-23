import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  shareCardSnapshot,
  changeShareCard,
  publicShareCardMetadata,
} from "../src/share-card.ts";
import { html, sessionCookie } from "../src/common.ts";
import { sharingMetadata, verifySharing } from "../scripts/verify-sharing.mjs";
import worker from "../src/worker.ts";
const example = JSON.parse(
  readFileSync(
    new URL("../docs/examples/river-publication.json", import.meta.url),
    "utf8",
  ),
);
const bytes = readFileSync(
  new URL("../public" + example.image.path, import.meta.url),
);
const defaults = {
  title: example.text.name,
  intro: example.text.description,
  handle: example.text.handle,
  shareImage: "https://example.test/manual.jpg",
  theme: "daylight",
  layout: "profile",
};
function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(
    readFileSync(new URL("../migrations/0001.sql", import.meta.url), "utf8"),
  );
  sqlite.prepare("INSERT INTO settings VALUES(?,?)").run(
    "config",
    JSON.stringify({
      ...defaults,
      ownerExtension: "PRIVATE FICTIONAL SENTINEL",
    }),
  );
  let beforeWrite,
    assetCalls = 0;
  const statement = (sql, values = []) => ({
    bind(...v) {
      return statement(sql, v);
    },
    async first() {
      if (sql.startsWith("INSERT INTO settings")) await beforeWrite?.();
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
  const env = {
    DB: { prepare: statement },
    PUBLIC_ORIGIN: "https://example.test",
    OWNER_API_TOKEN: "fictional-owner",
    PROVIDER_ORIGIN: "https://provider.test",
    ASSETS: {
      async fetch(request) {
        assetCalls++;
        assert.equal(new URL(request.url).pathname, example.image.path);
        return new Response(bytes, {
          headers: { "Content-Type": "image/png" },
        });
      },
    },
    ITEM_PROVIDER: {
      async fetch() {
        return Response.json({ contract: 1, provider: "guestbook", items: [] });
      },
    },
  };
  return {
    env,
    sqlite,
    assetCalls: () => assetCalls,
    raw: () =>
      sqlite.prepare("SELECT value FROM settings WHERE id='config'").get()
        .value,
    onWrite(callback) {
      beforeWrite = callback;
    },
  };
}
const receipt = (s) => ({
  format: "linkarooie.share-card",
  version: 1,
  profile: { id: s.profile.id, revision: s.profile.revision },
  image: example.image,
  text: {
    name: example.text.name,
    handle: example.text.handle,
    description: example.text.description,
  },
  preset: example.preset,
  renderer: example.renderer,
});
const adopt = (env, s, r = receipt(s)) =>
  changeShareCard(
    env,
    { action: "adopt", expectedRevision: s.profile.revision, receipt: r },
    defaults,
  );
const status = (code) => (error) => error.status === code;
test("deliberate adoption verifies immutable bytes, preserves manual override and extensions; repeated activation and guarded rollback are safe", async () => {
  const f = fixture();
  try {
    const original = f.raw(),
      s = await shareCardSnapshot(f.env, defaults);
    assert.equal(s.profile.shareImage, defaults.shareImage);
    assert.equal(s.approved, null);
    assert.doesNotMatch(JSON.stringify(s), /PRIVATE/);
    assert.equal(f.assetCalls(), 0);
    const saved = await adopt(f.env, s);
    assert.equal(saved.published, true);
    assert.equal(saved.verified, false);
    assert.equal(saved.approved.sha256, example.image.sha256);
    assert.equal(saved.previous.shareImage, defaults.shareImage);
    assert.equal(
      JSON.parse(f.raw()).ownerExtension,
      "PRIVATE FICTIONAL SENTINEL",
    );
    assert.notEqual(f.raw(), original);
    assert.equal(f.assetCalls(), 1);
    const stable = f.raw();
    assert.deepEqual(await adopt(f.env, s), saved);
    assert.equal(f.raw(), stable);
    assert.equal(f.assetCalls(), 1);
    const restored = await changeShareCard(
      f.env,
      { action: "rollback", expectedRevision: saved.profile.revision },
      defaults,
    );
    assert.equal(restored.profile.shareImage, defaults.shareImage);
    assert.equal(restored.approved, null);
    assert.equal(restored.previous.approved.sha256, example.image.sha256);
    await assert.rejects(
      changeShareCard(
        f.env,
        { action: "rollback", expectedRevision: saved.profile.revision },
        defaults,
      ),
      status(409),
    );
  } finally {
    f.sqlite.close();
  }
});
test("stale media/profile revision, wrong profile identity, changed text, invalid path and mismatched served bytes cannot replace an approved image", async () => {
  for (const variant of [
    "revision",
    "profile",
    "text",
    "path",
    "digest",
    "type",
    "dimensions",
    "missing",
    "oversize",
  ]) {
    const f = fixture();
    try {
      const s = await shareCardSnapshot(f.env, defaults),
        r = receipt(s);
      if (variant === "revision")
        f.sqlite.prepare("UPDATE settings SET value=? WHERE id='config'").run(
          JSON.stringify({
            ...defaults,
            banner: "https://example.test/changed.png",
          }),
        );
      if (variant === "profile") r.profile.id = "https://other.test/";
      if (variant === "text") r.text.name = "Other name";
      if (variant === "path") r.image = { ...r.image, path: "/api/private" };
      if (variant === "digest")
        f.env.ASSETS.fetch = async () =>
          new Response(Buffer.concat([bytes, Buffer.from("changed")]), {
            headers: { "Content-Type": "image/png" },
          });
      if (variant === "type")
        f.env.ASSETS.fetch = async () =>
          new Response(bytes, { headers: { "Content-Type": "image/jpeg" } });
      if (variant === "dimensions") {
        const wrong = Buffer.from(bytes);
        wrong.writeUInt32BE(1199, 16);
        f.env.ASSETS.fetch = async () =>
          new Response(wrong, { headers: { "Content-Type": "image/png" } });
      }
      if (variant === "missing")
        f.env.ASSETS.fetch = async () => new Response(null, { status: 404 });
      if (variant === "oversize")
        f.env.ASSETS.fetch = async () =>
          new Response(bytes, {
            headers: {
              "Content-Type": "image/png",
              "Content-Length": String(5 * 1024 ** 2),
            },
          });
      const before = f.raw();
      await assert.rejects(adopt(f.env, s, r));
      assert.equal(f.raw(), before, variant);
    } finally {
      f.sqlite.close();
    }
  }
});
test("atomic compare refuses an intervening write after image verification without losing newer settings", async () => {
  const f = fixture();
  try {
    const s = await shareCardSnapshot(f.env, defaults);
    f.onWrite(() => {
      f.onWrite(undefined);
      f.sqlite
        .prepare("UPDATE settings SET value=? WHERE id='config'")
        .run(JSON.stringify({ ...defaults, title: "New saved name" }));
    });
    await assert.rejects(adopt(f.env, s), status(409));
    assert.equal(JSON.parse(f.raw()).title, "New saved name");
    assert.equal(JSON.parse(f.raw()).shareImage, defaults.shareImage);
  } finally {
    f.sqlite.close();
  }
});
test("generated metadata describes actual PNG bytes and retains correct standalone and mounted origin, path, canonical and exact public profile", async () => {
  const f = fixture();
  try {
    await adopt(f.env, await shareCardSnapshot(f.env, defaults));
    const config = JSON.parse(f.raw());
    for (const base of ["", "/showcase"]) {
      const origin = base ? "https://composed.test" : "https://example.test",
        response = html(
          defaults.title,
          "<h1>Fictional example</h1>",
          base,
          "showcase",
          "daylight",
          defaults.intro,
          origin,
          "/",
          origin,
          { ...config, ...publicShareCardMetadata(config) },
        ),
        body = await response.text(),
        metadata = sharingMetadata(body);
      assert.equal(metadata.image, origin + base + example.image.path);
      assert.equal(metadata.type, "image/png");
      assert.equal(metadata.width, 1200);
      assert.equal(metadata.height, 630);
      assert.match(
        body,
        new RegExp(
          'rel="canonical" href="' +
            origin.replaceAll(".", "\\.") +
            base +
            '/"',
        ),
      );
      const verified = await verifySharing(
        origin,
        async (url) =>
          new Response(new URL(url).pathname === "/" ? body : bytes, {
            headers: {
              "Content-Type":
                new URL(url).pathname === "/" ? "text/html" : "image/png",
            },
          }),
      );
      assert.equal(verified.format, "image/png");
      assert.equal(verified.imageBytes, bytes.length);
      assert.equal(
        createHash("sha256").update(bytes).digest("hex"),
        example.image.sha256,
      );
    }
  } finally {
    f.sqlite.close();
  }
});
test("owner-only API protects both route forms, cookie origin and bounds; public reads never render or activate", async () => {
  const f = fixture();
  try {
    globalThis.BUILD_SHA = "f".repeat(40);
    globalThis.MANIFEST = { id: "showcase", contract: 1 };
    const call = (
      path,
      body,
      headers = { Authorization: "Bearer fictional-owner" },
    ) =>
      worker.fetch(
        new Request(f.env.PUBLIC_ORIGIN + path, {
          method: body ? "POST" : "GET",
          headers: { "Content-Type": "application/json", ...headers },
          ...(body
            ? { body: typeof body === "string" ? body : JSON.stringify(body) }
            : {}),
        }),
        f.env,
        { waitUntil() {} },
      );
    for (const base of ["", "/showcase"]) {
      assert.equal(
        (await call(base + "/api/share-card", undefined, {})).status,
        401,
      );
      const s = await (await call(base + "/api/share-card")).json();
      assert.equal(s.profile.id, "https://example.test/");
      assert.equal(s.approved, null);
    }
    const Cookie = (await sessionCookie(f.env, "showcase_session", "")).split(
      ";",
    )[0];
    const s = await shareCardSnapshot(f.env, defaults);
    assert.equal(
      (
        await call(
          "/api/share-card",
          {
            action: "adopt",
            expectedRevision: s.profile.revision,
            receipt: receipt(s),
          },
          { Cookie, Origin: "https://other.test" },
        )
      ).status,
      403,
    );
    assert.equal(
      (await call("/api/share-card", "x".repeat(16385))).status,
      400,
    );
    const before = f.raw();
    for (const path of ["/", "/showcase/"]) {
      const response = await call(path, undefined, {});
      assert.equal(response.status, 200);
      assert.doesNotMatch(await response.text(), /PRIVATE FICTIONAL/);
    }
    assert.equal(f.raw(), before);
    assert.equal(f.assetCalls(), 0);
    const adopted = await call("/showcase/api/share-card", {
      action: "adopt",
      expectedRevision: s.profile.revision,
      receipt: receipt(s),
    });
    assert.equal(adopted.status, 200);
    assert.equal((await adopted.json()).published, true);
  } finally {
    f.sqlite.close();
  }
});

test("stable instance identity survives composed origin while generated image uses actual mount", async () => {
  const f = fixture();
  try {
    f.env.PROFILE_ORIGIN = "https://example.test";
    const s = await shareCardSnapshot(f.env, defaults);
    await adopt(f.env, s);
    const composed = { ...f.env, PUBLIC_ORIGIN: "https://composed.test" };
    const snapshot = await shareCardSnapshot(composed, defaults, "/showcase");
    assert.equal(snapshot.profile.id, s.profile.id);
    assert.equal(
      snapshot.profile.shareImage,
      "https://composed.test/showcase" + example.image.path,
    );
    assert.equal(
      snapshot.profile.revision,
      (await shareCardSnapshot(f.env, defaults)).profile.revision,
    );
  } finally {
    f.sqlite.close();
  }
});
test("fictional publication example works without reading owner data in standalone and mounted routes", async () => {
  globalThis.BUILD_SHA = "f".repeat(40);
  globalThis.MANIFEST = { id: "showcase", contract: 1 };
  for (const base of ["", "/showcase"]) {
    const env = {
      PUBLIC_ORIGIN: "https://example.test",
      OWNER_API_TOKEN: "",
      DB: {
        prepare() {
          throw Error("Owner data must not be read");
        },
      },
    };
    const response = await worker.fetch(
      new Request(env.PUBLIC_ORIGIN + base + "/examples/launch-kit/"),
      env,
      { waitUntil() {} },
    );
    assert.equal(response.status, 200);
    const body = await response.text(),
      metadata = sharingMetadata(body);
    assert.equal(metadata.title, example.text.name);
    assert.equal(metadata.image, env.PUBLIC_ORIGIN + base + example.image.path);
    assert.equal(metadata.type, "image/png");
    assert.match(body, /Fictional Launch Kit example/);
    assert.match(body, /does not replace the owner/);
  }
});
