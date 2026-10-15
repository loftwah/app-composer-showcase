import {iconNames, type LinkIcon} from './profile.ts';
import {replaceCollectionSetting} from './settings-collection.ts';
import {validAchievementDate} from '../public/brand/achievement-date.mjs';
export {validAchievementDate,achievementDateLabel} from '../public/brand/achievement-date.mjs';

export type Achievement={id:string;title:string;description:string;date:string;url:string;icon:LinkIcon;status:'draft'|'published'|'hidden'};
export type AchievementCollection={version:1;revision:number;items:Achievement[]};
export const achievementLimit=8;
const key='profile-achievements-v1';
const identifier=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
export class AchievementError extends Error {status:number;constructor(message:string,status=400){super(message);this.status=status;}}
function object(value:unknown,keys:string[]):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||keys.some(name=>!Object.hasOwn(value,name)))throw new AchievementError('Use the supported achievement fields.');
 return value as Record<string,unknown>;
}
function string(value:unknown,max:number,label:string,multiline=false){
 if(typeof value!=='string'||value.length>max||(multiline?/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/:/[\u0000-\u001f]/).test(value))throw new AchievementError('Check the '+label+'.');
 return value;
}
function fields(input:unknown){
 const b=object(input,['title','description','date','url','icon','status']);
 const title=string(b.title,100,'achievement title').trim();if(!title)throw new AchievementError('Give the achievement a title.');
 const description=string(b.description,240,'achievement description',true),date=string(b.date,10,'known date').trim();
 if(!validAchievementDate(date))throw new AchievementError('Use a year, YYYY-MM or a real YYYY-MM-DD date; leave it blank if unknown.');
 let url=string(b.url,2048,'achievement destination').trim();
 if(url){try{const parsed=new URL(url);if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.href.length>2048)throw Error();url=parsed.href;}catch{throw new AchievementError('Use an HTTPS destination up to 2,048 characters without embedded credentials.');}}
 if(!iconNames.includes(b.icon as LinkIcon)||!['draft','published','hidden'].includes(b.status as string))throw new AchievementError('Choose a supported icon and visibility.');
 return {title,description,date,url,icon:b.icon as LinkIcon,status:b.status as Achievement['status']};
}
export function parseAchievementCollection(value:unknown):AchievementCollection {
 const b=object(value,['version','revision','items']);
 if(b.version!==1||!Number.isSafeInteger(b.revision)||Number(b.revision)<0||Number(b.revision)>2147483647||!Array.isArray(b.items)||b.items.length>achievementLimit)throw new AchievementError('Saved achievements need owner review.');
 const items=b.items.map(raw=>{const item=object(raw,['id','title','description','date','url','icon','status']);if(!identifier(item.id))throw new AchievementError('Saved achievements need owner review.');const{id,...values}=item;return{id,...fields(values)} as Achievement;});
 if(new Set(items.map(item=>item.id)).size!==items.length)throw new AchievementError('Saved achievements need owner review.');
 return {version:1,revision:Number(b.revision),items};
}
export async function readAchievements(db:D1Database):Promise<{raw:string|null;collection:AchievementCollection}>{
 let row:{value:string}|null;
 try{row=await db.prepare('SELECT value FROM settings WHERE id=?').bind(key).first<{value:string}>();}catch{throw new AchievementError('Achievements are unavailable. Refresh to check the connection.',503);}
 if(!row)return {raw:null,collection:{version:1,revision:0,items:[]}};
 try{
  if(typeof row.value!=='string'||new TextEncoder().encode(row.value).byteLength>32768)throw Error();
  return {raw:row.value,collection:parseAchievementCollection(JSON.parse(row.value))};
 }catch{throw new AchievementError('Saved achievements need owner review. Nothing was changed.',503);}
}
// One owned settings row. Compare its exact bytes inside the write, including
// the missing-row case, so two owner sessions cannot resurrect a stale list.
export async function changeAchievements(db:D1Database,input:unknown){
 if(!input||typeof input!=='object'||Array.isArray(input))throw new AchievementError('Choose an achievement action.');
 const command=input as Record<string,unknown>;
 const required=command.action==='create'||command.action==='edit'?['action','expectedRevision','item']:command.action==='visibility'?['action','expectedRevision','id','status']:command.action==='delete'?['action','expectedRevision','id']:command.action==='reorder'?['action','expectedRevision','ids']:[];
 if(!required.length)throw new AchievementError('Choose a supported achievement action.');object(command,required);
 if(!Number.isSafeInteger(command.expectedRevision)||Number(command.expectedRevision)<0)throw new AchievementError('Use the current saved achievement revision.');
 const {raw,collection}=await readAchievements(db);
 if(collection.revision!==command.expectedRevision||collection.revision===2147483647)throw new AchievementError('Achievements changed. Refresh and compare before saving again.',409);
 const items=collection.items.map(item=>({...item}));let id:string|undefined;
 if(command.action==='create'){
  const value=fields(command.item);if(value.status!=='draft')throw new AchievementError('Save a new achievement as a draft before publishing.');
  if(items.length>=achievementLimit)throw new AchievementError('Keep up to eight achievements. Remove one before adding another.',409);
  id=crypto.randomUUID();items.push({id,...value});
 }else if(command.action==='reorder'){
  if(!Array.isArray(command.ids)||command.ids.length!==items.length||new Set(command.ids).size!==items.length||command.ids.some(value=>!identifier(value)||!items.some(item=>item.id===value)))throw new AchievementError('Include every current achievement exactly once.');
  const order=command.ids as string[];items.sort((a,b)=>order.indexOf(a.id)-order.indexOf(b.id));
 }else{
  const incoming=command.action==='edit'?object(command.item,['id','title','description','date','url','icon','status']):null;
  const selected=incoming?.id??command.id;if(!identifier(selected))throw new AchievementError('Choose a current achievement.');id=selected;
  const index=items.findIndex(item=>item.id===id);if(index<0)throw new AchievementError('This achievement was removed. Refresh to check the saved list.',409);
  if(incoming){const{id:unused,...value}=incoming;items[index]={id,...fields(value)};}
  else if(command.action==='delete')items.splice(index,1);
  else{if(!['draft','published','hidden'].includes(command.status as string))throw new AchievementError('Choose a supported visibility.');items[index].status=command.status as Achievement['status'];}
 }
 const next:AchievementCollection={version:1,revision:collection.revision+1,items},bytes=JSON.stringify(next);
 if(new TextEncoder().encode(bytes).byteLength>32768)throw new AchievementError('The achievement list exceeds its supported size.');
 let saved:{value:string}|null;
 try{saved=await replaceCollectionSetting(db,key,raw,bytes);}catch{throw new AchievementError('The save could not be confirmed. Refresh achievements before retrying.',503);}
 if(!saved)throw new AchievementError('Achievements changed. Refresh and compare before saving again.',409);
 return {collection:next,id};
}
