# Linkarooie identity and creator assets

Current direction, 18 October 2026. MP accepted the lime workshop curator, pose, colours and conservative “Keep the good stuff together” copy at 8/10, while explicitly identifying remaining presentation problems. That qualified acceptance does not establish approval of every crop or all six apps. The selected master, deterministic crop rectangles and actual delivered hashes are in [the artwork receipt](artwork-20261018.json).

The complete workshop supplies the social card: selection has a purpose, with the orange cassette kept and the tags discarded. The small icon is an optical head crop from that exact accepted master. The catalogue/hero uses its own action crop. Header, browser favicon, Apple touch artwork, launcher and catalogue share this identity. New bytes have dated filenames; historical immutable assets remain available. The old chain mark is superseded for Linkarooie. A Composer return link uses a separately named Composer mark.

## Reproduce

Use an existing Playwright authoring installation and ImageMagick; no service call, new API key or runtime dependency is involved. From this checkout:

```sh
ART_PLAYWRIGHT_MODULE=/absolute/existing/playwright/index.mjs \
  node .artwork/og/render-linkarooie-identity.mjs public/brand/linkarooie-curator-20261018-master.png
```

The script verifies exact master and font hashes, waits for decoded images and the actual bundled font, renders 1200/600/300px cards and 16/32/48/96/180/192/512px icons, and exports reviewed WebP/JPEG variants under ignored `output/visual-20261018/linkarooie`. It closes and removes its owned browser profile on success or failure. Compare pixels, then distribute only the selected named files. It never edits another checkout or any owner configuration. The selected export renderer is also maintained in Composer’s `.artwork/og/` source.

## Source references and history

The initially used [Linkarooie 3 reference](https://github.com/loftwah/linkarooie-3/blob/149f277bc45baf31eca406878e8e16325b85a06f/src/assets/images/icon.png) was the wrong one of two similar icons according to MP. A later comparison recovered the [seated original Rails kangaroo](https://github.com/loftwah/linkarooie/blob/d0650199d52f8776c7ff948a2d3c0ffa47d46983/app/assets/images/icon.png) and [Linkarooie 2 variant](https://github.com/loftwah/linkarooie-2/blob/910d4797016c0ee682027e5a78d8acac3960271d/src/assets/images/icon.png). The historical alternatives do not replace the accepted curator. Inter fonts retain the included SIL OFL from the exact Linkarooie 3 reference. Space Latin is derived from Composer’s official licensed Space Grotesk TTF; the exact source and OFL are in the Composer font provenance.

The 17 October hero/share family remains historical, rather than current visual authority. Its original fal.ai request was `01a1490e-e9a6-76d1-85d7-f3f508ad5533`. The historical Composer exporter that overwrote the kangaroo filename from a generic chain is disabled. Never rerun it or overwrite old versioned assets.

## Creator settings and boundaries

Loftwah’s public cartoon portrait, banner and configured share image are owner-selected settings, separate from the reusable application identity. Preserve their actual existing bytes and configuration. An earlier receipt incorrectly described an unchanged photograph and recorded stale hashes; the following hashes record the current committed public files, without claiming that they are original photographs or that media recovery has been demonstrated.

- `public/brand/creators/loftwah-avatar-v1.jpg`: `344a5787e3f73f6be555c2020877acb72897d7113662dce0513eb5480f1f570a`
- `public/brand/creators/loftwah-banner-v1.jpg`: `3cfd75624412516d0638a71ed4f706559b9c6e513ca93f34686b9f8edaf247f0`
- `public/brand/creators/loftwah-share-v1.jpg`: `da48b2ecc7ab5da88a978e4ca32ecc5430a364899f3ea6f0b0b7784d99af0cab`

Creator image settings are empty by default for a new installation. Basic version-1 settings files preserve image/X settings and are not a collection/media backup. No private owner reference, inventory, biography or tracker is published by this artwork change.
