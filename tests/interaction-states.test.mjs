import test from "node:test";
import assert from "node:assert/strict";
import { creatorStyle } from "../src/creator-style.ts";
import { style } from "../src/common.ts";

test("profile cards share one deliberate hover, focus and pressed contract", () => {
  assert.match(creatorStyle, /\.creator-link\{[^}]*border:1px solid transparent/);
  assert.match(creatorStyle, /\.creator-link\{[^}]*border-radius:10px/);
  assert.match(creatorStyle, /@media\(hover:hover\)\{/);
  assert.match(creatorStyle, /\.creator-link:hover\{background:var\(--surface\);border-color:var\(--accent\)/);
  assert.match(creatorStyle, /\.creator-pick:hover\{background:color-mix/);
  assert.doesNotMatch(creatorStyle, /\.creator-pick:hover\{border-color:var\(--accent\)\}/, "featured picks need more than a border change");
  assert.match(creatorStyle, /\.creator-link:focus-visible\{outline:2px solid var\(--accent\);outline-offset:3px/);
  assert.match(creatorStyle, /\.creator-link:active\{background:var\(--field\);border-color:var\(--accent\)/);
  assert.match(creatorStyle, /@media\(prefers-reduced-motion:reduce\)\{\.creator-link,\.creator-link-end svg\{transition:none\}\}/);
});

test("keyboard focus never changes gallery display or dimensions", () => {
  assert.doesNotMatch(style, /\.gallery a:focus-visible\{display:block\}/);
  assert.doesNotMatch(creatorStyle, /focus-visible\{[^}]*display:/);
});
