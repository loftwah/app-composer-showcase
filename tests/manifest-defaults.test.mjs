import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { iconNames, groupNames } from "../src/profile.ts";
const manifest = JSON.parse(
  readFileSync(new URL("../app.manifest.json", import.meta.url), "utf8"),
);
const worker = readFileSync(new URL("../src/worker.ts", import.meta.url), "utf8");

// Init prefills from the manifest while an unconfigured instance renders the
// worker defaults, so a drifted default would show two different introductions.
test("Init prefills and an unconfigured instance share the authored defaults", () => {
  for (const key of ["title", "intro", "theme", "layout"])
    assert.ok(
      worker.includes(JSON.stringify(manifest.configuration[key].default)),
      "src/worker.ts must keep the " +
        key +
        " default from app.manifest.json: " +
        JSON.stringify(manifest.configuration[key].default),
    );
});

test("the manifest advertises exactly the symbols and groups the app accepts", () => {
  assert.deepEqual(manifest.cardPresentation.icons, [...iconNames]);
  assert.deepEqual(manifest.cardCollection.groups, [...groupNames]);
});
