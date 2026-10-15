# Profile and link presentation provenance

Reviewed 15 October 2026. App Composer issue #25 is the product direction. Linkarooie replaces the historical Top shelf public app name through a coordinated catalogue/editor/launcher/navigation/SEO release. Existing owner titles remain authored configuration; repository, app and route IDs stay `showcase`. No resource, domain, content or licence migration is involved.

| Reference | Exact revision | Use here |
| --- | --- | --- |
| `loftwah/linkarooie-3`, `src/types/index.ts` | `149f277bc45baf31eca406878e8e16325b85a06f` | Reviewed profile name/username/bio/social and link icon shapes; adapted to the existing title/introduction plus optional handle and fixed social fields. No code module, tracking hook, personal profile or image was imported. |
| Same, `ProfileCard.astro` / `LinkCard.astro` | same | Profile hierarchy and linked title/description reference. Current implementation is native Worker HTML using existing source escaping/CSP and newly authored fixed SVG geometry. Legacy hidden-item DOM serialization was explicitly excluded. |
| `loftwah/linkarooie` | `d0650199d52f8776c7ff948a2d3c0ffa47d46983` | Pinning/order behaviour reference already reviewed in #25; stable existing position/id order is preserved inside pinned/unpinned groups. No Rails runtime, model code, distinct-IP tracking or dependency copied. |

The independent app and additions remain MIT. Existing original illustration/font assets retain their own adjacent provenance. The legacy Astro README declares MIT; no asset or source bytes from that repository were copied, so its missing standalone root licence is not used as permission for asset redistribution.

Implemented: optional handle, Website/GitHub/Bluesky/LinkedIn links, compact text links, six fixed link icons, pinned-first public order, server-canonical native sharing/copy/manual fallback. Owner studio and API preserve visibility and provider eligibility. Presentation uses an app-owned settings row; no schema migration or third-party tracking was added.

Deferred: optional uploaded avatar/banner, achievements, rich tags, multi-profile/workspace ownership, directory inclusion, broader analytics and portable whole-profile JSON import. Existing private export includes effective profile settings and per-card presentation. These are not completed merely by the profile surface.
