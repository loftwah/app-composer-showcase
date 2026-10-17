import {
  field,
  failure,
  node,
  record,
  achievements,
  type ValueControl,
  type Control,
  type StudioServices,
  type StudioCommand,
  type Achievement,
  type AchievementValues,
} from "./studio-dom.js";
import {
  validAchievementDate,
  achievementDateLabel,
} from "./achievement-date.mjs";

// Private owner data stays in this document. All inserted values are text nodes.
export function setupAchievements({
  base,
  watch,
  lock,
  request,
  isBusy,
}: StudioServices) {
  const studio = document.querySelector<HTMLElement>("#achievement-studio")!;
  if (!studio) return;
  let collection = achievements(JSON.parse(studio.dataset.snapshot!)),
    selected: string | null = null,
    blocked = false;
  delete studio.dataset.snapshot;
  const form = studio.querySelector<HTMLFormElement>("form")!,
    list = studio.querySelector<HTMLElement>("[data-achievement-list]")!,
    output = studio.querySelector<HTMLElement>("[data-achievement-message]")!,
    compare = studio.querySelector<HTMLElement>("[data-achievement-compare]")!,
    preview = studio.querySelector<HTMLElement>(
      "[data-achievement-preview-output]",
    )!,
    save = form.querySelector<HTMLButtonElement>("[type=submit]")!;
  const keys = [
    "title",
    "description",
    "date",
    "url",
    "icon",
    "status",
  ] as const;
  const blank = () => ({
    title: "",
    description: "",
    date: "",
    url: "",
    icon: "link",
    status: "draft",
  });
  const values = (): AchievementValues =>
    Object.fromEntries(
      keys.map((key) => [key, field(form, key).value]),
    ) as AchievementValues;
  const markSaved = watch(form, keys);
  const normalBaseline = (item: AchievementValues): AchievementValues =>
    Object.fromEntries(
      keys.map((key) => {
        const control = field(form, key).cloneNode(true) as ValueControl;
        control.value = item[key];
        return [key, control.value];
      }),
    ) as AchievementValues;
  let baseline = blank();
  const dirty = () => JSON.stringify(values()) !== JSON.stringify(baseline);

  const button = (label: string, action: () => void) => {
    const control = node("button", label);
    control.type = "button";
    control.className = "secondary";
    control.addEventListener("click", () => {
      if (!isBusy()) action();
    });
    return control;
  };
  const current = () => collection.items.find((item) => item.id === selected);
  function sync() {
    const pending = isBusy();
    for (const control of studio.querySelectorAll<Control>(
      "button,input,textarea,select",
    ))
      control.disabled = pending;
    field(form, "status").disabled = pending || !selected;
    save.disabled =
      pending || blocked || (!selected && collection.items.length >= 8);
    save.dataset.conflicted = String(blocked);
    save.textContent = selected
      ? values().status === "published"
        ? "Save published changes"
        : "Save achievement"
      : "Save draft";
    studio.querySelector<HTMLElement>("[data-save-help]")!.textContent =
      selected
        ? values().status === "published"
          ? "Saving publishes these changes immediately."
          : "Draft and hidden achievements stay out of your public profile."
        : "New achievements are saved as private drafts.";
    for (const control of list.querySelectorAll<HTMLButtonElement>(
      "[data-row-action]",
    )) {
      const row = control.closest<HTMLElement>("[data-achievement]")!,
        target = collection.items.find(
          (item) => item.id === row.dataset.achievement,
        )!,
        index = collection.items.indexOf(target),
        action = control.dataset.rowAction;
      control.disabled =
        pending ||
        blocked ||
        (target.id === selected && dirty() && action !== "edit") ||
        (action === "up" && index === 0) ||
        (action === "down" && index === collection.items.length - 1) ||
        action === target.status;
    }
    preview.hidden = preview.hidden || pending;
  }
  function fill(item: Achievement | null | undefined) {
    selected = item?.id ?? null;
    baseline = normalBaseline(item ?? blank());
    for (const key of keys) field(form, key).value = baseline[key];
    markSaved(baseline);
    blocked = false;
    compare.hidden = true;
    compare.replaceChildren();
    preview.hidden = true;
    form.querySelector<HTMLElement>("[data-editor-heading]")!.textContent = item
      ? "Edit achievement"
      : "Add an achievement";
    sync();
  }
  function select(item: Achievement | null) {
    if (dirty() || blocked) {
      output.textContent =
        "Save or discard the current edits before opening another achievement.";
      form.querySelector<HTMLElement>("[data-achievement-discard]")!.focus();
      return;
    }
    fill(item);
    output.textContent = "";
    field(form, "title").focus();
  }
  function render() {
    list.replaceChildren();
    const heading = node("p", collection.items.length + " of 8 achievements");
    heading.className = "small";
    list.append(heading);
    for (const [index, item] of collection.items.entries()) {
      const row = node("article");
      row.dataset.achievement = item.id;
      row.append(
        node("h3", item.title),
        node(
          "p",
          item.status +
            (item.date ? " · " + achievementDateLabel(item.date) : ""),
        ),
      );
      const actions = node("div");
      actions.className = "row";
      for (const [label, action] of [
        ["Edit", "edit"],
        ["Publish", "published"],
        ["Hide", "hidden"],
        ["Move up", "up"],
        ["Move down", "down"],
        ["Remove", "delete"],
      ]) {
        const control = button(label, () => {
          if (action === "edit") {
            select(item);
            return;
          }
          if (item.id === selected && dirty()) {
            output.textContent =
              "Save or discard these edits before changing this achievement.";
            return;
          }
          if (
            action === "delete" &&
            !confirm("Remove “" + item.title + "” from your achievements?")
          )
            return;
          const command: StudioCommand =
            action === "up" || action === "down"
              ? { action: "reorder", ids: collection.items.map((x) => x.id) }
              : {
                  action: action === "delete" ? "delete" : "visibility",
                  id: item.id,
                  ...(action === "delete" ? {} : { status: action }),
                };
          if (command.action === "reorder") {
            const next = action === "up" ? index - 1 : index + 1;
            if (next < 0 || next >= command.ids.length) return;
            [command.ids[index], command.ids[next]] = [
              command.ids[next],
              command.ids[index],
            ];
          }
          void mutate(command);
        });
        control.dataset.rowAction = action;
        control.setAttribute("aria-label", label + " " + item.title);
        actions.append(control);
      }
      row.append(actions);
      list.append(row);
    }
    if (!collection.items.length)
      list.append(
        node("p", "No achievements yet. Start with a private draft below."),
      );
    list.append(button("Add another achievement", () => select(null)));
    sync();
  }
  async function refresh(command: StudioCommand, ambiguous: boolean) {
    blocked = true;
    compare.hidden = false;
    compare.replaceChildren(
      node("p", "Loading the saved achievements. Your edits are kept here."),
    );
    sync();
    try {
      const response = await fetch(base + "/api/export", { cache: "no-store" });
      if (!response.ok)
        throw Error(
          "Could not compare the saved achievements. Sign in again if access expired.",
        );
      const exported = record(await response.json()),
        latest = achievements(exported.achievementCollection);
      if (
        !latest ||
        latest.version !== 1 ||
        !Number.isSafeInteger(latest.revision) ||
        !Array.isArray(latest.items) ||
        latest.items.length > 8
      )
        throw Error(
          "Saved achievements need owner review. Your edits are kept here.",
        );
      collection = latest;
      render();
      compare.replaceChildren();
      const saved = current();
      if (selected && !saved) {
        compare.append(
          node(
            "p",
            "This achievement was removed. Your text is kept here to copy. Discard edits to continue.",
          ),
        );
        output.textContent = "Nothing was resubmitted.";
        return;
      }
      if (!selected && ambiguous && command.action === "create") {
        compare.append(
          node(
            "p",
            "The draft save could not be confirmed. Check the saved list above before adding it again. Your text remains here to copy; discard it before continuing.",
          ),
        );
        output.textContent = "Nothing was resubmitted.";
        return;
      }
      compare.append(
        node(
          "p",
          saved
            ? "The saved achievement may have changed. Compare before saving again."
            : "The saved list is current. Your new draft has not been resubmitted.",
        ),
      );
      if (saved) {
        const details = node("dl");
        for (const key of keys) {
          details.append(
            node("dt", "Saved " + key),
            node("dd", saved[key] || "Not set"),
          );
        }
        compare.append(details);
      }
      const choices = node("div");
      choices.className = "row";
      choices.append(
        button("Use saved version", () => {
          fill(saved ?? null);
          output.textContent = "Using the saved version.";
          field(form, "title").focus();
        }),
        button("Keep my edits", () => {
          baseline = normalBaseline(saved ?? blank());
          markSaved(baseline);
          blocked = false;
          compare.hidden = true;
          sync();
          output.textContent =
            "Your edits are kept. Check visibility before saving again.";
          field(form, selected ? "status" : "title").focus();
        }),
      );
      compare.append(choices);
      output.textContent = "Nothing was resubmitted.";
    } catch (cause) {
      const error = failure(cause);
      compare.replaceChildren(
        node("p", error.message),
        button(
          "Compare saved achievements",
          () => void compareAgain(command, ambiguous),
        ),
      );
      output.textContent =
        "Your text is kept. Saving stays blocked until the saved version can be checked.";
    }
  }
  async function compareAgain(command: StudioCommand, ambiguous: boolean) {
    const unlock = lock();
    if (!unlock) return;
    try {
      await refresh(command, ambiguous);
    } finally {
      unlock();
      sync();
    }
  }
  async function mutate(command: StudioCommand) {
    if (blocked) return;
    const unlock = lock();
    if (!unlock) return;
    sync();
    try {
      const response = await request("/api/achievements", {
        ...command,
        expectedRevision: collection.revision,
      });
      collection = achievements(response.collection);
      if (command.action === "create") {
        fill(collection.items.find((item) => item.id === response.id));
      } else if (
        command.action === "edit" ||
        ("id" in command && command.id === selected)
      ) {
        fill(current() ?? null);
      }
      render();
      preview.hidden = true;
      output.textContent =
        command.action === "create"
          ? "Draft saved. Publish it from the list when ready."
          : command.action === "delete"
            ? "Achievement removed."
            : command.action === "reorder"
              ? "Achievement order saved."
              : "Achievement saved.";
    } catch (cause) {
      const error = failure(cause);
      output.textContent = error.message || "The save could not be confirmed.";
      if (error.status === 409 || !error.status || error.status >= 500)
        await refresh(command, error.status !== 409);
    } finally {
      unlock();
      sync();
    }
  }
  form.addEventListener("input", () => {
    preview.hidden = true;
    output.textContent = "";
    sync();
  });
  form.addEventListener("change", sync);
  form
    .querySelector<HTMLElement>("[data-achievement-discard]")!
    .addEventListener("click", () => {
      if (isBusy()) return;
      fill(current() ?? null);
      output.textContent = "Edits discarded. The saved version is shown.";
      field(form, "title").focus();
    });
  function checkedValues() {
    if (!form.reportValidity()) return null;
    const data = values();
    data.title = data.title.trim();
    data.date = data.date.trim();
    data.url = data.url.trim();
    if (!data.title) throw Error("Give the achievement a title.");
    if (!validAchievementDate(data.date))
      throw Error(
        "Use YYYY, YYYY-MM or a real YYYY-MM-DD date; leave blank if unknown.",
      );
    if (data.url) {
      const url = new URL(data.url);
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.href.length > 2048
      )
        throw Error(
          "Use an HTTPS destination without embedded credentials, up to 2,048 characters.",
        );
      data.url = url.href;
    }
    return data;
  }
  form
    .querySelector<HTMLButtonElement>("[data-achievement-preview]")!
    .addEventListener("click", () => {
      if (isBusy()) return;
      try {
        const data = checkedValues();
        if (!data) return;
        preview.replaceChildren(
          node("p", "Preview · not saved"),
          node("h3", data.title),
        );
        const date = achievementDateLabel(data.date);
        if (date) preview.append(node("p", date));
        if (data.description) preview.append(node("p", data.description));
        if (data.url) {
          const link = node("a", new URL(data.url).hostname);
          link.href = data.url;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          preview.append(link);
        }
        preview.hidden = false;
        output.textContent = "Preview updated. Nothing has been saved.";
      } catch (cause) {
        const error = failure(cause);
        output.textContent = error.message;
        preview.hidden = true;
      }
    });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (blocked || isBusy()) return;
    try {
      const item = checkedValues();
      if (!item) return;
      void mutate(
        selected
          ? { action: "edit", item: { id: selected, ...item } }
          : { action: "create", item: { ...item, status: "draft" } },
      );
    } catch (cause) {
      const error = failure(cause);
      output.textContent = error.message;
    }
  });
  fill(null);
  render();
}
