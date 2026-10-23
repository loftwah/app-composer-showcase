# Make and publish a profile card

Open the Linkarooie owner studio and choose **Design in Launch Kit**. The protected Composer owner experience has the same entry. The separate editor receives only the selected profile name, handle, bio and opaque saved revision. It receives no credential. Your owner page remains open, keeping unsaved work in memory. You can also download a profile snapshot and explicitly import it in the editor.

Choose a preset, use text only or explicitly select approved local portrait/banner artwork, then inspect the actual PNG at full and feed size. The downloaded PNG is the inspected encoded output. Rendering is local; this does not publish an image or save owner edits. A recipe excludes original artwork and records which files and digests must be selected again.

## Existing publication route

Linkarooie publishes committed assets through its existing guarded Worker deployment. No new uploaded asset store, credential broker or image service is introduced. The repository handoff is explicit:

```sh
# In the intended Linkarooie checkout, using the exported recipe and inspected PNG:
node scripts/prepare-share-card.mjs \
  --recipe /absolute/path/profile-card.json \
  --image /absolute/path/profile-<sha256>.png \
  --output /absolute/path/adoption.json
```

The command validates the complete encoded 1200 × 630 PNG, copies it to `public/brand/generated/profile-<SHA-256>.png` and produces a small receipt. Original source images are never copied. It refuses damaged/truncated PNGs, mismatched dimensions, unsupported renderer/font identity, linked destination directories and conflicting immutable bytes. It never activates a profile or deploys by itself. Review and commit the new immutable asset, then use the existing clean, pushed-main `pnpm deploy` route. Keep earlier approved image files available for rollback and existing public links.

Return to the owner page, select the prepared receipt and its inspected PNG, and compare the current and proposed images. **Publish selected image** deliberately replaces the saved profile `shareImage` only after the deployed bytes match its receipt. Save or restore unsaved profile settings before activation; other collection drafts remain in the page. A failed or uncertain result keeps the previous approved image and asks you to compare saved state. Do not blindly retry an ambiguous save.

**Restore previous image** compares the current saved revision and returns to the previous approved image, including a manually configured URL or the built-in default. It preserves other profile settings. **Verify public result** separately fetches the public page and image and checks PNG bytes, HTTP and declared format, dimensions and agreement with the current saved revision. Platform unfurls, physical iPhone and actual screen-reader acceptance remain separate observations. Link Check retains its existing metadata-checking scope; it does not establish receipt hashes or saved revision agreement.

## Owner API and revision contract

The same owner authentication, same-origin cookie-write check and no-store JSON responses protect standalone and mounted `/api/share-card`:

- `GET` returns version 1, the exact public profile snapshot, an opaque revision derived from the exact stored configuration bytes, the current effective image URL, approved image facts and the previous image. It writes nothing.
- `POST {action:"adopt",expectedRevision,receipt}` accepts only the fixed version 1 receipt. Profile ID, saved name/handle/bio, expected revision, preset/version and renderer/font identity must agree. It verifies the already deployed app-owned asset without remote fetching, then atomically compares the entire configuration row before changing only the share-image fields and bounded one-step history. Identical retries are safe; stale profile/media updates and intervening configuration writes return 409.
- `POST {action:"rollback",expectedRevision}` uses the same exact-row comparison to restore the previous approved image. Manual image overrides stay effective until deliberate replacement. Ordinary public reads, crawler requests and share clicks never generate or activate images.

`PROFILE_ORIGIN` is the stable HTTPS instance identity. The reviewed deployment sets it to `https://showcase.loftwah.com`; Composer preserves that value when the same profile is mounted under its own public origin. Independent forks may omit it and use their standalone `PUBLIC_ORIGIN`, but must preserve the same identity when composing. Public canonical URLs and generated image paths use the actual current public origin and mount, independently of profile identity. A generated card therefore serves at `/brand/generated/...` standalone and `/showcase/brand/generated/...` when mounted. Manual externally configured images retain their existing unknown-format metadata behavior; the release verifier retains its established same-public-origin restriction.

The receipt identifies the selected PNG by its complete SHA-256, MIME type, dimensions, public description, profile identity/revision, exact public text, preset identifier/version, renderer version and bundled font SHA-256. The server compares declared type, HTTP content type and actual format. It validates the complete static PNG (chunk checksums, bounds, compressed raster and row layout), not merely a signature. Receipts are inert data and cannot supply instructions, destinations outside the immutable app asset path, or credentials.

## Clearly fictional example and proof boundary

`/examples/launch-kit/` and the mounted `/showcase/examples/launch-kit/` show River Morgan, a fictional text-only profile. The exact maintained-renderer recipe is [river-typography.json](examples/river-typography.json); its generated image and publication facts are recorded in [river-publication.json](examples/river-publication.json). The example is an independently committed public page and immutable PNG, not a replacement for the owner’s selected artwork.

Focused tests exercise actual SQLite compare-and-swap adoption, stale revisions, intervening writes, idempotency, manual-image preservation/rollback, owner access, complete PNG validation, response/type/dimension mismatch and standalone/mounted metadata. Local browser evidence uses the real Worker and fictional SQLite with synthetic origins and blocked external requests. That local activation proof and the released fictional example are distinct from a live owner-D1 activation. Deployment/live source identities and remaining device/platform acceptance belong in Composer #11.
