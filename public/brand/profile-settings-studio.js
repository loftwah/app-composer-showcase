// Files remain transient data. Never execute modules, fetch destinations or
// persist private profile settings in browser storage.
const labels={title:'Profile name',intro:'Introduction',theme:'Theme',layout:'Layout',handle:'Handle',website:'Website',github:'GitHub',bluesky:'Bluesky',linkedin:'LinkedIn'};
const keys=Object.keys(labels),supported=value=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key)&&typeof value[key]==='string');
export function setupProfileSettings({base,lock,isBusy,registerDraft}){
 const studio=document.querySelector('#profile-portability'),configForm=document.querySelector('#config');if(!studio||!configForm)return;
 const form=studio.querySelector('form'),input=form.elements.namedItem('file'),comparison=studio.querySelector('[data-settings-comparison]'),diff=studio.querySelector('[data-settings-diff]'),apply=studio.querySelector('[data-apply-settings]'),cancel=studio.querySelector('[data-cancel-settings]'),status=studio.querySelector('[data-portability-status]');
 const formValues=()=>Object.fromEntries(keys.map(key=>[key,configForm.elements.namedItem(key)?.value??'']));
 let formBaseline=JSON.stringify(formValues()),file=null,review=null,needsReview=true;
 registerDraft(()=>input.files.length>0&&(needsReview||!!review?.changedFields.length));
 const show=message=>{status.textContent=message;};
 const state=()=>{apply.disabled=isBusy()||needsReview||!review||review.changedFields.length===0;};
 const reset=()=>{file=null;review=null;needsReview=true;comparison.hidden=true;diff.replaceChildren();state();};
 input.addEventListener('change',()=>{reset();show(input.files.length?'Review the selected file before applying it.':'Choose a settings file to review.');});
 cancel.addEventListener('click',()=>{if(isBusy())return;reset();input.value='';show('Review closed.');input.focus();});
 async function request(command){
  const response=await fetch(base+'/api/profile-settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(command),signal:AbortSignal.timeout(15000)});
  const text=await response.text();if(text.length>65536)throw Error('The response could not be read. Review the saved settings before continuing.');
  const value=JSON.parse(text);if(!response.ok)throw Error(value.error||'The request could not be confirmed. Review the saved settings before continuing.');return value;
 }
 const render=()=>{
  diff.replaceChildren();
  for(const key of review.changedFields){
   const row=document.createElement('div'),term=document.createElement('dt'),before=document.createElement('dd'),after=document.createElement('dd');
   term.textContent=labels[key];before.textContent='Saved: '+(review.before[key]||'Not set');after.textContent='From file: '+(review.after[key]||'Not set');row.append(term,before,after);diff.append(row);
  }
  comparison.hidden=false;state();
 };
 form.addEventListener('submit',async event=>{
  event.preventDefault();if(isBusy())return;
  const selected=input.files[0];if(!selected){show('Choose a settings file first.');input.focus();return;}
  if(!selected.name.toLowerCase().endsWith('.json')||selected.size>32768){reset();show('Choose a .json settings file up to 32 KiB.');input.focus();return;}
  const unlock=lock();if(!unlock)return;studio.setAttribute('aria-busy','true');reset();show('Reviewing profile settings…');
  try{
   file=JSON.parse(await selected.text());const value=await request({action:'review',file});
   if(value.ok!==true||value.saved!==false||!supported(value.before)||!supported(value.after)||!Array.isArray(value.changedFields)||new Set(value.changedFields).size!==value.changedFields.length||value.changedFields.some(key=>!keys.includes(key)))throw Error('The review could not be read. Your saved settings were not changed.');
   review=value;needsReview=false;render();show(review.changedFields.length?'Review the changes below, then apply when ready.':'This file matches your saved profile. Nothing needs applying.');studio.querySelector('h3').focus();
  }catch(error){reset();show(error instanceof SyntaxError?'This file is not readable JSON. Choose a Linkarooie settings export.':error.name==='TimeoutError'?'The review timed out. Your saved settings were not changed; review the file again.':error.message||'Could not review this file. Your saved settings were not changed.');}
  finally{studio.removeAttribute('aria-busy');unlock();state();}
 });
 apply.addEventListener('click',async()=>{
  if(isBusy()||needsReview||!review||!review.changedFields.length)return;
  if(JSON.stringify(formValues())!==formBaseline){show('Save your profile edits or restore their original values before applying this file.');configForm.querySelector('input').focus();return;}
  const unlock=lock();if(!unlock)return;studio.setAttribute('aria-busy','true');needsReview=true;state();show('Applying reviewed profile settings…');
  try{
   const value=await request({action:'apply',file,expected:review.before});
   if(value.ok!==true||value.saved!==true||!supported(value.config))throw Error('The result could not be confirmed. Review the saved settings before continuing.');
   for(const key of keys)configForm.elements.namedItem(key).value=value.config[key];
   formBaseline=JSON.stringify(formValues());reset();input.value='';show('Profile settings applied. Save any other edits before refreshing to see the updated appearance.');status.focus();
  }catch(error){show((error.name==='TimeoutError'?'The save timed out and may have completed.':error.message||'The save could not be confirmed.')+' Review this file again to compare the saved settings before another apply.');status.focus();}
  finally{studio.removeAttribute('aria-busy');unlock();state();}
 });
}
