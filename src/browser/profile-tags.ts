// Native details retain touch, keyboard and no-JavaScript operation.
// Escape returns focus to the same tag, including from its reference links.
for (const disclosure of document.querySelectorAll<HTMLDetailsElement>(
  "[data-profile-tag]",
)) {
  disclosure.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !disclosure.open) return;
    event.preventDefault();
    disclosure.open = false;
    disclosure.querySelector<HTMLElement>("summary")!.focus();
  });
}
