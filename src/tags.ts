import {tagFields,tagLimit,tagKeys,exactTagObject,tagCollection,type ProfileTag,type TagCollection} from '../public/brand/profile-tag-fields.mjs';
import {replaceCollectionSetting} from './settings-collection.ts';
export type {ProfileTag,TagCollection};
export {tagLimit};
const key='profile-tags-v1';
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
export class TagError extends Error{status:number;constructor(message:string,status=400){super(message);this.status=status;}}
const object=(value:unknown,keys:string[])=>{if(!exactTagObject(value,keys))throw new TagError('Use the supported tag fields.');return value;};
export const parseTagCollection=tagCollection;
export async function readTags(db:D1Database):Promise<{raw:string|null;collection:TagCollection}>{
 let row:{value:string}|null;try{row=await db.prepare('SELECT value FROM settings WHERE id=?').bind(key).first<{value:string}>();}catch{throw new TagError('Tags are unavailable. Refresh to check the connection.',503);}
 if(!row)return{raw:null,collection:{version:1,revision:0,items:[]}};
 try{if(typeof row.value!=='string'||new TextEncoder().encode(row.value).byteLength>65536)throw Error();return{raw:row.value,collection:parseTagCollection(JSON.parse(row.value))};}catch{throw new TagError('Saved tags need owner review. Nothing was changed.',503);}
}
export async function changeTags(db:D1Database,input:unknown){
 if(!input||typeof input!=='object'||Array.isArray(input))throw new TagError('Choose a tag action.');
 const command=input as Record<string,unknown>,action=command.action;
 const keys=action==='create'||action==='edit'?['action','expectedRevision','item']:action==='visibility'?['action','expectedRevision','id','status']:action==='delete'?['action','expectedRevision','id']:action==='reorder'?['action','expectedRevision','ids']:[];
 if(!keys.length)throw new TagError('Choose a supported tag action.');object(command,keys);
 if(!Number.isSafeInteger(command.expectedRevision)||Number(command.expectedRevision)<0)throw new TagError('Use the current saved tag revision.');
 const{raw,collection}=await readTags(db);if(command.expectedRevision!==collection.revision||collection.revision===2147483647)throw new TagError('Tags changed. Refresh and compare before saving again.',409);
 const items=collection.items.map(item=>({...item}));let id:string|undefined;
 if(action==='create'){
  const fields=tagFields(command.item);if(fields.status!=='draft')throw new TagError('Save a new tag as a draft before publishing.');if(items.length>=tagLimit)throw new TagError('Keep up to twelve tags. Remove one before adding another.',409);
  id=crypto.randomUUID();items.push({id,...fields});
 }else if(action==='reorder'){
  if(!Array.isArray(command.ids)||command.ids.length!==items.length||new Set(command.ids).size!==items.length||command.ids.some(id=>!uuid(id)||!items.some(item=>item.id===id)))throw new TagError('Include every current tag exactly once.');
  const ids=command.ids as string[];items.sort((a,b)=>ids.indexOf(a.id)-ids.indexOf(b.id));
 }else{
  const incoming=action==='edit'?object(command.item,['id',...tagKeys]):null,selected=incoming?.id??command.id;if(!uuid(selected))throw new TagError('Choose a current tag.');id=selected;
  const index=items.findIndex(item=>item.id===id);if(index<0)throw new TagError('This tag was removed. Refresh to check the saved list.',409);
  if(incoming){const{id:unused,...fields}=incoming;items[index]={id,...tagFields(fields)};}
  else if(action==='delete')items.splice(index,1);
  else{if(!['draft','published','hidden'].includes(command.status as string))throw new TagError('Choose a supported visibility.');items[index].status=command.status as ProfileTag['status'];}
 }
 const next:TagCollection={version:1,revision:collection.revision+1,items},bytes=JSON.stringify(next);if(new TextEncoder().encode(bytes).byteLength>65536)throw new TagError('The tag list exceeds its supported size.');
 let saved:{value:string}|null;try{saved=await replaceCollectionSetting(db,key,raw,bytes);}catch{throw new TagError('The save could not be confirmed. Refresh tags before retrying.',503);}
 if(!saved)throw new TagError('Tags changed. Refresh and compare before saving again.',409);
 return{collection:next,id};
}
