// Authoring-only compositor. Uses selected local artwork and real bundled font;
// it makes no image-service calls and does not touch another app checkout.
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

if (!process.env.ART_PLAYWRIGHT_MODULE)
  throw Error("Select the existing authoring Playwright module with ART_PLAYWRIGHT_MODULE.");
const { chromium } = await import(pathToFileURL(process.env.ART_PLAYWRIGHT_MODULE).href);
const root = process.cwd();
const output = resolve(root, "output/visual-20261018/linkarooie");
const characterPath = resolve(root, process.argv[2] || ".artwork/masters/linkarooie-curator-accepted-20261018.png");
const fontPath = resolve(root, "public/brand/space-latin-20261018.woff2");
const character = await readFile(characterPath);
const font = await readFile(fontPath);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
if (sha256(character) !== "0928056f6e8a81bd4ea2e10d4424cc449c021a4f8ed1d471810c1878b4e4b1bc")
  throw Error("Select the accepted workshop master; preserve a different file rather than exporting it under this identity.");
if (sha256(font) !== "61d00a1c57fcd7d4826c7a69cd85b61d15d133d5471d3c9c4731d70193d9f71f")
  throw Error("The reviewed Space Latin font has changed; review its new identity before export.");
const uri = (bytes, mime) => `data:${mime};base64,${bytes.toString("base64")}`;
await mkdir(output, { recursive: true });
const temporary = await mkdtemp(join(tmpdir(), "composer-art-review-"));
let context;
try {
  context = await chromium.launchPersistentContext(join(temporary, "profile"), {
    headless: true,
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
    env: { ...process.env, TMPDIR: temporary },
  });
  const page = await context.newPage();
  const render = async (width) => {
    const scale = width / 1200;
    await page.setViewportSize({ width, height: Math.round(630 * scale) });
    await page.setContent(`<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
      @font-face{font-family:Space;src:url('${uri(font, "font/woff2")}') format('woff2');font-weight:300 700}
      *{box-sizing:border-box}html,body{margin:0;overflow:hidden;background:#160d20;font-family:Space,Arial,sans-serif}
      .card{position:relative;width:1200px;height:630px;overflow:hidden;transform:scale(${scale});transform-origin:top left;background:#160d20;color:#f5f1e8}
      .art{position:absolute;width:1200px;height:630px;object-fit:cover;inset:0}
      .copy{position:absolute;left:54px;top:174px;width:535px}
      h1{margin:0;font:700 91px/1 Space,Arial,sans-serif;letter-spacing:-.04em;white-space:nowrap}
      h1 span{color:#a5fd0e}
      .purpose{font:500 34px/1.25 Space,Arial,sans-serif;letter-spacing:-.02em;margin:28px 0 0;max-width:430px}
      .origin{position:absolute;left:58px;bottom:38px;font:500 20px/1.2 Space,Arial,sans-serif;color:#ded2ed}
      </style></head><body><main class="card">
      <img class="art" alt="" src="${uri(character, "image/png")}">
      <div class="copy"><h1>Link<span>arooie</span></h1>
      <p class="purpose">Keep the good stuff<br>together.</p></div>
      <p class="origin">showcase.loftwah.com</p></main></body></html>`);
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(Array.from(document.images, (image) => image.decode()));
    });
    const ready = await page.evaluate(() => ({
      font: document.fonts.check('700 93px Space'),
      image: document.images[0].naturalWidth,
      body: getComputedStyle(document.body).fontFamily,
    }));
    if (!ready.font || !ready.image) throw Error("Artwork or font did not load.");
    await page.screenshot({ path: join(output, `linkarooie-share-20261018-${width}.png`) });
    return ready;
  };
  const renders = [];
  for (const width of [1200, 600, 300])
    renders.push({ purpose: "social", width, ...(await render(width)) });
  // An optical head crop from the accepted master, not another generated roo.
  // Source rectangle: x1000/y0, 400x400. Preserve both ears and the long muzzle.
  for (const width of [16, 32, 48, 96, 180, 192, 512]) {
    await page.setViewportSize({ width, height: width });
    await page.setContent(`<!doctype html><style>html,body{margin:0;overflow:hidden;background:#251737}img{position:absolute;width:${1732 * width / 400}px;height:${908 * width / 400}px;left:${-1000 * width / 400}px;top:0}</style><img alt="" src="${uri(character, "image/png")}">`);
    await page.evaluate(async () => { await document.images[0].decode(); });
    await page.screenshot({ path: join(output, `linkarooie-icon-20261018-${width}.png`) });
    renders.push({ purpose: "icon", width, sourceCrop: [1000, 0, 400, 400] });
  }
  // Deterministic delivery formats and a separate catalogue/hero action crop.
  // The crop retains the accepted face, selecting hand and orange cassette.
  const convert = (args) => execFileSync("magick", args, { stdio: "pipe" });
  for (const extension of ["jpg", "webp"])
    convert([join(output, "linkarooie-share-20261018-1200.png"), "-strip", "-quality", "88", join(output, `linkarooie-share-20261018.${extension}`)]);
  convert([join(output, "linkarooie-share-20261018-600.png"), "-strip", "-quality", "88", join(output, "linkarooie-share-20261018-600.webp")]);
  convert([join(output, "linkarooie-icon-20261018-96.png"), "-strip", "-quality", "90", join(output, "linkarooie-small-20261018.webp")]);
  for (const width of [480, 960])
    convert([characterPath, "-crop", "908x908+780+0", "+repage", "-resize", `${width}x${width}`, "-strip", "-quality", "88", join(output, `linkarooie-art-20261018-${width}.webp`)]);
  renders.push({purpose: "catalogue and hero", widths: [480, 960], sourceCrop: [780, 0, 908, 908]});
  await writeFile(join(output, "render.json"), JSON.stringify({
    state: "Accepted character/pose/colours/copy; delivery candidate, not whole-presentation acceptance or deployment",
    character: { path: characterPath, sha256: createHash("sha256").update(character).digest("hex") },
    font: { path: fontPath, sha256: createHash("sha256").update(font).digest("hex") },
    renders,
  }, null, 2) + "\n");
} finally {
  await context?.close();
  await rm(temporary, { recursive: true });
}
console.log(`Rendered accepted workshop at 1200/600/300px and optical icons at 16/32/48/96/180/192/512px; owned profile removed. ${output}`);
