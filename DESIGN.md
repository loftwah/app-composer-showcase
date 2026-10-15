---
name: Top shelf
description: Existing collection and profile presentation
colors: {
  charcoal: "#17181b", dark-text: "#f2f3f5", dark-muted: "#afb3bb", dark-surface: "#23252a",
  dark-field: "#1d1f23", dark-border: "#444952", dark-control: "#797f8a", orange: "#ff9b55",
  warm-light: "#faf9f7", light-text: "#22252b", light-muted: "#5c616a", light-surface: "#efeeea",
  light-field: "#fff", light-border: "#d3d1cc", light-control: "#747983", burnt-orange: "#a63d08"
}
typography:
  headline: {fontFamily: "Space, system-ui", lineHeight: 1.1, letterSpacing: "-.025em"}
  body: {fontFamily: "system-ui, sans-serif", fontSize: "16px", lineHeight: 1.55}
rounded: {field: "6px", card: "8px", dialog: "12px"}
---
# Design System: Top shelf

## Overview

Preserve the incumbent editorial collection: illustrated hero, readable profile identity and published picks. Public Top shelf naming and original magpie/shelf artwork remain; Linkarooie references do not authorise a rebrand. Source: `src/common.ts`, `src/profile.ts`, `src/worker.ts` and `docs/linkarooie-provenance.md`.

## Colors

Dark is the default; the saved light choice uses warm-light surfaces. Orange marks primary actions, handles, icons and focus. Muted text carries descriptions, destinations, captions and placeholders; borders separate content without enclosing every item.

## Typography

Self-hosted Space supplies headings, collection labels and compact titles; system type supplies prose and controls. The hero uses a responsive display heading, the bio a quieter lede, and compact titles a medium-weight (24px) heading reduced to (21px) on phones.

## Layout

Content is centred within (1248px). The two-column hero stacks below (820px); the three-column gallery and two-column editorial layout become one column on phones. Compact layout is a vertical list capped at (820px), with whole-row links, fixed icon/arrow slots and wrapping text. Keep the name/bio hierarchy, optional handle and wrapping Website/GitHub/Bluesky/LinkedIn strip; omit empty fields.

## Elevation & Depth

The collection is flat: tonal surfaces, rules and image placement supply hierarchy. Retain the existing illustration separately from published contributions rather than treating it as collection content.

## Shapes

Use softly rounded controls and media, thin borders and fixed functional SVG geometry. The six selectable link symbols are link, book, code, music, video and heart; pinning also has a readable “Pinned” label.

## Components

- Primary buttons use the theme accent; secondary buttons use the surface and control border. Preserve visible accent focus, native controls and existing touch spacing.
- Sharing uses the published canonical URL: native share where available, clipboard copy, then a focused selectable URL for manual recovery. Cancellation is not a success message.
- Owner profile fields stay in native optional controls inside “Profile & social links”. Keep muted placeholders and inline saving/error status; a failed save retains entries and enables retry.
- Compact rows carry title, optional description and destination; pinned cards precede other cards while keeping order within each group. Gallery/editorial layouts remain available.

## Do's and Don'ts

Do extend these tokens, existing artwork, native interactions and both themes. Don't add an avatar/banner system, decorative icon imports, tracking claims or Linkarooie naming ahead of the coordinated identity release.

Owner conflict recovery, reviewed 16 October 2026: the existing link editor retains unsaved fields after a refused save, then shows the current saved fields in a wrapping native definition list and two explicit recovery buttons. Use saved link focuses the title; Keep my edits focuses visibility for review. A failed private comparison keeps text and offers a read-only retry. Removed/replaced records remain copyable with saving blocked. This preserves the incumbent controls, theme surfaces and phone layout; it adds no remote preview or persistent private drafts.

Standalone unload protection uses the browser's native confirmation only while authored card, presentation or add/feature values differ from their saved/displayed baseline, or a card mutation remains pending. Undoing edits removes the warning; no private draft persistence or additional dialog is introduced. Successful saves retain the current page and other edits.
