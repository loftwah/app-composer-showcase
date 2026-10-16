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
});

test("actual gallery filter counts unique cards across featured and category views and handles no-match recovery", () => {
  const items = [
    {
      textContent: "Fictional game",
      dataset: { galleryId: "one", kind: "link" },
    },
    {
      textContent: "Fictional game",
      dataset: { galleryId: "one", kind: "link" },
    },
    {
      textContent: "Fictional music",
      dataset: { galleryId: "two", kind: "link" },
    },
  ];
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
  assert.equal(status.textContent, "2 items shown");
  search.value = "game";
  handlers.input();
  assert.equal(status.textContent, "1 item shown");
  assert.equal(items[0].hidden, false);
  assert.equal(items[1].hidden, false);
  assert.equal(items[2].hidden, true);
  search.value = "no match";
  handlers.input();
  assert.equal(status.textContent, "0 items shown");
  assert.equal(empty.hidden, false);
  search.value = "";
  handlers.input();
  assert.equal(status.textContent, "2 items shown");
  assert.equal(empty.hidden, true);
  // Existing layouts without a gallery ID still count each separate card.
  delete items[0].dataset.galleryId;
  delete items[1].dataset.galleryId;
  handlers.input();
  assert.equal(status.textContent, "3 items shown");
});
