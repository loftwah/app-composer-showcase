// MIT. Prepare reviewed local output for the existing committed-assets release route.
import { readFile, writeFile, mkdir, lstat } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import {
  imageDimensions,
  validateCardPNG,
} from "../public/brand/share-image.mjs";
export async function prepareShareCard({
  recipe,
  image,
  output,
  root = fileURLToPath(new URL("../", import.meta.url)),
}) {
  const spec = JSON.parse(await readFile(recipe, "utf8")),
    bytes = await readFile(image),
    dimensions = imageDimensions(bytes);
  if (
    spec.format !== "app-composer.profile-card" ||
    spec.version !== 1 ||
    spec.renderer?.id !== "launch-kit-profile" ||
    spec.renderer?.version !== "1.0.0" ||
    spec.renderer?.font !== "Space Grotesk Latin 20261018" ||
    spec.renderer?.fontSha256 !==
      "61d00a1c57fcd7d4826c7a69cd85b61d15d133d5471d3c9c4731d70193d9f71f" ||
    spec.output?.type !== "image/png" ||
    spec.output?.width !== 1200 ||
    spec.output?.height !== 630
  )
    throw Error(
      "Choose the original version 1 Launch Kit profile-card recipe.",
    );
  if (
    dimensions.format !== "image/png" ||
    dimensions.width !== 1200 ||
    dimensions.height !== 630
  )
    throw Error("Choose the inspected 1200 × 630 PNG.");
  if (
    !spec.profile?.id ||
    !/^https:\/\//.test(spec.profile.id) ||
    !/^[a-f0-9]{64}$/.test(spec.profile.revision)
  )
    throw Error(
      "Choose a recipe made from the intended Linkarooie owner profile snapshot.",
    );
  await validateCardPNG(bytes);
  const sha256 = createHash("sha256").update(bytes).digest("hex"),
    path = "/brand/generated/profile-" + sha256 + ".png";
  const receipt = {
    format: "linkarooie.share-card",
    version: 1,
    profile: spec.profile,
    image: {
      path,
      sha256,
      type: dimensions.format,
      width: dimensions.width,
      height: dimensions.height,
      alt: spec.text.alt,
    },
    text: {
      name: spec.text.name,
      handle: spec.text.handle,
      description: spec.text.description,
    },
    preset: spec.preset,
    renderer: spec.renderer,
  };
  if (
    typeof receipt.image.alt !== "string" ||
    !receipt.image.alt.trim() ||
    receipt.image.alt.length > 500
  )
    throw Error("Give the image a public description before preparing it.");
  const publicDir = resolve(root, "public"),
    brand = resolve(publicDir, "brand"),
    generated = resolve(brand, "generated");
  for (const directory of [publicDir, brand])
    if (
      !(await lstat(directory)).isDirectory() ||
      (await lstat(directory)).isSymbolicLink()
    )
      throw Error(
        "Asset directories must be real directories in the intended checkout.",
      );
  await mkdir(generated, { recursive: true });
  if ((await lstat(generated)).isSymbolicLink())
    throw Error("Refusing a linked generated asset directory.");
  try {
    await writeFile(resolve(root, "public" + path), bytes, { flag: "wx" });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const existing = resolve(root, "public" + path);
    if (
      (await lstat(existing)).isSymbolicLink() ||
      createHash("sha256")
        .update(await readFile(existing))
        .digest("hex") !== sha256
    )
      throw Error("The immutable filename already contains different bytes.");
  }
  await mkdir(dirname(resolve(output)), { recursive: true });
  await writeFile(output, JSON.stringify(receipt, null, 2) + "\n", {
    flag: "wx",
  });
  return {
    asset: resolve(root, "public" + path),
    receipt: resolve(output),
    sha256,
    published: false,
    next: "Review and commit the image, run the existing guarded release, then explicitly apply this receipt in the owner studio.",
  };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2),
      values = {};
    if (args.length !== 6)
      throw Error(
        "Use --recipe recipe.json --image profile.png --output adoption.json",
      );
    for (let i = 0; i < args.length; i += 2) {
      if (
        !["--recipe", "--image", "--output"].includes(args[i]) ||
        values[args[i].slice(2)]
      )
        throw Error("Use each supported option once.");
      values[args[i].slice(2)] = args[i + 1];
    }
    console.log(JSON.stringify(await prepareShareCard(values), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
