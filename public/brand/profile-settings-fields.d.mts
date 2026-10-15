export type ProfileSettingKey='title'|'intro'|'theme'|'layout'|'handle'|'website'|'github'|'bluesky'|'linkedin';
export type ProfileValues=Record<ProfileSettingKey,string>;
export type ProfileSettingsFile={format:'linkarooie.profile-settings';version:1;config:ProfileValues};
export const profileFields:{key:'handle'|'website'|'github'|'bluesky'|'linkedin';label:string;maxLength:number;default:string}[];
export function profileConfiguration(input:Record<string,unknown>,previous?:Record<string,unknown>):Record<string,unknown>;
export const profileFileFormat:'linkarooie.profile-settings';
export const profileSettingKeys:ProfileSettingKey[];
export class ProfilePortabilityError extends Error{status:number;constructor(message:string,status?:number);}
export function profileSettings(value:unknown):ProfileValues;
export function profileSettingsFile(value:unknown):ProfileSettingsFile;
