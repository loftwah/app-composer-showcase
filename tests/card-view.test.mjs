import test from "node:test";
import assert from "node:assert/strict";
import { linkedCardContent, cardDestination } from "../src/card-view.ts";
test("a linked card retains its own identity while current source controls its content", () => {
  const card = {
    id: "card-1",
    item_id: "source-2",
    provider: "guestbook",
    position: 3,
  };
  const item = {
    id: "source-2",
    title: "Latest caption",
    description: "Fictional alias",
    visibility: "public",
    image: "https://example.com/media/source-2",
    url: "https://example.com/item/source-2",
  };
  const view = linkedCardContent(card, item);
  assert.equal(view.id, "card-1");
  assert.equal(view.title, item.title);
  assert.equal(view.image, item.image);
  assert.equal(linkedCardContent(card, null), null);
  assert.equal(
    linkedCardContent(card, { ...item, visibility: "private" }),
    null,
  );
  assert.equal(
    cardDestination(view, "/showcase", "/guestbook"),
    "/guestbook/item/source-2",
  );
  assert.equal(cardDestination(view, "", "/guestbook"), item.url);
});
