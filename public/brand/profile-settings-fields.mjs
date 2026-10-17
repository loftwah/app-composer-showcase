// Generated from checked TypeScript; edit src/browser or src/publisher.mts. MIT.
// MIT. Profile configuration and portable files are inert data, never code or credentials.
export const profileFields = [
    { key: "handle", label: "Handle", maxLength: 40, default: "" },
    { key: "website", label: "Website", maxLength: 2048, default: "" },
    { key: "github", label: "GitHub", maxLength: 2048, default: "" },
    { key: "x", label: "X", maxLength: 2048, default: "" },
    {
        key: "avatar",
        label: "Profile portrait URL",
        maxLength: 2048,
        default: "",
        image: true,
    },
    {
        key: "banner",
        label: "Profile banner URL",
        maxLength: 2048,
        default: "",
        image: true,
    },
    {
        key: "shareImage",
        label: "Social preview image URL (1200 × 630)",
        maxLength: 2048,
        default: "",
        image: true,
    },
    { key: "linkedin", label: "LinkedIn", maxLength: 2048, default: "" },
];
const hosts = {
    x: ["x.com", "twitter.com"],
    github: ["github.com"],
    bluesky: ["bsky.app"],
    linkedin: ["linkedin.com", "www.linkedin.com"],
};
export function profileConfiguration(input, previous = {}) {
    const result = { ...previous };
    for (const [key, max] of [
        ["title", 80],
        ["intro", 240],
    ]) {
        const value = input[key];
        if (typeof value !== "string" ||
            value.length > max ||
            /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))
            throw Error("Check the " + key + " text.");
        result[key] = value.trim();
    }
    if (!result.title)
        throw Error("Give your profile a title.");
    if (typeof input.theme !== "string" ||
        !["daylight", "midnight"].includes(input.theme))
        throw Error("Choose a supported theme.");
    if (typeof input.layout !== "string" ||
        !["grid", "editorial", "compact", "profile"].includes(input.layout))
        throw Error("Choose a supported layout.");
    result.theme = input.theme;
    result.layout = input.layout;
    for (const field of profileFields) {
        if (!Object.hasOwn(input, field.key))
            continue; // Older settings clients preserve these fields.
        const raw = input[field.key];
        if (typeof raw !== "string" ||
            raw.length > field.maxLength ||
            /[\u0000-\u001f]/.test(raw))
            throw Error("Check your " + field.label + " value.");
        const value = raw.trim();
        if (field.key === "handle") {
            if (value && !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,39}$/.test(value))
                throw Error("Use letters, numbers, dots, underscores or hyphens for the handle.");
            result[field.key] = value;
        }
        else {
            if (!value) {
                result[field.key] = "";
                continue;
            }
            let url;
            try {
                url = new URL(value);
            }
            catch {
                throw Error("Use a full HTTPS address for " + field.label + ".");
            }
            if (url.href.length > field.maxLength ||
                url.protocol !== "https:" ||
                url.username ||
                url.password ||
                (hosts[field.key] && !hosts[field.key].includes(url.hostname)))
                throw Error("Use an HTTPS " +
                    field.label +
                    " address without embedded credentials.");
            if (field.image && !/^[a-zA-Z0-9.:/\[\]-]+$/.test(url.origin))
                throw Error("Use an image address with a valid HTTPS hostname.");
            result[field.key] = url.href;
        }
    }
    if (Object.hasOwn(input, "bluesky")) {
        const value = input.bluesky;
        if (typeof value !== "string" || value.length > 2048)
            throw Error("Check the legacy profile setting.");
        if (value) {
            let u;
            try {
                u = new URL(value);
            }
            catch {
                throw Error("Check the legacy profile setting.");
            }
            if (u.protocol !== "https:" ||
                u.username ||
                u.password ||
                u.hostname !== "bsky.app")
                throw Error("Check the legacy profile setting.");
        }
        result.bluesky = value;
    }
    return result;
}
export const profileFileFormat = "linkarooie.profile-settings";
export const profileSettingKeys = [
    "title",
    "intro",
    "theme",
    "layout",
    "handle",
    "website",
    "github",
    "bluesky",
    "linkedin",
];
const byteLength = (value) => new TextEncoder().encode(value).byteLength;
const exact = (value, keys) => !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key));
export class ProfilePortabilityError extends Error {
    status;
    constructor(message, status = 400) {
        super(message);
        this.status = status;
    }
}
export function profileSettings(value) {
    if (!exact(value, profileSettingKeys))
        throw new ProfilePortabilityError("Use the supported profile settings, without extra fields.");
    try {
        return profileConfiguration(value);
    }
    catch (error) {
        throw new ProfilePortabilityError(error instanceof Error ? error.message : "Check the profile settings.");
    }
}
export function profileSettingsFile(value) {
    if (!exact(value, ["format", "version", "config"]) ||
        value.format !== profileFileFormat ||
        value.version !== 1)
        throw new ProfilePortabilityError("Choose a version 1 Linkarooie profile settings file.");
    const config = profileSettings(value.config);
    if (byteLength(JSON.stringify(value)) > 32768)
        throw new ProfilePortabilityError("Keep the settings file within 32 KiB.");
    return { format: profileFileFormat, version: 1, config };
}
