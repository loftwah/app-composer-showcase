import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareShareCard } from "../scripts/prepare-share-card.mjs";
import { validateCardPNG } from "../public/brand/share-image.mjs";
const example = JSON.parse(
    await readFile(
      new URL("../docs/examples/river-publication.json", import.meta.url),
      "utf8",
    ),
  ),
  bytes = await readFile(
    new URL("../public" + example.image.path, import.meta.url),
  );
const recipe = JSON.parse(
  await readFile(
    new URL("../docs/examples/river-typography.json", import.meta.url),
    "utf8",
  ),
);
recipe.profile = { id: "https://example.test/", revision: "a".repeat(64) };
test("local preparation copies only the inspected encoded output to immutable name and writes an explicit non-published receipt", async () => {
  const root = await mkdtemp(join(tmpdir(), "showcase-share-prepare-"));
  try {
    await mkdir(join(root, "public/brand"), { recursive: true });
    const image = join(root, "image.png"),
      spec = join(root, "recipe.json"),
      output = join(root, "adoption.json");
    await writeFile(image, bytes);
    await writeFile(spec, JSON.stringify(recipe));
    const result = await prepareShareCard({
      recipe: spec,
      image,
      output,
      root,
    });
    assert.equal(result.published, false);
    assert.deepEqual(await readFile(result.asset), bytes);
    const receipt = JSON.parse(await readFile(output, "utf8"));
    assert.deepEqual(receipt.profile, recipe.profile);
    assert.deepEqual(receipt.image, example.image);
    assert.equal(receipt.format, "linkarooie.share-card");
    assert.equal(receipt.renderer.fontSha256, recipe.renderer.fontSha256);
    const again = await prepareShareCard({
      recipe: spec,
      image,
      output: join(root, "again.json"),
      root,
    });
    assert.equal(again.sha256, result.sha256);
    assert.doesNotMatch(
      await readFile(output, "utf8"),
      /assets|data:image|OWNER_API_TOKEN/,
    );
    await assert.rejects(
      prepareShareCard({ recipe: spec, image, output, root }),
      { code: "EEXIST" },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("a header-only PNG, damaged compressed data and linked output directory fail before preparation can be published", async () => {
  await validateCardPNG(bytes);
  await assert.rejects(validateCardPNG(bytes.subarray(0, 24)));
  const corrupted = Buffer.from(bytes);
  corrupted[100] ^= 1;
  await assert.rejects(validateCardPNG(corrupted), /damaged chunks/);
  const root = await mkdtemp(join(tmpdir(), "showcase-share-reject-"));
  try {
    await mkdir(join(root, "public/brand"), { recursive: true });
    const image = join(root, "header.png"),
      spec = join(root, "recipe.json"),
      output = join(root, "adoption.json");
    await writeFile(image, bytes.subarray(0, 24));
    await writeFile(spec, JSON.stringify(recipe));
    await assert.rejects(
      prepareShareCard({ recipe: spec, image, output, root }),
    );
    await assert.rejects(readFile(output), { code: "ENOENT" });
    await writeFile(image, bytes);
    await mkdir(join(root, "other"));
    await symlink(join(root, "other"), join(root, "public/brand/generated"));
    await assert.rejects(
      prepareShareCard({ recipe: spec, image, output, root }),
      /linked/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("publisher snapshot binding refuses another profile, stale revision and changed text before writing assets", async () => {
  const root = await mkdtemp(join(tmpdir(), "showcase-share-snapshot-"));
  try {
    await mkdir(join(root, "public/brand"), { recursive: true });
    const image = join(root, "image.png"),
      spec = join(root, "recipe.json"),
      snapshot = join(root, "snapshot.json"),
      output = join(root, "receipt.json");
    await writeFile(image, bytes);
    await writeFile(spec, JSON.stringify(recipe));
    const saved = {
      format: "linkarooie.profile-snapshot",
      version: 1,
      profile: recipe.profile,
      text: recipe.text,
    };
    for (const wrong of [
      {
        ...saved,
        profile: {
          ...saved.profile,
          id: "https://other.test/profiles/someone",
        },
      },
      { ...saved, profile: { ...saved.profile, revision: "b".repeat(64) } },
      { ...saved, text: { ...saved.text, name: "Other fictional person" } },
    ]) {
      await writeFile(snapshot, JSON.stringify(wrong));
      await assert.rejects(
        prepareShareCard({ recipe: spec, image, output, snapshot, root }),
        /exact saved profile snapshot/,
      );
      await assert.rejects(readFile(output), { code: "ENOENT" });
    }
    await writeFile(snapshot, JSON.stringify(saved));
    const result = await prepareShareCard({
      recipe: spec,
      image,
      output,
      snapshot,
      root,
    });
    assert.equal(result.snapshotVerified, true);
    assert.deepEqual(result.profile, recipe.profile);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
