import {profileConfiguration,profileFields} from './profile.ts';
import {replaceCollectionSetting} from './settings-collection.ts';

// This file moves presentation settings only. App records and credentials are
// deliberately outside the format; an imported file grants no authority.
export const profileFileFormat='linkarooie.profile-settings';
export const profileSettingKeys=['title','intro','theme','layout',...profileFields.map(field=>field.key)];
const byteLength=(value:string)=>new TextEncoder().encode(value).byteLength;
const exact=(value:unknown,keys:string[]):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
export class ProfilePortabilityError extends Error {
 status:number;
 constructor(message:string,status=400){super(message);this.status=status;}
}
function configuration(value:unknown){
 if(!exact(value,profileSettingKeys))throw new ProfilePortabilityError('Use the supported profile settings, without extra fields.');
 try{return profileConfiguration(value);}catch(error){throw new ProfilePortabilityError(error instanceof Error?error.message:'Check the profile settings.');}
}
export function profileSettingsFile(value:unknown){
 if(!exact(value,['format','version','config'])||value.format!==profileFileFormat||value.version!==1)throw new ProfilePortabilityError('Choose a version 1 Linkarooie profile settings file.');
 const config=configuration(value.config);
 if(byteLength(JSON.stringify(value))>32768)throw new ProfilePortabilityError('Keep the settings file within 32 KiB.');
 return {format:profileFileFormat,version:1,config};
}
async function currentSettings(db:D1Database,defaults:Record<string,unknown>){
 try{
  const row=await db.prepare("SELECT value FROM settings WHERE id='config'").first<{value:string}>();
  const raw=row?.value??null;
  if(raw!==null&&(typeof raw!=='string'||byteLength(raw)>65536))throw Error();
  const stored=raw===null?{}:JSON.parse(raw);
  if(!stored||typeof stored!=='object'||Array.isArray(stored))throw Error();
  const merged={...defaults,...stored},config=configuration(Object.fromEntries(profileSettingKeys.map(key=>[key,merged[key]])));
  return {raw,stored,config};
 }catch{throw new ProfilePortabilityError('Saved profile settings need owner review or the connection is unavailable. Nothing was changed.',503);}
}
export async function exportProfileSettings(db:D1Database,defaults:Record<string,unknown>){
 const {config}=await currentSettings(db,defaults);
 return {format:profileFileFormat,version:1,config};
}
export async function changeProfileSettings(db:D1Database,input:unknown,defaults:Record<string,unknown>){
 if(!input||typeof input!=='object'||Array.isArray(input))throw new ProfilePortabilityError('Choose review or apply for a profile settings file.');
 const command=input as Record<string,unknown>,apply=command.action==='apply';
 if(!['review','apply'].includes(command.action as string)||!exact(command,apply?['action','file','expected']:['action','file']))throw new ProfilePortabilityError('Choose review or apply with the supported fields.');
 const file=profileSettingsFile(command.file),expected=apply?configuration(command.expected):null;
 const current=await currentSettings(db,defaults);
 const changedFields=profileSettingKeys.filter(key=>current.config[key]!==file.config[key]);
 if(!apply)return {ok:true,saved:false,before:current.config,after:file.config,changedFields};
 if(JSON.stringify(expected)!==JSON.stringify(current.config))throw new ProfilePortabilityError('Profile settings changed. Review the file against the saved settings before applying it again.',409);
 // Preserve unknown app-owned extensions in the existing row, while comparing
 // every stored byte to catch any write between this read and the SQL update.
 const bytes=JSON.stringify({...current.stored,...file.config});
 if(byteLength(bytes)>65536)throw new ProfilePortabilityError('Saved profile settings need owner review. Nothing was changed.',503);
 let saved;
 try{saved=await replaceCollectionSetting(db,'config',current.raw,bytes);}
 catch{throw new ProfilePortabilityError('The profile settings save could not be confirmed. Read the saved settings before trying again.',503);}
 if(!saved)throw new ProfilePortabilityError('Profile settings changed. Review the file against the saved settings before applying it again.',409);
 return {ok:true,saved:true,config:file.config,changedFields};
}
