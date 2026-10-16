import { escape } from "./common.ts";
import { icon, groupNames, profileFields } from "./profile.ts";
// A view over the same authored cards and currently eligible provider items.
// No separate catalogue, fetch-on-click metadata or creator-specific rendering.
export function creatorProfile(
  config: Record<string, any>,
  cards: any[],
  base: string,
  share: string,
  tags: string,
  achievements: string,
  href: (card: any) => string,
) {
  const image = (value: unknown) => {
    try {
      const u = new URL(String(value));
      return u.protocol === "https:" &&
        !u.username &&
        !u.password &&
        u.href.length <= 2048 &&
        /^[a-zA-Z0-9.:/\[\]-]+$/.test(u.origin)
        ? u.href
        : "";
    } catch {
      return "";
    }
  };
  config = {
    ...config,
    avatar: image(config.avatar),
    banner: image(config.banner),
  };
  const featured = cards.filter((card) => card.pinned).slice(0, 8);
  // Featured is a shortcut view; every eligible card still belongs in its category.
  const groups = [...groupNames, "Other links"]
    .map((name) => ({
      name,
      id: "links-" + name.toLowerCase().replaceAll(" ", "-"),
      cards: cards.filter((card) => (card.group || "Other links") === name),
    }))
    .filter((group) => group.cards.length);
  const link = (card: any, feature = false, index = 0) =>
    `<article data-gallery-item data-gallery-id="${escape(card.id)}" data-kind="${card.provider ? "photo" : "link"}"><a class="creator-link ${feature ? "creator-pick" : ""}" href="${escape(href(card))}" rel="noopener noreferrer">${card.image ? `<img class="creator-link-image" src="${escape(card.image)}" alt="" width="96" height="96" loading="lazy">` : `<span class="creator-link-icon">${icon(card.icon)}</span>`}<span class="creator-link-copy"><strong>${escape(card.title)}</strong>${card.description ? `<span>${escape(card.description)}</span>` : ""}<small>${escape(new URL(card.url).hostname)}</small></span><span class="creator-link-end">${feature ? `<span class="pick-number">${String(index + 1).padStart(2, "0")}</span>` : ""}${icon("arrow")}</span></a></article>`;
  const socials = profileFields
    .filter(
      (field) => field.key !== "handle" && !field.image && config[field.key],
    )
    .map(
      (field) =>
        `<a href="${escape(config[field.key])}" rel="me noopener noreferrer">${field.label}${icon("arrow")}</a>`,
    )
    .join("");
  return `<section class="creator-hero" aria-labelledby="profile-title">${config.banner ? `<img class="creator-banner" src="${escape(config.banner)}" alt="" width="1500" height="500" fetchpriority="high">` : ""}<div class="creator-identity">${config.avatar ? `<img class="creator-avatar" src="${escape(config.avatar)}" alt="${escape(config.title)}" width="400" height="400">` : ""}<div class="creator-heading"><h1 id="profile-title">${escape(config.title)}</h1>${config.handle ? `<p class="creator-handle">@${escape(config.handle)}</p>` : ""}</div><p class="creator-bio">${escape(config.intro)}</p>${socials ? `<nav class="profile-social" aria-label="Profile links">${socials}</nav>` : ""}${share}</div></section><nav class="creator-jump" aria-label="Explore this profile">${featured.length ? '<a href="#featured">Featured</a>' : ""}${groups.map((group) => `<a href="#${group.id}">${group.name}</a>`).join("")}</nav><div class="creator-search"><label>Find something<input id="gallery-search" type="search" placeholder="Music, games, projects…" autocomplete="off"></label><p id="gallery-count" class="small" role="status" aria-live="polite"></p><p id="gallery-empty" hidden>No links match. Try another search.</p></div>${featured.length ? `<section class="creator-section" id="featured" aria-labelledby="featured-title"><div class="creator-section-title"><h2 id="featured-title">Featured</h2><span>${featured.length} picks</span></div><div class="creator-featured">${featured.map((card, index) => link(card, true, index)).join("")}</div></section>` : ""}${groups.map((group) => `<section class="creator-section" id="${group.id}" aria-labelledby="${group.id}-title"><div class="creator-section-title"><h2 id="${group.id}-title">${group.name}</h2><span>${group.cards.length} ${group.cards.length === 1 ? "link" : "links"}</span></div><div class="creator-links">${group.cards.map((card) => link(card)).join("")}</div></section>`).join("")}${!cards.length ? '<p class="creator-empty">No links published yet.</p>' : ""}${tags}${achievements}<div class="creator-owner"><a href="${base}/owner">Manage this profile ${icon("arrow")}</a></div><script type="module" src="${base}/brand/creator-profile.js"></script>`;
}
