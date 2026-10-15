// MIT. Profile tags are authored text and HTTPS references, never imported HTML.
export const tagKeys=['label','description','citationLabel','citationURL','relatedLabel','relatedURL','status'];
export const tagLimit=12;
export const blankTag=()=>Object.fromEntries(tagKeys.map(key=>[key,key==='status'?'draft':'']));
export class TagFieldError extends Error{constructor(field,message){super(message);this.field=field;}}
const invalid=(field,message)=>{throw new TagFieldError(field,message);};
export const exactTagObject=(value,keys)=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
export const tagValues=item=>Object.fromEntries(tagKeys.map(key=>[key,key==='description'?item[key].replace(/\r\n?/g,'\n'):item[key]]));
export const sameTag=(a,b)=>!!a&&!!b&&tagKeys.every(key=>key==='description'?a[key].replace(/\r\n?/g,'\n')===b[key].replace(/\r\n?/g,'\n'):a[key]===b[key]);
export function tagFields(input){
 if(!exactTagObject(input,tagKeys))invalid('form','Use the supported tag fields.');
 const result={...input};
 for(const [key,max]of [['label',40],['description',240],['citationLabel',100],['relatedLabel',100]]){
  const value=input[key];if(typeof value!=='string'||value.length>max||(key==='description'?/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/:/[\u0000-\u001f]/).test(value))invalid(key,'Use '+(key==='description'?'an explanation':'text')+' up to '+max+' characters without control characters.');
  result[key]=key==='description'?value:value.trim();
 }
 if(!result.label)invalid('label','Give the tag a short label, up to 40 characters.');
 for(const key of ['citationURL','relatedURL']){
  const message='Use a full HTTPS address without embedded credentials, up to 2,048 characters. Leave blank when unused.';
  if(typeof input[key]!=='string'||input[key].length>2048||/[\u0000-\u001f]/.test(input[key]))invalid(key,message);
  let value=input[key].trim();if(value){try{const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password||url.href.length>2048)invalid(key,message);value=url.href;}catch{invalid(key,message);}}result[key]=value;
 }
 for(const [label,url]of [['citationLabel','citationURL'],['relatedLabel','relatedURL']])if(result[label]&&!result[url])invalid(url,'Add the HTTPS destination for this link, or clear its label.');
 if(!['draft','published','hidden'].includes(result.status))invalid('status','Choose draft, published or hidden visibility.');
 return result;
}
export const tagHasContext=tag=>!!(tag.description.trim()||tag.citationURL||tag.relatedURL);
export function tagCollection(value){
 if(!exactTagObject(value,['version','revision','items'])||value.version!==1||!Number.isSafeInteger(value.revision)||value.revision<0||value.revision>2147483647||!Array.isArray(value.items)||value.items.length>tagLimit)invalid('form','Saved tags need owner review.');
 const items=value.items.map(item=>{if(!exactTagObject(item,['id',...tagKeys])||typeof item.id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(item.id))invalid('form','Saved tags need owner review.');const{id,...fields}=item;return{id,...tagFields(fields)};});
 if(new Set(items.map(item=>item.id)).size!==items.length)invalid('form','Saved tags need owner review.');return{version:1,revision:value.revision,items};
}
