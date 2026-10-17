// Search keeps the visible section navigation in sync, including all-no-match.
const search = document.querySelector<HTMLInputElement>("#gallery-search")!;
if (search) {
  const sections = [
    ...document.querySelectorAll<HTMLElement>(".creator-section"),
  ];
  const reconcile = () => {
    for (const section of sections) {
      const visible = [
        ...section.querySelectorAll<HTMLElement>("[data-gallery-item]"),
      ].filter((item) => !item.hidden).length;
      section.hidden = visible === 0;
      const jump = document.querySelector<HTMLElement>(
        '.creator-jump a[href="#' + section.id + '"]',
      )!;
      if (jump) jump.hidden = section.hidden;
    }
  };
  // The shared navigation installs the item filter before this module runs.
  search.addEventListener("input", reconcile);
  reconcile();
}
