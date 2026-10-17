import { type ProfileTag, type TagValues } from "./profile-tag-fields.mjs";
import {
  field,
  failure,
  node,
  type Control,
  type StudioServices,
  type StudioCommand,
} from "./studio-dom.js";
import {
  tagKeys,
  tagLimit,
  blankTag,
  tagFields,
  tagCollection,
  tagValues,
  sameTag,
} from "./profile-tag-fields.mjs";
// Extends the existing inline collection editor/lock/recovery pattern. Private
// values stay in memory; destinations are never fetched and preview uses text.
export function setupTags({
  base,
  watch,
  lock,
  request,
  isBusy,
}: StudioServices) {
  const studio = document.querySelector<HTMLElement>("#tag-studio")!;
  if (!studio) return;
  let collection = tagCollection(JSON.parse(studio.dataset.snapshot!)),
    selected: string | null = null,
    blocked = false;
  delete studio.dataset.snapshot;
  const form = studio.querySelector<HTMLFormElement>("form")!,
    list = studio.querySelector<HTMLElement>("[data-tag-list]")!,
    output = studio.querySelector<HTMLElement>("[data-tag-message]")!,
    compare = studio.querySelector<HTMLElement>("[data-tag-compare]")!,
    preview = studio.querySelector<HTMLElement>("[data-tag-preview-output]")!,
    save = form.querySelector<HTMLButtonElement>("[type=submit]")!,
    previewButton =
      form.querySelector<HTMLButtonElement>("[data-tag-preview]")!;
  const values = (): TagValues =>
      Object.fromEntries(
        tagKeys.map((key) => [key, field(form, key).value]),
      ) as TagValues,
    markSaved = watch(form, tagKeys);
  let baseline = blankTag();
  const dirty = () => !sameTag(values(), baseline),
    current = () => collection.items.find((item) => item.id === selected);

  const button = (label: string, action: () => void) => {
    const control = node("button", label);
    control.type = "button";
    control.className = "secondary";
    control.addEventListener("click", () => {
      if (!isBusy()) action();
    });
    return control;
  };
  function validate() {
    try {
      return { value: tagFields(values()) };
    } catch (cause) {
      return { error: failure(cause) };
    }
  }
  function sync() {
    const pending = isBusy(),
      checked = validate(),
      show = !!selected || !sameTag(values(), blankTag());
    for (const control of studio.querySelectorAll<Control>(
      "button,input,textarea,select",
    ))
      control.disabled = pending;
    field(form, "status").disabled = pending || !selected;
    for (const help of form.querySelectorAll<HTMLElement>("[data-tag-help]")) {
      const fieldName = help.dataset.tagHelp!,
        invalid = show && checked.error?.field === fieldName;
      help.textContent = invalid ? checked.error!.message : "";
      field(form, fieldName).setAttribute("aria-invalid", String(invalid));
    }
    const referenceProblem =
      show &&
      ["citationURL", "citationLabel", "relatedURL", "relatedLabel"].includes(
        checked.error?.field ?? "",
      );
    form.querySelector<HTMLElement>("[data-tag-reference-error]")!.textContent =
      referenceProblem ? checked.error!.message : "";
    if (referenceProblem)
      form.querySelector<HTMLDetailsElement>(".tag-references")!.open = true;
    save.disabled =
      pending ||
      blocked ||
      !!checked.error ||
      (!selected && collection.items.length >= tagLimit);
    save.dataset.conflicted = String(blocked);
    previewButton.disabled = pending || !!checked.error;
    save.textContent = selected
      ? values().status === "published"
        ? "Save published changes"
        : "Save tag"
      : "Save draft";
    studio.querySelector<HTMLElement>("[data-save-help]")!.textContent =
      selected
        ? values().status === "published"
          ? "Saving publishes these changes immediately."
          : "Draft and hidden tags stay out of your public profile."
        : "New tags are saved as private drafts.";
    for (const control of list.querySelectorAll<HTMLButtonElement>(
      "[data-row-action]",
    )) {
      const id = control.closest<HTMLElement>("[data-tag]")!.dataset.tag,
        index = collection.items.findIndex((item) => item.id === id),
        item = collection.items[index],
        action = control.dataset.rowAction;
      control.disabled =
        pending ||
        blocked ||
        (id === selected && dirty() && action !== "edit") ||
        (action === "up" && index === 0) ||
        (action === "down" && index === collection.items.length - 1) ||
        action === item.status;
    }
    preview.hidden = preview.hidden || pending;
  }
  function fill(item: ProfileTag | null | undefined) {
    selected = item?.id ?? null;
    baseline = tagValues(item ?? blankTag());
    for (const key of tagKeys) field(form, key).value = baseline[key];
    markSaved(baseline);
    blocked = false;
    compare.hidden = true;
    compare.replaceChildren();
    preview.hidden = true;
    form.querySelector<HTMLElement>("[data-editor-heading]")!.textContent = item
      ? "Edit tag"
      : "Add a tag";
    form.querySelector<HTMLDetailsElement>(".tag-references")!.open = !!(
      baseline.citationURL ||
      baseline.citationLabel ||
      baseline.relatedURL ||
      baseline.relatedLabel
    );
    sync();
  }
  function select(item: ProfileTag | null) {
    if (dirty() || blocked) {
      output.textContent =
        "Save or discard the current edits before opening another tag.";
      form.querySelector<HTMLElement>("[data-tag-discard]")!.focus();
      return;
    }
    fill(item);
    output.textContent = "";
    field(form, "label").focus();
  }
  function render() {
    list.replaceChildren(
      node("p", collection.items.length + " of " + tagLimit + " tags"),
    );
    for (const [index, item] of collection.items.entries()) {
      const row = node("article");
      row.dataset.tag = item.id;
      row.append(node("h3", item.label), node("p", item.status));
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
              "Save or discard these edits before changing this tag.";
            return;
          }
          if (
            action === "delete" &&
            !confirm("Remove “" + item.label + "” from your tags?")
          )
            return;
          const command: StudioCommand =
            action === "up" || action === "down"
              ? {
                  action: "reorder",
                  ids: collection.items.map((item) => item.id),
                }
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
        control.setAttribute("aria-label", label + " " + item.label);
        actions.append(control);
      }
      row.append(actions);
      list.append(row);
    }
    if (!collection.items.length)
      list.append(node("p", "No tags yet. Start with a short private draft."));
    list.append(button("Add another tag", () => select(null)));
    sync();
  }
  async function refresh(command: StudioCommand, ambiguous: boolean) {
    blocked = true;
    compare.hidden = false;
    compare.replaceChildren(
      node("p", "Loading saved tags. Your edits are kept here."),
    );
    sync();
    try {
      const response = await fetch(base + "/api/export", { cache: "no-store" });
      if (!response.ok)
        throw Error(
          "Could not compare saved tags. Sign in again if access expired.",
        );
      const exported = await response.json();
      collection = tagCollection(exported.tagCollection);
      render();
      compare.replaceChildren();
      const saved = current();
      if (selected && !saved) {
        compare.append(
          node(
            "p",
            "This tag was removed. Your text is kept here to copy; discard edits to continue.",
          ),
        );
        output.textContent = "Nothing was resubmitted.";
        return;
      }
      if (!selected && ambiguous && command.action === "create") {
        compare.append(
          node(
            "p",
            "The draft save could not be confirmed. Check the saved list before adding it again. Your text remains here to copy; discard it before continuing.",
          ),
        );
        output.textContent = "Nothing was resubmitted.";
        return;
      }
      compare.append(
        node(
          "p",
          saved
            ? "Compare the saved tag before saving again."
            : "The saved list is current. Your draft was not resubmitted.",
        ),
      );
      if (saved) {
        const details = node("dl");
        for (const key of tagKeys)
          details.append(
            node("dt", "Saved " + key),
            node("dd", saved[key] || "Not set"),
          );
        compare.append(details);
      }
      const choices = node("div");
      choices.className = "row";
      choices.append(
        button("Use saved version", () => {
          fill(saved ?? null);
          output.textContent = "Using the saved version.";
          field(form, "label").focus();
        }),
        button("Keep my edits", () => {
          baseline = tagValues(saved ?? blankTag());
          markSaved(baseline);
          blocked = false;
          compare.hidden = true;
          sync();
          output.textContent =
            "Your edits are kept. Check visibility before saving again.";
          field(form, selected ? "status" : "label").focus();
        }),
      );
      compare.append(choices);
      output.textContent = "Nothing was resubmitted.";
    } catch (cause) {
      const error = failure(cause);
      compare.replaceChildren(
        node("p", error.message),
        button(
          "Compare saved tags",
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
      const response = await request("/api/tags", {
        ...command,
        expectedRevision: collection.revision,
      });
      collection = tagCollection(response.collection);
      if (command.action === "create")
        fill(collection.items.find((item) => item.id === response.id));
      else if (
        command.action === "edit" ||
        ("id" in command && command.id === selected)
      )
        fill(current() ?? null);
      render();
      preview.hidden = true;
      output.textContent =
        command.action === "create"
          ? "Draft saved. Publish it from the list when ready."
          : command.action === "delete"
            ? "Tag removed."
            : "Tag saved.";
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
    .querySelector<HTMLElement>("[data-tag-discard]")!
    .addEventListener("click", () => {
      if (isBusy()) return;
      fill(current() ?? null);
      output.textContent = "Edits discarded. The saved version is shown.";
      field(form, "label").focus();
    });
  previewButton.addEventListener("click", () => {
    if (isBusy()) return;
    const checked = validate();
    if (checked.error) {
      output.textContent = checked.error.message;
      return;
    }
    const data = checked.value;
    preview.replaceChildren(
      node("p", "Preview · not saved"),
      node("h3", data.label),
    );
    if (data.description.trim()) preview.append(node("p", data.description));
    for (const [url, label, prefix] of [
      [data.citationURL, data.citationLabel, "Source"],
      [data.relatedURL, data.relatedLabel, "Related work"],
    ])
      if (url) {
        const p = node("p", prefix + ": "),
          link = node("a", label || new URL(url).hostname);
        link.href = url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        p.append(link);
        preview.append(p);
      }
    preview.hidden = false;
    output.textContent = "Preview updated. Nothing was saved or fetched.";
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (blocked || isBusy()) return;
    const checked = validate();
    if (checked.error) {
      output.textContent = checked.error.message;
      return;
    }
    void mutate(
      selected
        ? { action: "edit", item: { id: selected, ...checked.value } }
        : { action: "create", item: { ...checked.value, status: "draft" } },
    );
  });
  fill(null);
  render();
}
