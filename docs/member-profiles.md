# Invited creator profiles

Linkarooie keeps its existing owner root, settings, cards and selected artwork.
Member profiles are independent app-owned documents, with generated stable UUIDs
and one profile per exact installation issuer plus authenticated account ID.
An email address or editable public handle never owns a profile.

The same-origin Composer `/me` entry uses the installed EmDash session. Composer
checks current membership and the exact profile action before service dispatch.
The Linkarooie Worker does not authenticate people or issue browser sessions.
Membership removal retains app content and its stable account ownership. An
operation already dispatched before revocation may finish; the next dispatch
must be denied by Composer. The app does not cache an access grant.

## Forward migration and recovery

Apply `migrations/0003_member_profiles.sql` once through the selected D1 migration
journal before deploying the new Worker. This adds only `member_profiles`; it
never rewrites existing `cards` or `settings`. Take the existing D1 export before
an authorised production application and retain its receipt. Qualification uses
real SQLite with representative owner config/artwork/private extensions/cards
and verifies their exact bytes and IDs after independent profile operations.

Rollback the Worker to the previous reviewed source if needed; keep the additive
table and its member records. Do not drop the table or run a destructive down
migration. The former Worker ignores it and continues the existing owner root.
Releasing this version again restores member access to the retained documents.
`dataVersion: 1` remains the legacy app format; optional `memberProfiles.version:1`
advertises this additive resource contract and migration capability separately.

## Private service command

`POST /api/member-profiles` accepts only a dedicated server bearer
`COMPOSER_PROFILE_BRIDGE_TOKEN`, the exact running build in `X-Composer-Source`,
and the actual origin plus mount in `X-Composer-Target`. `COMPOSER_ISSUER` is the
fixed installation origin, a plain configuration value. Owner tokens and cookies
cannot use this route. Omitting either member bridge configuration value makes
it unavailable (404); no member write is exposed through standalone owner APIs.
Composer must keep this token server-side and must resolve both actor values
from its authenticated context, never from the browser request.

```json
{
  "version": 1,
  "actor": { "issuer": "https://composer.example", "subject": "emdash-user-id" },
  "operation": "config",
  "resource": "generated-profile-uuid",
  "expectedRevision": 4,
  "command": { "title": "Fictional public name", "intro": "Public bio" }
}
```

`create` has no resource, command or revision and idempotently returns this
account's profile. `read` may omit resource to recover that account's exact own
profile, returning `{ok:true,version:1,profile:null}` if none exists. Resource
selection always compares the stable owner pair again; another account's private
read, write or export receives the same not-found result. A missing profile
cannot be implicitly created by another action.

A read or successful mutation returns `ok`, `version`, `resource`, numeric
`revision`, the last public `handle`, `visibility`, `publishedRevision`,
`publicURL`, `hasUnpublishedChanges`, `draft` and `shareCard`. `draft` contains the
existing `config` fields, `cards`, per-card `presentation`, versioned `tags` and
`achievements` collections, and optional exact-source `invitation`. `shareCard`
uses the existing profile snapshot/receipt contract plus a `stale` flag when its
saved public name, handle or bio differs from the selected image's source text.
It contains no account identifier, email, invitation/access audit or owner root
configuration.

Every mutation compares the exact outer integer revision and original draft
bytes in one real SQL update. Unknown save outcomes return 503 and require a
fresh read before retrying; no optimistic success or blind retry is invented.
The whole app document is bounded at 512 KiB; commands at 192 KiB. Existing tags,
milestones, settings and encoded-image limits remain independently enforced.

- `config`: partial existing configuration fields; unknown fields are refused.
- `cards`: `action` create/edit/visibility/delete/reorder, supported text/status,
  `id` or exact `ids`. A new provider card takes exact `source` plus `item`.
  Provider-owned text is not editable. Up to 64 links; no legacy-global source
  fallback is added for member cards.
- `presentation`: `id`, `icon`, `pinned`, optional `group`; up to eight featured.
- `tags` and `achievements`: existing bounded commands, including their inner
  collection `expectedRevision`.
- `invitation`: `{action:"enable",source}` or `{action:"disable"}`. The actual
  Guestbook verifies its own current invitation, visibility and moderation.
- `share-card`: existing `adopt` or `rollback` command with the inner opaque
  profile-config revision. Its stable receipt ID uses the app origin plus
  `/profiles/<uuid>`, independently of public handle. Receipt, exact public text,
  PNG bytes, MIME, dimensions, renderer/font identity and CAS all remain checked.
- `profile-settings`: existing `review`/`apply` commands; `export` returns the
  existing settings-only file under `result.file`. This file is not a full backup.
- `export`: own collection/settings/tags/milestones/source identities, never
  another profile or owner root. No mutation revision is required.
- `publish`: explicitly commits a public-only snapshot of the selected draft.
  A unique public handle is required. Private cards/tags/milestones and image
  history never enter the snapshot. `hide` removes visitor access while retaining
  both private work and its previous public snapshot.

Card adoption selects the saved draft image. **Publish profile** is the separate
explicit step that puts the selected profile/card on its public page. Membership
must independently grant publication; profile maintenance does not imply it.
Changing a draft never silently changes an existing public snapshot.

## Publisher hand-off

Download the selected saved profile snapshot alongside the recipe and inspected
PNG. The operator runs one command in the intended Linkarooie checkout:

```sh
node scripts/prepare-share-card.mjs \
  --recipe /absolute/selected-recipe.json \
  --image /absolute/inspected-card.png \
  --snapshot /absolute/saved-profile.json \
  --output /absolute/adoption-receipt.json
```

The optional `--snapshot` binds the recipe to the exact stable profile ID,
revision and public text before creating an immutable reviewable asset change
and receipt. The output says `published:false`; it does not give members release
credentials. Review/commit the asset and use the existing clean, pushed-main
`pnpm deploy` gate. Return the receipt to the selected member. Adoption verifies
that deployed immutable image before changing the saved draft, then the member
explicitly publishes the profile. A selected receipt never executes commands or
chooses an external destination. Earlier assets remain available for rollback.

## Visitor boundary and evidence

`/p/<handle>/` and `/showcase/p/<handle>/` render the same maintained creator
profile components, using each independent published snapshot. Canonical and
image URLs follow the actual public origin/mount. Theme, keyboard navigation,
search, category groups, tags and milestones reuse the existing native browser
assets. `/p/<handle>/api/profile` exposes only current public content. Private
actor keys, account IDs, email, access grants and audits are absent from both
public responses and metadata. Source-backed cards recheck current Guestbook
eligibility on every render/export; retaining a profile snapshot never freezes
permission to display a source contribution.

`tests/member-profiles.test.mjs` exercises actual SQLite persistence, migration
compatibility, two fictional owners, direct boundary denials, handle identity,
interleaved CAS, public draft exclusion, exact PNG adoption and guarded rollback
on both serving paths. Those are local app proofs; Composer's actual session,
revocation and actor-switch qualification, deployment, normal-speed walkthrough,
physical iPhone, screen-reader and native social rendering evidence remain
separately recorded in the shared Composer #11 receipt.
