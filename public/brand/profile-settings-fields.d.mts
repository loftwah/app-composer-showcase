// Generated from checked TypeScript; edit src/browser or src/publisher.mts. MIT.
export type ProfileSettingKey = "title" | "intro" | "theme" | "layout" | "handle" | "website" | "github" | "bluesky" | "linkedin";
export type ProfileValues = Record<ProfileSettingKey, string>;
export type ProfileSettingsFile = {
    format: "linkarooie.profile-settings";
    version: 1;
    config: ProfileValues;
};
export declare const profileFields: {
    key: string;
    label: string;
    maxLength: number;
    default: string;
    image?: boolean;
}[];
export declare function profileConfiguration(input: Record<string, unknown>, previous?: Record<string, unknown>): {
    [x: string]: unknown;
};
export declare const profileFileFormat = "linkarooie.profile-settings";
export declare const profileSettingKeys: ProfileSettingKey[];
export declare class ProfilePortabilityError extends Error {
    status: number;
    constructor(message: string, status?: number);
}
export declare function profileSettings(value: unknown): ProfileValues;
export declare function profileSettingsFile(value: unknown): ProfileSettingsFile;
