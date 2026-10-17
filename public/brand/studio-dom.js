// Generated from checked TypeScript; edit src/browser or src/publisher.mts. MIT.
export function field(form, key) {
    const control = form.elements.namedItem(key);
    if (!(control instanceof HTMLInputElement ||
        control instanceof HTMLSelectElement ||
        control instanceof HTMLTextAreaElement))
        throw Error("Missing editor field: " + key);
    return control;
}
export function failure(cause) {
    if (!cause || typeof cause !== "object")
        return { message: String(cause), name: "Error" };
    const value = cause;
    return {
        message: typeof value.message === "string"
            ? value.message
            : "The request could not be confirmed.",
        name: typeof value.name === "string" ? value.name : "Error",
        ...(typeof value.status === "number" ? { status: value.status } : {}),
        ...(typeof value.field === "string" ? { field: value.field } : {}),
    };
}
export function record(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw Error("The response needs owner review.");
    return value;
}
export function achievements(value) {
    const collection = record(value);
    if (collection.version !== 1 ||
        typeof collection.revision !== "number" ||
        !Number.isSafeInteger(collection.revision) ||
        collection.revision < 0 ||
        !Array.isArray(collection.items) ||
        collection.items.length > 8)
        throw Error("Saved achievements need owner review. Your edits are kept here.");
    const items = collection.items.map((value) => {
        const item = record(value);
        if (!["id", "title", "description", "date", "url", "icon", "status"].every((key) => typeof item[key] === "string"))
            throw Error("Saved achievements need owner review. Your edits are kept here.");
        return item;
    });
    return { version: 1, revision: collection.revision, items };
}
export function node(tag, text) {
    const element = document.createElement(tag);
    if (text !== undefined)
        element.textContent = text;
    return element;
}
