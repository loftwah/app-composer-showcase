import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { creatorProfile } from "../src/creator-profile.ts";

test("featured games also appear in Games with their existing IDs and destinations", () => {
  const cards = ["Protocol 11", "Bubbles", "SHOALSHOT"].map((title, index) => ({
    id: "game-" + index,
    title,
    url: "https://example.test/game-" + index,
    group: "Games",
    pinned: true,
    icon: "heart",
  }));
  cards.push({
    id: "music",
    title: "Fictional music",
    url: "https://example.test/music",
    group: "Music",
    pinned: false,
    icon: "music",
  });
  const html = creatorProfile(
    { title: "Fictional profile", intro: "" },
    cards,
    "",
    "",
    "",
    "",
    (card) => card.url,
  );
  const games = html.match(
    /<section[^>]*id="links-games"[\s\S]*?<\/section>/,
  )?.[0];
  const featured = html.match(
    /<section[^>]*id="featured"[\s\S]*?<\/section>/,
  )?.[0];
  assert(games);
  assert(featured);
  assert.match(games, />3 links</);
  for (const card of cards.slice(0, 3))
    for (const section of [games, featured]) {
      assert(section.includes('data-gallery-id="' + card.id + '"'));
      assert(section.includes('href="' + card.url + '"'));
      assert(section.includes(card.title));
    }
  assert(!games.includes("Fictional music"));
  // Every section names itself with a symbol, and no two groups share one.
  const heading = (id) => html.match(new RegExp(`<h2 id="${id}">([\\s\\S]*?)</h2>`))?.[1] ?? "";
  const path = (id) => heading(id).match(/d="([^"]+)"/)?.[1];
  for (const id of ["featured-title", "links-games-title", "links-music-title"])
    assert.match(heading(id), /class="creator-section-symbol" aria-hidden="true"><svg/);
  assert(path("links-games-title"));
  assert.notEqual(path("links-games-title"), path("links-music-title"));
});

test("a profile without something to find offers no search, filter or dead jump link", () => {
  const html = (cards) =>
    creatorProfile(
      { title: "Fictional profile", intro: "" },
      cards,
      "",
      "",
      "",
      "",
      (card) => card.url,
    );
  const one = html([
    {
      id: "one",
      title: "One fictional link",
      url: "https://example.test/one",
      group: "Music",
      pinned: true,
      icon: "music",
    },
  ]);
  assert.match(one, /id="links-music"/);
  assert.doesNotMatch(one, /id="gallery-search"/);
  assert.doesNotMatch(one, /No links match/);
  const none = html([]);
  assert.doesNotMatch(none, /class="creator-jump"/);
  assert.doesNotMatch(none, /id="gallery-search"/);
  assert.match(none, /No links published yet/);
});

test("actual gallery filter counts unique cards across featured and category views and handles no-match recovery", () => {
  const mountGallery = (items) => {
    const handlers = {};
    const search = {
      value: "",
      addEventListener(type, fn) {
        handlers[type] = fn;
      },
    };
    const status = {},
      empty = {},
      noop = { addEventListener() {} };
    const dialog = {
      querySelector() {
        return noop;
      },
      querySelectorAll() {
        return [];
      },
      addEventListener() {},
      style: { setProperty() {} },
    };
    const theme = { setAttribute() {}, addEventListener() {} };
    const controls = {
      "#app-navigation": dialog,
      "[data-open-apps]": noop,
      "#reader-theme": theme,
      "#gallery-search": search,
      "#gallery-count": status,
      "#gallery-empty": empty,
    };
    const document = {
      documentElement: { dataset: { app: "showcase", theme: "dark" } },
      querySelector(selector) {
        return controls[selector] ?? null;
      },
      querySelectorAll(selector) {
        return selector === "[data-gallery-item]" ? items : [];
      },
      addEventListener() {},
    };
    runInNewContext(
      readFileSync(
        new URL("../public/brand/navigation.js", import.meta.url),
        "utf8",
      ),
      { document, window: { addEventListener() {} } },
    );
    return { handlers, search, status, empty, items };
  };
  const profile = mountGallery([
    // The same card renders in Featured and again under Games.
    { textContent: "Fictional game", dataset: { galleryId: "one", kind: "link" } },
    { textContent: "Fictional game", dataset: { galleryId: "one", kind: "link" } },
    { textContent: "Fictional music", dataset: { galleryId: "two", kind: "link" } },
  ]);
  // The count only speaks once someone filters; an untouched gallery stays quiet.
  assert.equal(profile.status.textContent, "");
  assert.equal(profile.empty.hidden, true);
  profile.search.value = "game";
  profile.handlers.input();
  assert.equal(profile.status.textContent, "1 of 2 items shown");
  assert.equal(profile.items[0].hidden, false);
  assert.equal(profile.items[1].hidden, false);
  assert.equal(profile.items[2].hidden, true);
  profile.search.value = "no match";
  profile.handlers.input();
  assert.equal(profile.status.textContent, "0 of 2 items shown");
  assert.equal(profile.empty.hidden, false);
  profile.search.value = "";
  profile.handlers.input();
  assert.equal(profile.status.textContent, "");
  assert.equal(profile.empty.hidden, true);
  // Existing layouts without a gallery ID still count each separate card.
  const collection = mountGallery([
    { textContent: "Fictional game", dataset: { kind: "link" } },
    { textContent: "Fictional game", dataset: { kind: "link" } },
    { textContent: "Fictional music", dataset: { kind: "link" } },
  ]);
  collection.search.value = "game";
  collection.handlers.input();
  assert.equal(collection.status.textContent, "2 of 3 items shown");
});
