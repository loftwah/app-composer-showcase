// MIT. Browser-safe Linkarooie content and destination decisions. Transport and
// provider validation remain with item-provider; callers supply current items.
export interface PublicItemView {
  id: string;
  title: string;
  description: string;
  visibility: string;
  url: string;
  image: string;
}
export function linkedCardContent<T extends { id: string }>(
  card: T,
  item: PublicItemView | null,
) {
  if (!item || item.visibility !== "public") return null;
  return {
    ...card,
    title: item.title,
    description: item.description,
    url: item.url,
    image: item.image,
  };
}
export function cardDestination(
  card: { provider?: unknown; url: string },
  base: string,
  providerMount: string,
) {
  if (!card.provider || !base) return card.url;
  const path = new URL(card.url).pathname;
  return path.startsWith(providerMount + "/") ? path : providerMount + path;
}
