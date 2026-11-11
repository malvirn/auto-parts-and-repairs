import supabase from "./supabaseClient.js";
import { mountVehicleInspectionDiagram, openVehiclePartEditor, vehicleDiagramSnapshot } from "./vehicle-inspection-diagram.js?v=original-silver-parts-1";

const $=id=>document.getElementById(id);
const esc=value=>String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
const params=new URLSearchParams(location.search);
// [key, name, icon, flip right-hand icons]
const CONDITION_GROUPS=[
 ["Top view",[
  ["bonnet","Bonnet (hood)","bonnet"],["windscreen","Windscreen with frame","glass"],["roof","Roof","roof"],["rear-glass","Rear screen (rear window)","rearglass"],["boot-lid","Boot lid (trunk lid)","boot"]
 ]],
 ["Front end",[
  ["front-bumper","Front bumper","bumper"],["grille","Front grille","bumper"],["l-headlight","Left headlight","headlight"],["r-headlight","Right headlight","headlight",1],["l-fog-light","Left fog light","headlight"],["r-fog-light","Right fog light","headlight",1],["front-plate-area","Front number plate area","boot"]
 ]],
 ["Rear end",[
  ["rear-bumper","Rear bumper","bumper"],["l-taillight","Left tail light","taillight"],["r-taillight","Right tail light","taillight",1],["rear-plate-area","Rear number plate area","boot"],["boot-spoiler","Boot spoiler lip","boot"]
 ]],
 ["Left side",[
  ["lf-wing","Left front fender (wing)","wing"],["lf-door","Left front door","door"],["lr-door","Left rear door","door"],["lr-quarter","Left rear quarter panel","wing"],["l-mirror","Left side mirror","mirror"],["l-side-skirt","Left side skirt","bumper"]
 ]],
 ["Right side",[
  ["rf-wing","Right front fender (wing)","wing",1],["rf-door","Right front door","door",1],["rr-door","Right rear door","door",1],["rr-quarter","Right rear quarter panel","wing",1],["r-mirror","Right side mirror","mirror",1],["r-side-skirt","Right side skirt","bumper",1]
 ]],
 ["Wheels",[
  ["wheel-lf","Left front alloy wheel and tyre","wheel"],["wheel-rf","Right front alloy wheel and tyre","wheel"],["wheel-lr","Left rear alloy wheel and tyre","wheel"],["wheel-rr","Right rear alloy wheel and tyre","wheel"],["spare-wheel","Spare wheel","wheel"]
 ]]
];
let selectedJob=null,record=null,report={parts:{},notes:""},editable=false;

function showMessage(text,isError=false){
 $("page-message").textContent=text;
 $("page-message").classList.toggle("error",isError);
}
function setDetailMessage(text,isError=false){
 $("detail-error").textContent=text;
 $("detail-error").classList.toggle("error",isError);
}
function applyNoDamageDefaults(){
 report.parts=report.parts||{};
}
function renderDamage(){
 const grid=$("inspection-grid");
 const parts=CONDITION_GROUPS.flatMap(([group,items])=>items.map(([key,name])=>({key,name,group})));
 mountVehicleInspectionDiagram(grid,{
  parts,
  getReport:()=>report,
  interactive:editable,
  onSelect:key=>{
   if(!editable)return;
   const part=parts.find(item=>item.key===key);
   if(!part)return;
   openVehiclePartEditor({
    part,
    entry:report.parts?.[key]||{dmg:[]},
    onSave:entry=>{
     const damage=Array.isArray(entry.dmg)?entry.dmg.filter(Boolean).slice(0,1):[];
     report.parts[key]={...entry,dmg:damage};
     renderDamage();
     renderInspectionSummary();
     persistInspectionLocally();
     if(record?.id)saveAreaMark(key).catch(error=>console.warn("Inspection mark will retry:",error));
     else scheduleChecklistAutosave();
    }
   });
  }
 });
}
function persistInspectionLocally(){
 try{localStorage.setItem("centric-inspection-draft-"+(record?.id||"new"),JSON.stringify({report,updated_at:new Date().toISOString()}));$("inspection-save-state").textContent="Saved on this device";}
 catch{$("inspection-save-state").textContent="Couldn't save this draft on this device";}
}
async function saveAreaMark(area){
 if(!record?.id||!editable)return;
 $("inspection-save-state").textContent="Saving…";
 const entry=report.parts?.[area]||{dmg:[]};
 let photo_path=null;
 if(entry.photo?.startsWith("data:image/")){
  const blob=await (await fetch(entry.photo)).blob();photo_path=record.id+"/"+area+".jpg";
  const {error}=await supabase.storage.from("vehicle-inspections").upload(photo_path,blob,{contentType:"image/jpeg",upsert:true});
  if(error)throw error;
 }else if(entry.photo_path)photo_path=entry.photo_path;
 if(entry.dmg?.length){
  const row={inspection_id:record.id,area_code:area,condition:entry.dmg[0],note:entry.note||null,photo_path};
  const {error}=await supabase.from("job_condition_report_marks").upsert(row,{onConflict:"inspection_id,area_code"});
  if(error)throw error;
 }else{
  const {error}=await supabase.from("job_condition_report_marks").delete().eq("inspection_id",record.id).eq("area_code",area);
  if(error)throw error;
 }
 const safeReport={...report,parts:Object.fromEntries(Object.entries(report.parts||{}).map(([k,v])=>[k,{dmg:v.dmg||[],note:v.note||" "}]))};
 const {error:reportError}=await supabase.from("job_condition_reports").update({report:safeReport,updated_at:new Date().toISOString()}).eq("id",record.id);
 if(reportError)throw reportError;
 $("inspection-save-state").textContent="Saved";
}
window.addEventListener("online",()=>{
 if(record?.id&&editable){Object.keys(report.parts||{}).forEach(key=>saveAreaMark(key).catch(error=>console.warn("Inspection retry failed:",error)));}
});
function renderInspectionSummary(){
 const parts=CONDITION_GROUPS.flatMap(([,items])=>items.map(([key,name])=>({key,name})));
 const marked=parts.filter(p=>report.parts?.[p.key]?.dmg?.length);
 const list=$("inspection-summary-list");if(!list)return;
 list.innerHTML=marked.length?marked.map(p=>{const e=report.parts[p.key];return `<div class="inspection-summary-item"><b>${esc(p.name)} · ${esc(e.dmg.join(", "))}</b>${e.note?`<small>${esc(e.note)}</small>`:""}${e.photo?`<img class="inspection-photo-thumb" src="${esc(e.photo)}" alt="Damage photo">`:""}</div>`}).join(""):'<p class="message">No damage recorded.</p>';
 $("inspection-mark-count").textContent=marked.length+" mark"+(marked.length===1?"":"s");
 $("inspection-save-state").textContent=marked.length?marked.length+" damaged area(s) recorded. All others are No Damage.":"All unmarked areas are No Damage.";
}
function syncInspectionStrip(){
 $("inspection-number-top").textContent=record?.inspection_no||(record?.checklist_number?"CL-"+String(record.checklist_number).padStart(6,"0"):"New inspection");
 $("inspection-job-top").textContent=selectedJob?(selectedJob.cro_number||"JC-"+String(selectedJob.job_number??"").padStart(5,"0")):"Not linked";
 $("inspection-cid-top").textContent=record?.customers?.customer_code||selectedJob?.customers?.customer_code||"Not linked";
 $("inspection-plate-top").textContent=$("vehicle-registration-input").value.trim().toUpperCase()||"Not recorded";
}
function getIncompleteConditions(){ return []; }

function validateInspection(){ return true; }

const normalizeMatch=value=>String(value||"").trim().toLocaleUpperCase();
function setEditable(value){
 editable=value&&!record?.voided_at&&!record?.confirmed_at;
 ["customer-name-input","vehicle-registration-input","checked-by-input"].forEach(id=>$(id).readOnly=!editable);
 ["customer-name-input","vehicle-registration-input","checked-by-input","fuel","odometer","checklist-notes"].forEach(id=>$(id).disabled=!editable);
 $("fuel").disabled=!editable;
 $("odometer").disabled=!editable;
 $("save-checklist").hidden=!editable;
 $("save-draft").hidden=!editable;
 $("delete-checklist").hidden=!record||Boolean(record.voided_at);
 $("void-checklist").hidden=!record||Boolean(record.voided_at);
 $("confirm-check").checked=false;
 $("save-checklist").disabled=editable;
 $("confirm-label").classList.toggle("hidden",!editable);
 if(editable)applyNoDamageDefaults();
 renderDamage();renderInspectionSummary();syncInspectionStrip();
}
let checklistAutosaveTimer=null;
let checklistCreating=false;
async function ensureChecklistRecord(){
 if(record?.id||checklistCreating||!editable)return record;
 checklistCreating=true;
 try{
  const payload={job_id:selectedJob?.id||null,customer_id:selectedJob?.customer_id||null,vehicle_id:selectedJob?.vehicle_id||null,customer_name:$("customer-name-input").value.trim()||null,vehicle_registration:$("vehicle-registration-input").value.trim().toUpperCase()||null,checked_by:$("checked-by-input").value.trim()||null,report:{...report,parts:{}},fuel_level_in:$("fuel").value||null,odometer_in:$("odometer").value.trim()?Number($("odometer").value):null,status:"draft"};
  const{data,error}=await supabase.from("job_condition_reports").insert(payload).select("id,checklist_number,inspection_no").single();
  if(error)throw error;
  record={...data,...payload};
  try{localStorage.removeItem("centric-inspection-draft-new");}catch{}
  $("checklist-number-display").textContent=record.inspection_no||"CL-"+String(record.checklist_number).padStart(6,"0");
  $("checklist-number-display").hidden=false;
  $("print-checklist-number").textContent="#"+record.checklist_number;
  syncInspectionStrip();
  return record;
 }catch(error){setDetailMessage("Couldn't create checklist automatically: "+error.message,true);throw error;}
 finally{checklistCreating=false;}
}
function scheduleChecklistAutosave(){
 if(!editable)return;
 persistInspectionLocally();
 clearTimeout(checklistAutosaveTimer);
 checklistAutosaveTimer=setTimeout(async()=>{
  try{
   await ensureChecklistRecord();
   const odometerText=$("odometer").value.trim(),odometer=odometerText?Number(odometerText):null;
   if(odometerText&&(!Number.isSafeInteger(odometer)||odometer<0))return;
   const payload={customer_name:$("customer-name-input").value.trim()||null,vehicle_registration:$("vehicle-registration-input").value.trim().toUpperCase()||null,checked_by:$("checked-by-input").value.trim()||null,report:{...report,notes:$("checklist-notes").value||"",parts:Object.fromEntries(Object.entries(report.parts||{}).map(([key,value])=>[key,{dmg:value.dmg||[],note:value.note||"",photo_path:value.photo_path||null}]))},fuel_level_in:$("fuel").value||null,odometer_in:odometer,updated_at:new Date().toISOString()};
   const{error}=await supabase.from("job_condition_reports").update(payload).eq("id",record.id);
   if(error)throw error;
   record={...record,...payload};
   $("inspection-save-state").textContent="Saved automatically";
   $("checklist-number-display").textContent=record.inspection_no||"CL-"+String(record.checklist_number).padStart(6,"0");
   $("checklist-number-display").hidden=false;syncInspectionStrip();
  }catch(error){console.warn("Checklist autosave failed:",error);$("inspection-save-state").textContent="Autosave failed. Changes kept on this device.";}
 },650);
}
function startNewChecklist(prefillJob=null){
 record=null;clearTimeout(checklistAutosaveTimer);report={parts:{},notes:""};try{const local=JSON.parse(localStorage.getItem("centric-inspection-draft-new")||"null");if(local?.report)report=local.report;}catch{}selectedJob=prefillJob;
 $("detail-view").classList.remove("hidden");$("list-view").classList.add("hidden");
 $("checklist-number-display").hidden=true;$("checklist-number-display").textContent="";
 $("reopen-inspection").hidden=true;syncInspectionStrip();
 $("print-checklist-number").textContent="";
 $("job-meta").hidden=!prefillJob;
 $("job-meta").textContent=prefillJob?`Checklist for ${prefillJob.cro_number||`JC-${String(prefillJob.job_number??"").padStart(5,"0")}`}`:"";
 $("customer-name-input").value=prefillJob?.customers?.full_name||"";
 $("vehicle-registration-input").value=prefillJob?.vehicles?.license_plate||"";
 $("checked-by-input").value="";
 $("checklist-notes").value="";
 $("fuel").value=prefillJob?.fuel_level_in||"";
 $("odometer").value=prefillJob?.odometer_in??"";
 $("confirmed-notice").classList.add("hidden");
 $("voided-notice").classList.add("hidden");
 $("open-job").classList.add("hidden");
 $("link-existing-fields").hidden=true;
 $("detail-status").textContent=prefillJob?"Complete the required drop-off details and confirm this checklist.":"Enter the customer and vehicle details, then complete the checklist.";
 $("save-checklist").textContent="Save and confirm checklist";
 setDetailMessage("");setEditable(true);renderInspectionSummary();syncInspectionStrip();
 ensureChecklistRecord().then(()=>scheduleChecklistAutosave()).catch(()=>{});
}
function renderChecklistList(rows){
 $("checklist-list").innerHTML=rows.length?rows.map(item=>{
  const customer=item.customer_name||item.customers?.full_name||"Customer not recorded";
  const vehicle=item.vehicle_registration||item.vehicles?.license_plate||"Registration not recorded";
  const linkedJob=item.repair_jobs?.cro_number||`JC-${String(item.repair_jobs?.job_number??"").padStart(5,"0")}`;
  const status=item.voided_at?`Voided ${new Date(item.voided_at).toLocaleString()} · ${item.void_reason||"No reason recorded"}`:item.job_id?`Linked to ${linkedJob}`:"Independent checklist · no job card linked";
  const activeActions=(item.voided_at||item.status==="completed"||item.confirmed_at)?"":`<button class="btn btn--danger" type="button" data-void-checklist="${esc(item.id)}">Void</button><button class="btn" type="button" data-delete-checklist="${esc(item.id)}">Delete</button>`;
  return `<div class="checklist-row"><div><span class="checklist-number">Checklist #${esc(item.checklist_number)}</span><br><strong>${esc(customer)} · ${esc(vehicle)}</strong><small>${esc(status)} · ${item.confirmed_at?new Date(item.confirmed_at).toLocaleString():"Draft checklist"}</small></div><div class="actions" style="margin-top:0"><a class="btn" href="checklist.html?id=${encodeURIComponent(item.id)}">Open checklist</a>${activeActions}</div></div>`;
 }).join(""):'<p class="message">No saved vehicle checklists yet. Create one to begin.</p>';
}
async function loadList(){
 const{data,error}=await supabase.from("job_condition_reports")
  .select("id,checklist_number,inspection_no,status,job_id,customer_id,vehicle_id,customer_name,vehicle_registration,confirmed_at,updated_at,voided_at,void_reason,customers(full_name,customer_code),vehicles(license_plate),repair_jobs(job_number,cro_number)")
  .order("updated_at",{ascending:false}).limit(300);
 if(error)throw new Error(`Couldn't load saved checklists: ${error.message}`);
 renderChecklistList(data||[]);
}
async function loadJob(jobId){
 const{data,error}=await supabase.from("repair_jobs").select("id,job_number,cro_number,customer_id,vehicle_id,fuel_level_in,odometer_in,customers(full_name,customer_code),vehicles(license_plate,make,model,year)").eq("id",jobId).single();
 if(error)throw new Error(`Couldn't load the job card: ${error.message}`);
 return data;
}
async function loadRecord(id){
 const{data,error}=await supabase.from("job_condition_reports")
  .select("id,checklist_number,inspection_no,status,job_id,customer_id,vehicle_id,customer_name,vehicle_registration,checked_by,report,confirmed_at,confirmed_by,fuel_level_in,odometer_in,voided_at,voided_by,void_reason,customers(full_name,customer_code),vehicles(license_plate),repair_jobs(job_number,cro_number)")
  .eq("id",id).single();
 if(error)throw new Error(`Couldn't load this checklist: ${error.message}`);
 return data;
}
async function loadInspectionMarks(item){
 const {data,error}=await supabase.from("job_condition_report_marks").select("area_code,condition,note,photo_path").eq("inspection_id",item.id);
 if(error)throw new Error("Couldn't load saved inspection marks: "+error.message);
 for(const mark of data||[]){
  let photo="";
  if(mark.photo_path){const {data:signed,error:signedError}=await supabase.storage.from("vehicle-inspections").createSignedUrl(mark.photo_path,3600);if(!signedError)photo=signed?.signedUrl||"";}
  report.parts[mark.area_code]={...(report.parts[mark.area_code]||{}),dmg:[mark.condition],note:mark.note||"",photo,photo_path:mark.photo_path||null};
 }
}
async function showRecord(item){
 record=item;report=item.report||{parts:{},notes:""};report.parts=report.parts||{};report.notes=report.notes||"";await loadInspectionMarks(item);try{const local=JSON.parse(localStorage.getItem("centric-inspection-draft-"+item.id)||"null");if(local?.report&&new Date(local.updated_at).getTime()>new Date(item.updated_at||0).getTime())report=local.report;}catch{}
 selectedJob=item.job_id?{id:item.job_id,customer_id:item.customer_id,vehicle_id:item.vehicle_id,...item.repair_jobs}:null;
 $("detail-view").classList.remove("hidden");$("list-view").classList.add("hidden");
 $("customer-name-input").value=item.customer_name||item.customers?.full_name||"";
 $("vehicle-registration-input").value=item.vehicle_registration||item.vehicles?.license_plate||"";
 $("checklist-notes").value=report.notes;
 $("checklist-number-display").textContent=item.inspection_no||"CL-"+String(item.checklist_number).padStart(6,"0");
 syncInspectionStrip();
 $("checklist-number-display").hidden=false;
 $("print-checklist-number").textContent=`#${item.checklist_number}`;
 $("checked-by-input").value=item.checked_by||"";
 $("job-meta").hidden=!item.job_id;
 $("job-meta").textContent=item.job_id?`Linked to ${item.repair_jobs?.cro_number||`JC-${String(item.repair_jobs?.job_number??"").padStart(5,"0")}`}`:"";
 $("fuel").value=item.fuel_level_in||"";$("odometer").value=item.odometer_in??"";
 $("detail-status").textContent=item.voided_at?`Voided ${new Date(item.voided_at).toLocaleString()}. ${item.void_reason||"No reason recorded"}`:item.confirmed_at?`Completed ${new Date(item.confirmed_at).toLocaleString()}. This inspection is read-only.`:"Complete the inspection when all drop-off details are ready. A job card is optional.";
 $("save-checklist").textContent=item.confirmed_at?"Inspection completed":"Complete inspection";
 $("confirmed-notice").textContent=item.confirmed_at?`Checklist confirmed by ${item.checked_by||"staff"}.`:"";
 $("confirmed-notice").classList.toggle("hidden",!item.confirmed_at);
 $("voided-notice").textContent=item.voided_at?`Checklist voided ${new Date(item.voided_at).toLocaleString()} · ${item.void_reason||"No reason recorded"}`:"";
 $("voided-notice").classList.toggle("hidden",!item.voided_at);
 $("open-job").classList.toggle("hidden",Boolean(item.voided_at));
 $("open-job").textContent=item.job_id?"Open linked job card":"Create job card with checklist details";
 $("open-job").href=item.job_id
  ?`repairs.html?edit=${encodeURIComponent(item.job_id)}`
  :`repairs.html?checklist=${encodeURIComponent(item.id)}`;
 $("link-existing-fields").hidden=Boolean(item.job_id)||Boolean(item.voided_at);
 $("link-job").disabled=true;
 setEditable(!item.voided_at);
 $("reopen-inspection").hidden=true;
 if(item.status==="completed"||item.confirmed_at){const {data:u}=await supabase.auth.getUser();if(u?.user?.id){const {data:p}=await supabase.from("profiles").select("role").eq("id",u.user.id).maybeSingle();$("reopen-inspection").hidden=!["super_admin","superadmin"].includes(String(p?.role||"").toLowerCase());}}
 renderInspectionSummary();syncInspectionStrip();
 setDetailMessage("");
 if(!item.job_id&&!item.voided_at)await loadMatchingJobs(item);
}
async function loadMatchingJobs(item){
 const{data,error}=await supabase.from("repair_jobs")
  .select("id,job_number,cro_number,customer_id,vehicle_id,customers(full_name),vehicles(license_plate)")
  .order("created_at",{ascending:false}).limit(1000);
 if(error)throw new Error(`Couldn't load matching job cards: ${error.message}`);
 const matches=(data||[]).filter(job=>
  normalizeMatch(job.customers?.full_name)===normalizeMatch(item.customer_name)
  && normalizeMatch(job.vehicles?.license_plate)===normalizeMatch(item.vehicle_registration)
  && (!item.customer_id||String(item.customer_id)===String(job.customer_id))
  && (!item.vehicle_id||String(item.vehicle_id)===String(job.vehicle_id))
 );
 $("job-select").replaceChildren(new Option(matches.length?"Select a job card":"No matching job cards",""),...matches.map(job=>new Option(job.cro_number||`JC-${String(job.job_number??"").padStart(5,"0")}`,job.id)));
 $("link-existing-fields").hidden=!matches.length;
}
async function saveDraft(){
 const button=$("save-draft");
 if(record?.voided_at)return setDetailMessage("This checklist is voided and cannot be changed.",true);
 if(record?.confirmed_at)return setDetailMessage("This inspection is already completed.",true);
 button.disabled=true;setDetailMessage("");
 try{
  const customerName=$("customer-name-input").value.trim();
  const vehicleRegistration=$("vehicle-registration-input").value.trim().toUpperCase();
  const odometerText=$("odometer").value.trim();
  const odometer=odometerText?Number(odometerText):null;
  if(odometerText&&(!Number.isSafeInteger(odometer)||odometer<0))throw new Error("Enter a valid whole-number odometer reading.");
  const persistedReport={...report,notes:$("checklist-notes").value||"",parts:Object.fromEntries(Object.entries(report.parts||{}).map(([key,value])=>[key,{dmg:value.dmg||[],note:value.note||"",photo_path:value.photo_path||null}]))};
  const payload={job_id:selectedJob?.id||record?.job_id||null,customer_id:record?.customer_id||selectedJob?.customer_id||null,vehicle_id:record?.vehicle_id||selectedJob?.vehicle_id||null,customer_name:customerName||null,vehicle_registration:vehicleRegistration||null,checked_by:$("checked-by-input").value.trim()||null,report:persistedReport,fuel_level_in:$("fuel").value||null,odometer_in:odometer,status:"draft",updated_at:new Date().toISOString()};
  let checklistId=record?.id;
  if(checklistId){
   const {error}=await supabase.from("job_condition_reports").update(payload).eq("id",checklistId);
   if(error)throw new Error("Couldn't save this draft: "+error.message);
  }else{
   const {data,error}=await supabase.from("job_condition_reports").insert(payload).select("id,checklist_number,inspection_no").single();
   if(error)throw new Error("Couldn't save this draft: "+error.message);
   checklistId=data.id;record={...data,...payload};
  }
  record={...record,...payload,id:checklistId};
  for(const [area,entry] of Object.entries(report.parts||{})){
   const conditions=Array.isArray(entry?.dmg)?entry.dmg:[];
   let photo_path=entry.photo_path||null;
   if(entry.photo?.startsWith("data:image/")){
    const blob=await (await fetch(entry.photo)).blob();photo_path=checklistId+"/"+area+".jpg";
    const {error}=await supabase.storage.from("vehicle-inspections").upload(photo_path,blob,{contentType:"image/jpeg",upsert:true});
    if(error)throw new Error("Couldn't upload "+area+" photo: "+error.message);
   }
   if(conditions.length){
    const {error}=await supabase.from("job_condition_report_marks").upsert({inspection_id:checklistId,area_code:area,condition:conditions[0],note:entry.note||null,photo_path},{onConflict:"inspection_id,area_code"});
    if(error)throw new Error("Couldn't save "+area+": "+error.message);
    if(photo_path)entry.photo_path=photo_path;
   }else{
    const {error}=await supabase.from("job_condition_report_marks").delete().eq("inspection_id",checklistId).eq("area_code",area);
    if(error)throw new Error("Couldn't clear "+area+": "+error.message);
   }
  }
  try{localStorage.setItem("centric-inspection-draft-"+checklistId,JSON.stringify({report,updated_at:new Date().toISOString()}));localStorage.removeItem("centric-inspection-draft-new");}catch{}
  // Link automatically only when exactly one job matches this customer's vehicle.
  if(!record.job_id&&customerName&&vehicleRegistration){
   const{data:jobs,error:jobsError}=await supabase.from("repair_jobs")
    .select("id,job_number,cro_number,customer_id,vehicle_id,customers(full_name),vehicles(license_plate)")
    .order("created_at",{ascending:false}).limit(1000);
   if(jobsError)throw new Error("Checklist saved, but matching job cards could not be checked: "+jobsError.message);
   const matches=(jobs||[]).filter(job=>
    normalizeMatch(job.customers?.full_name)===normalizeMatch(customerName)
    &&normalizeMatch(job.vehicles?.license_plate)===normalizeMatch(vehicleRegistration)
    &&(!record.customer_id||String(record.customer_id)===String(job.customer_id))
    &&(!record.vehicle_id||String(record.vehicle_id)===String(job.vehicle_id))
   );
   if(matches.length===1){
    const{error:linkError}=await supabase.rpc("link_vehicle_condition_checklist",{p_checklist_id:checklistId,p_job_id:matches[0].id});
    if(linkError)throw new Error("Checklist saved, but automatic job linking failed: "+linkError.message);
    record.job_id=matches[0].id;selectedJob=matches[0];
   }
  }
  if(record.job_id){
   try{record=await loadRecord(checklistId);selectedJob={id:record.job_id,customer_id:record.customer_id,vehicle_id:record.vehicle_id,...record.repair_jobs};}catch{}
  }
  $("checklist-number-display").textContent=record.inspection_no||"CL-"+String(record.checklist_number).padStart(6,"0");
  $("checklist-number-display").hidden=false;
  $("open-job").classList.toggle("hidden",Boolean(record.voided_at));
  $("open-job").textContent=record.job_id?"Open linked job card":"Create job card with checklist details";
  $("open-job").href=record.job_id?"repairs.html?edit="+encodeURIComponent(record.job_id):"repairs.html?checklist="+encodeURIComponent(checklistId);
  $("job-meta").hidden=!record.job_id;
  $("job-meta").textContent=record.job_id?"Linked to "+(record.repair_jobs?.cro_number||"job card"):"";
  $("link-existing-fields").hidden=true;
  syncInspectionStrip();renderInspectionSummary();
  setDetailMessage(record.job_id?"Checklist saved. Inspection number generated and job card linked automatically.":"Checklist saved independently. You can link or create its job card later.");
  button.disabled=false;
 }catch(error){console.error("Checklist draft save failed:",error);setDetailMessage(error.message||String(error),true);button.disabled=false;}
}
async function saveAndConfirm(){
 const button=$("save-checklist");
 if(record?.voided_at)return setDetailMessage("This checklist is voided and cannot be changed.",true);
 if(!validateInspection())return;
 const customerName=$("customer-name-input").value.trim();
 const vehicleRegistration=$("vehicle-registration-input").value.trim().toUpperCase();
 const checkedBy=$("checked-by-input").value.trim();
 if(!customerName)return setDetailMessage("Enter the customer name.",true);
 if(!vehicleRegistration)return setDetailMessage("Enter the vehicle registration number.",true);
 if(!checkedBy)return setDetailMessage("Enter the name of the person completing the checklist.",true);
 if(!$("fuel").value)return setDetailMessage("Select the fuel level at drop-off.",true);
 const odometerText=$("odometer").value.trim();
 const odometer=odometerText?Number(odometerText):null;
 if(!odometerText||!Number.isSafeInteger(odometer)||odometer<0)return setDetailMessage("Enter a valid whole-number odometer reading.",true);
 button.disabled=true;setDetailMessage("");
 try{
  const persistedReport={...report,parts:Object.fromEntries(Object.entries(report.parts||{}).map(([key,value])=>[key,{dmg:value.dmg||[],note:value.note||""}]))};
  const payload={
   job_id:selectedJob?.id||record?.job_id||null,
   customer_id:record?.customer_id||selectedJob?.customer_id||null,
   vehicle_id:record?.vehicle_id||selectedJob?.vehicle_id||null,
   customer_name:customerName,vehicle_registration:vehicleRegistration,
   checked_by:checkedBy,report:persistedReport,
   fuel_level_in:$("fuel").value||null,odometer_in:odometer,
   updated_at:new Date().toISOString()
  };
  let checklistId=record?.id;
  if(checklistId){
   const{error}=await supabase.from("job_condition_reports").update({
    customer_name:payload.customer_name,
    vehicle_registration:payload.vehicle_registration,
    checked_by:payload.checked_by,
    report:payload.report,
    fuel_level_in:payload.fuel_level_in,
    odometer_in:payload.odometer_in,
    updated_at:payload.updated_at
   }).eq("id",checklistId);
   if(error)throw new Error(`Couldn't save checklist changes: ${error.message}`);
  }else{
   const{data,error}=await supabase.from("job_condition_reports").insert(payload).select("id,checklist_number").single();
   if(error)throw new Error(`Couldn't save the checklist: ${error.message}`);
   checklistId=data.id;
   record={id:checklistId,checklist_number:data.checklist_number,...payload};
   try{localStorage.setItem("centric-inspection-draft-"+checklistId,JSON.stringify({report,updated_at:new Date().toISOString()}));}catch{}
  }
  const markRows=[];
  for(const [area,entry] of Object.entries(report.parts||{})){
   const conditions=Array.isArray(entry?.dmg)?entry.dmg:[];
   if(!conditions.length)continue;
   let photo_path=entry.photo_path||null;
   if(entry.photo?.startsWith("data:image/")){
    const response=await fetch(entry.photo),blob=await response.blob();
    photo_path=checklistId+"/"+area+".jpg";
    const {error:uploadError}=await supabase.storage.from("vehicle-inspections").upload(photo_path,blob,{contentType:"image/jpeg",upsert:true});
    if(uploadError)throw new Error("Couldn't upload "+area+" photo: "+uploadError.message);
   }
   markRows.push({inspection_id:checklistId,area_code:area,condition:conditions[0],note:entry.note||null,photo_path});
  }
  const{error:clearMarksError}=await supabase.from("job_condition_report_marks").delete().eq("inspection_id",checklistId);
  if(clearMarksError)throw new Error(`Couldn't refresh inspection marks: ${clearMarksError.message}`);
  if(markRows.length){
   const{error:marksError}=await supabase.from("job_condition_report_marks").insert(markRows);
   if(marksError)throw new Error(`Couldn't save inspection marks: ${marksError.message}`);
  }
  const{data:confirmedAt,error:confirmError}=await supabase.rpc("complete_vehicle_inspection",{p_inspection_id:checklistId});
  if(confirmError)throw new Error(`Inspection was saved but could not be completed: ${confirmError.message}`);
  record={...record,...payload,status:"completed",confirmed_at:confirmedAt||new Date().toISOString()};
  try{localStorage.removeItem("centric-inspection-draft-"+checklistId);localStorage.removeItem("centric-inspection-draft-new");}catch{}
  $("checklist-number-display").textContent=record.inspection_no||"CL-"+String(record.checklist_number).padStart(6,"0");
  $("checklist-number-display").hidden=false;
  $("print-checklist-number").textContent=record.inspection_no||"CL-"+String(record.checklist_number).padStart(6,"0");
  location.href=`checklist.html?id=${encodeURIComponent(checklistId)}`;
 }catch(error){
  console.error("Checklist save failed:",error);
  setDetailMessage(error.message||String(error),true);
  button.disabled=false;
 }
}

function printBlankInspectionSheet(){
 const printWindow=window.open("","_blank");
 if(!printWindow){setDetailMessage("Your browser blocked the print window. Allow pop-ups for this site and try again.",true);return}
 const logo=new URL("../assets/logo.png",location.href).href;
 const sketch=new URL("../assets/vehicle-inspection-sketch.svg",location.href).href;
 printWindow.document.write(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Blank Vehicle Inspection Form</title>
 <style>
 *{box-sizing:border-box}
 @page{size:A4 portrait;margin:8mm}
 html,body{margin:0;padding:0;background:#fff;color:#111;font:8pt/1.2 Arial,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
 body{width:194mm;max-width:100%;margin:0 auto}
 header{height:16mm;display:flex;align-items:center;gap:3mm;border-bottom:1.2pt solid #14243a;padding-bottom:2mm}
 header img{width:13mm;height:13mm;object-fit:contain}
 header h1{margin:0;font-size:15pt;line-height:1.1;letter-spacing:.2pt}
 header p{margin:1mm 0 0;font-size:6.5pt;font-weight:700;letter-spacing:.7pt}
 .ref{margin-left:auto;min-width:35mm;text-align:right;font-size:7pt;font-weight:700}
 .ref span{display:block;margin-top:2mm;border-bottom:1px solid #111;height:4mm}
 .details{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:2mm 4mm;margin:3mm 0 1mm}
 .field{height:7mm;border-bottom:.6pt solid #777;display:flex;align-items:flex-start;gap:1mm}
 .field b{font-size:6.5pt;white-space:nowrap}
 .field span{flex:1;min-width:0}
 h2{margin:2mm 0 1mm;font-size:8pt;text-transform:uppercase;letter-spacing:.4pt}
 .diagram{display:block;width:100%;height:194mm;object-fit:contain;object-position:center}
 .accessories{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1.5mm 4mm;margin:1mm 0 0}
 .accessory{white-space:nowrap;font-size:6.5pt}
 .box{display:inline-block;width:2.5mm;height:2.5mm;border:.6pt solid #111;vertical-align:-.5mm;margin:0 .7mm 0 1mm}
 .notes{height:10mm;border:.6pt solid #888;padding:1.5mm;margin-top:1mm}
 .signatures{display:grid;grid-template-columns:1fr 1fr 1fr;gap:5mm;margin-top:3mm}
 .sig{height:8mm;border-bottom:.6pt solid #555;font-size:6.5pt;display:flex;align-items:flex-end;padding-bottom:1mm}
 footer{margin-top:2mm;font-size:5.5pt;text-align:center;color:#555}
 @media print{body{width:auto}.diagram{break-inside:avoid}}
 </style></head><body>
 <header><img src="${esc(logo)}" alt="Centric Auto Mobile"><div><h1>VEHICLE INSPECTION FORM</h1><p>CENTRIC AUTO MOBILE · VEHICLE CONDITION REPORT</p></div><div class="ref">INSPECTION REF<span></span></div></header>
 <section class="details">
  <div class="field"><b>Customer:</b><span></span></div><div class="field"><b>Phone:</b><span></span></div><div class="field"><b>Date / Time:</b><span></span></div>
  <div class="field"><b>Make / Model:</b><span></span></div><div class="field"><b>Registration:</b><span></span></div><div class="field"><b>Mileage (km):</b><span></span></div>
 </section>
 <h2>Vehicle body condition · mark damaged areas with an X</h2>
 <img class="diagram" src="${esc(sketch)}" alt="Vehicle inspection sketch showing front, rear, left, right and top views">
 <h2>Accessories and items received</h2>
 <div class="accessories">
  <div class="accessory">Spare wheel <i class="box"></i>Present <i class="box"></i>Missing</div>
  <div class="accessory">Jack <i class="box"></i>Present <i class="box"></i>Missing</div>
  <div class="accessory">Wheel spanner <i class="box"></i>Present <i class="box"></i>Missing</div>
  <div class="accessory">Radio <i class="box"></i>Present <i class="box"></i>Missing</div>
  <div class="accessory">Toolkit <i class="box"></i>Present <i class="box"></i>Missing</div>
  <div class="accessory">Other: __________________</div>
 </div>
 <h2>Additional notes</h2><div class="notes"></div>
 <div class="signatures"><div class="sig">Customer / Driver signature:</div><div class="sig">Inspector signature:</div><div class="sig">Date:</div></div>
 <footer>Please remove all valuables from the vehicle. Centric Auto Mobile is not responsible for valuables left in the vehicle.</footer>
 </body></html>`);
 const imagesReady=Promise.all([...printWindow.document.images].map(img=>img.decode().catch(()=>{})));
 printWindow.document.close();
 imagesReady.then(()=>{printWindow.focus();printWindow.print()});
}
function printChecklist(blank=false){
 if(blank){printBlankInspectionSheet();return}
 const printWindow=window.open("","_blank");
 if(!printWindow){setDetailMessage("Your browser blocked the print window. Allow pop-ups for this site and try again.",true);return}
 printWindow.addEventListener("load",()=>{printWindow.focus();printWindow.print()},{once:true});
 const parts=CONDITION_GROUPS.map(([group,items])=>`
  <section><h2>${esc(group)}</h2><table><tbody>${items.map(([key,name])=>{
   const marked=report.parts?.[key],damage=Array.isArray(marked?.dmg)?marked.dmg:[];
   const condition=blank?"________________":damage.length?damage.join(", "):"No Damage";
   return `<tr><th>${esc(name)}</th><td>${esc(condition)}${marked?.note?`<br><small>${esc(marked.note)}</small>`:""}${marked?.photo?`<br><img src="${esc(marked.photo)}" style="max-width:110px;max-height:80px;object-fit:cover;border-radius:5px" alt="Damage photo">`:""}</td></tr>`;
  }).join("")}</tbody></table></section>`).join("");
 const checklistNumber=blank?"Blank inspection sheet":record?.checklist_number?`#${esc(record.checklist_number)}`:"Draft — not yet saved";
 const linkedJob=selectedJob?(selectedJob.cro_number||`JC-${String(selectedJob.job_number??"").padStart(5,"0")}`):"—";
 const confirmed=record?.voided_at?`Voided ${new Date(record.voided_at).toLocaleString()} · ${record.void_reason||"No reason recorded"}`:record?.confirmed_at?new Date(record.confirmed_at).toLocaleString():"Not confirmed";
 const note=String(report.notes||"").trim();
 const logo=new URL("../assets/logo.png",location.href).href;
 const inspectionImage=new URL("../img/vehicle-parts.webp",location.href).href;
 const customerCode=record?.customers?.customer_code||selectedJob?.customers?.customer_code||"—";
 printWindow.document.write(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Vehicle checklist ${checklistNumber}</title>
 <style>
 *{box-sizing:border-box}body{max-width:190mm;margin:0 auto;padding:10mm;color:#18212b;font:13px/1.5 Arial,sans-serif}
 header{display:flex;align-items:center;gap:14px;padding-bottom:14px;border-bottom:2px solid #394554}
 header img{width:58px;height:58px;object-fit:contain}header h1{margin:0;font-size:21px}header p{margin:3px 0;color:#536273}
 .number{margin-left:auto;text-align:right;font-size:16px;font-weight:700}
 .summary{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 18px;margin:18px 0}
 .summary div{padding:8px 10px;border:1px solid #d2d9e2;border-radius:6px;break-inside:avoid}
 .summary b{display:block;color:#536273;font-size:10px;text-transform:uppercase;letter-spacing:.06em}\n .vehicle-image{display:block;width:100%;max-height:105mm;object-fit:contain;margin:12px auto;border:1px solid #d2d9e2;border-radius:6px}
 h2{margin:16px 0 6px;font-size:14px}table{width:100%;border-collapse:collapse}
 th,td{padding:5px 8px;border-bottom:1px solid #d2d9e2;text-align:left;vertical-align:top}
 th{width:45%;font-weight:600}section{break-inside:avoid}
 .note,.liability{margin-top:16px;padding:10px 12px;border:1px solid #d2d9e2;border-radius:6px}
 .liability{border-left:4px solid #b45309;background:#fff7ed}
 footer{margin-top:24px;padding-top:10px;border-top:1px solid #d2d9e2;color:#536273;font-size:10px}
 @page{size:A4;margin:12mm}@media print{body{padding:0}}
 </style></head><body>
 <header><img src="${esc(logo)}" alt=""><div><h1>Vehicle Checklist</h1><p>Centric Auto Mobile</p></div><div class="number">${checklistNumber}</div></header>
 <div class="summary">
  <div><b>Customer</b>${blank?"________________":esc($("customer-name-input").value.trim()||"—")}</div>\n  <div><b>Customer ID</b>${blank?"________________":esc(customerCode)}</div>
  <div><b>Vehicle registration</b>${blank?"________________":esc($("vehicle-registration-input").value.trim().toUpperCase()||"—")}</div>
  <div><b>Checklist completed by</b>${blank?"________________":esc($("checked-by-input").value.trim()||"—")}</div>
  <div><b>Job card</b>${blank?"________________":esc(linkedJob)}</div>
  <div><b>Odometer at drop-off</b>${blank?"________________":esc($("odometer").value||"—")+" km"}</div>
  <div><b>Fuel at drop-off</b>${blank?"________________":esc($("fuel").value||"—")}</div>
  <div><b>Checklist status</b>${blank?"________________":esc(confirmed)}</div>
  <div><b>Printed</b>${esc(new Date().toLocaleString())}</div>
 </div>
 ${parts}
 ${!blank&&note?`<div class="note"><b>Notes</b><br>${esc(note).replace(/\n/g,"<br>")}</div>`:""}
 <div class="liability">Please remove all valuables from the vehicle. Centric Auto Mobile is not responsible for valuables left in the vehicle.</div>
 <footer>Customer / driver signature: ________________________________ &nbsp;&nbsp; Date: __________________</footer>
 </body></html>`);
 printWindow.document.close();
}

$("new-checklist").onclick=()=>startNewChecklist();
$("back-to-list").onclick=()=>{location.href="checklist.html"};
$("inspection-grid").addEventListener("change",event=>{
 const choice=event.target.closest("select[data-part]");
 if(!choice||!editable)return;
 report.parts[choice.dataset.part]={dmg:choice.value?[choice.value]:[]};
 choice.classList.toggle("has-dmg",Boolean(choice.value));
 choice.closest(".cond-card")?.classList.toggle("has-dmg",Boolean(choice.value));
});
$("checklist-notes").addEventListener("input",event=>{report.notes=event.target.value;scheduleChecklistAutosave();});
["customer-name-input","vehicle-registration-input","checked-by-input","fuel","odometer"].forEach(id=>{const el=$(id);el.addEventListener("input",scheduleChecklistAutosave);el.addEventListener("change",scheduleChecklistAutosave);});
$("confirm-check").onchange=event=>{$("save-checklist").disabled=!event.target.checked};
$("save-draft").onclick=saveDraft;
$("save-checklist").onclick=()=>{if(!validateInspection())return;if(!$("confirm-check").checked)return setDetailMessage("Confirm that the customer name and registration above are correct for this vehicle at drop-off.",true);saveAndConfirm()};
$("job-select").onchange=event=>{$("link-job").disabled=!event.target.value};
$("delete-checklist").onclick=()=>deleteChecklist(record?.id);
$("void-checklist").onclick=()=>voidChecklist(record?.id);
$("print-checklist").onclick=()=>printChecklist(false);
$("print-blank-checklist").onclick=()=>printChecklist(true);
$("reopen-inspection").onclick=async()=>{const reason=prompt("Why are you reopening this completed inspection?")?.trim();if(!reason)return;const button=$("reopen-inspection");button.disabled=true;const{error}=await supabase.rpc("reopen_vehicle_inspection",{p_inspection_id:record?.id,p_reason:reason});if(error){setDetailMessage("Couldn't reopen inspection: "+error.message,true);button.disabled=false;return;}location.reload();};
$("checklist-list").addEventListener("click",event=>{
 const voidButton=event.target.closest("[data-void-checklist]");
 if(voidButton){voidChecklist(voidButton.dataset.voidChecklist,voidButton);return}
 const button=event.target.closest("[data-delete-checklist]");
 if(button)deleteChecklist(button.dataset.deleteChecklist,button);
});
$("link-job").onclick=async()=>{
 const button=$("link-job"),jobId=$("job-select").value;
 if(!record?.id||record.voided_at||!jobId)return;
 button.disabled=true;setDetailMessage("");
 const{error}=await supabase.rpc("link_vehicle_condition_checklist",{p_checklist_id:record.id,p_job_id:jobId});
 if(error){setDetailMessage(`Couldn't link checklist: ${error.message}`,true);button.disabled=false;return}
 location.href=`checklist.html?id=${encodeURIComponent(record.id)}`;
};
async function deleteChecklist(checklistId,button=$("delete-checklist")){
 if(record?.id===checklistId&&record.voided_at)return;
 if(!checklistId||!await window.aprConfirm("Delete this checklist? This cannot be undone.",{title:"Delete checklist",confirmLabel:"Delete checklist",danger:true}))return;
 button.disabled=true;showMessage("");
 const{data,error}=await supabase.from("job_condition_reports").delete().eq("id",checklistId).select("id").maybeSingle();
 if(error||!data){
  const message=error?.message||"The checklist was not deleted.";
  console.error("Checklist deletion failed:",error||message);
  if(record?.id===checklistId)setDetailMessage(`Couldn't delete checklist: ${message}`,true);
  else showMessage(`Couldn't delete checklist: ${message}`,true);
  button.disabled=false;
  return;
 }
 if(record?.id===checklistId){
  record=null;selectedJob=null;
  $("detail-view").classList.add("hidden");$("list-view").classList.remove("hidden");
 }
 await loadList();
 showMessage("Checklist deleted.");
}
async function voidChecklist(checklistId,button=$("void-checklist")){
 if(!checklistId)return;
 const reason=prompt("Reason for voiding this checklist:")?.trim();
 if(!reason)return;
 if(!await window.aprConfirm("Void this checklist? Its audit history will be retained.",{title:"Void checklist",confirmLabel:"Void checklist",danger:true}))return;
 button.disabled=true;
 const{error}=await supabase.rpc("void_vehicle_condition_checklist",{p_checklist_id:checklistId,p_reason:reason});
 if(error){
  const message=`Couldn't void checklist: ${error.message}`;
  if(record?.id===checklistId)setDetailMessage(message,true);else showMessage(message,true);
  button.disabled=false;
  return;
 }
 if(record?.id===checklistId)await showRecord(await loadRecord(checklistId));
 await loadList();
 showMessage("Checklist voided. Its record and reason remain available for review.");
}

function jobRef(job){return job.cro_number||`JC-${String(job.job_number??"").padStart(5,"0")}`}
function renderDrafts(rows){
 $("drafts-count").textContent=rows.length?`(${rows.length})`:"";
 $("drafts-list").innerHTML=rows.length?rows.map(job=>{
  const customer=job.customers?.full_name||"Customer not recorded",v=job.vehicles,plate=v?.license_plate||"No registration",car=[v?.make,v?.model].filter(Boolean).join(" ");
  return `<div class="checklist-row"><div><strong>${esc(jobRef(job))} · ${esc(customer)} · ${esc(plate)}</strong><small>${esc(car?car+" · ":"")}Saved ${job.created_at?new Date(job.created_at).toLocaleString():""} · Waiting for a checklist</small></div><div class="actions" style="margin-top:0"><input type="number" min="1" step="1" inputmode="numeric" placeholder="Checklist number" aria-label="Checklist number for ${esc(jobRef(job))}" data-draft-number="${esc(job.id)}" style="max-width:170px"><button class="btn btn--primary" type="button" data-link-draft="${esc(job.id)}">Link checklist</button></div></div>`;
 }).join(""):'<p class="message">No draft job cards. Job cards saved without a checklist appear here.</p>';
}
async function loadDrafts(){
 const{data,error}=await supabase.from("repair_jobs").select("id,job_number,cro_number,created_at,customers(full_name),vehicles(license_plate,make,model)").eq("status","Draft").is("checklist_number",null).order("created_at",{ascending:false}).limit(300);
 if(error)throw new Error(`Couldn't load draft job cards: ${error.message}`);
 renderDrafts(data||[]);
}
function showTab(name){
 const drafts=name==="drafts";
 $("checklists-pane").hidden=drafts;$("drafts-pane").hidden=!drafts;
 $("tab-checklists").classList.toggle("btn--primary",!drafts);$("tab-drafts").classList.toggle("btn--primary",drafts);
}
$("tab-checklists").onclick=()=>showTab("checklists");
$("tab-drafts").onclick=()=>showTab("drafts");
$("drafts-list").addEventListener("click",async event=>{
 const button=event.target.closest("[data-link-draft]");
 if(!button)return;
 const jobId=button.dataset.linkDraft,input=[...$("drafts-list").querySelectorAll("[data-draft-number]")].find(el=>el.dataset.draftNumber===jobId),number=Number(input?.value);
 if(!Number.isSafeInteger(number)||number<1)return showMessage("Enter the checklist number to link.",true);
 button.disabled=true;showMessage("");
 const{error}=await supabase.rpc("link_draft_job_card_to_checklist",{p_job_id:jobId,p_checklist_number:number});
 if(error){showMessage(`Couldn't link checklist #${number}: ${error.message}`,true);button.disabled=false;return}
 showMessage(`Checklist #${number} linked. The job card is now created.`);
 try{await Promise.all([loadList(),loadDrafts()])}catch(err){showMessage(err.message||String(err),true)}
});

async function initialize(){
 const{data:sessionData,error:sessionError}=await supabase.auth.getSession();
 if(sessionError)throw new Error(`Couldn't verify your sign-in: ${sessionError.message}`);
 if(!sessionData.session){location.href="../login.html";return}
 const{data:access,error:accessError}=await supabase.rpc("current_access_level");
 if(accessError)throw new Error(`Couldn't verify staff access: ${accessError.message}`);
 if(Number(access)<1)throw new Error("You do not have permission to access workshop checklists.");
 const jobId=params.get("job"),checklistId=params.get("id");
 if(checklistId){await showRecord(await loadRecord(checklistId));return}
 if(jobId){
  selectedJob=await loadJob(jobId);
  const{data:linked,error}=await supabase.from("job_condition_reports").select("id").eq("job_id",jobId).is("voided_at",null).maybeSingle();
  if(error)throw new Error(`Couldn't find the job's checklist: ${error.message}`);
  if(linked){await showRecord(await loadRecord(linked.id));return}
  startNewChecklist(selectedJob);return;
 }
 $("list-view").classList.remove("hidden");$("detail-view").classList.add("hidden");
 await loadList();
 await loadDrafts().catch(error=>showMessage(error.message||String(error),true));
 if(params.get("tab")==="drafts")showTab("drafts");
}
initialize().catch(error=>{console.error("Checklist page failed to initialize:",error);showMessage(error.message||String(error),true)});

