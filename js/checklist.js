import supabase from "./supabaseClient.js";
import { mountVehicleInspectionDiagram, openVehiclePartEditor } from "./vehicle-inspection-diagram.js?v=inspection-upgrade-2";

const $=id=>document.getElementById(id);
const esc=value=>String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
const params=new URLSearchParams(location.search);
const DAMAGE_TYPES=["Scratch","Dent","Crack","Chip","Broken","Missing","Stretched","Worn","Flat","Bald"];
const PI={
 bumper:'<path class="g" d="M6 29c0-5 3-8 8-8h20c5 0 8 3 8 8v4H6z"/><path d="M11 33v3M37 33v3M13 25h22"/>',
 bonnet:'<path class="g" d="M10 35l4-17c.5-2 2-3 4-3h12c2 0 3.5 1 4 3l4 17z"/><path d="M19 23h10M17 28h14"/>',
 roof:'<rect class="g" x="14" y="8" width="20" height="32" rx="8"/><path d="M18 16h12M18 32h12"/>',
 wing:'<path class="g" d="M7 34v-8c0-3 2-5 5-5h8c3 0 5 2 7 5l3 8z"/><path d="M12 34a6 6 0 0 1 12 0M30 17h9"/>',
 door:'<path class="g" d="M11 37V14c0-2 1-3 3-3h15c3 0 5 2 6 5l2 21z"/><path d="M17 19h14M31 29h5"/>',
 glass:'<path class="g" d="M9 34l5-17c.4-1.3 1.5-2 3-2h14c1.5 0 2.6.7 3 2l5 17z"/><path d="M24 15v19M13 30h22"/>',
 rearglass:'<path class="g" d="M11 33l3-14c.4-1.5 1.5-2 3-2h14c1.5 0 2.6.5 3 2l3 14z"/><path d="M15 23h18M14 28h20"/>',
 mirror:'<path class="g" d="M16 12h16a5 5 0 0 1 5 5v7a5 5 0 0 1-5 5H16a5 5 0 0 1-5-5v-7a5 5 0 0 1 5-5z"/><path d="M24 29v7M18 37h12"/>',
 headlight:'<path class="g" d="M8 24c0-8 5-13 12-13v26c-7 0-12-5-12-13z"/><path d="M26 15h14M26 21h14M26 27h14M26 33h14"/>',
 taillight:'<rect class="g" x="8" y="16" width="25" height="16" rx="4"/><path d="M37 18v12M41 20v8M14 24h13"/>',
 boot:'<path class="g" d="M8 35V23c0-2 1.5-3.5 3.5-3.5h25c2 0 3.5 1.5 3.5 3.5v12z"/><path d="M14 19l2-7h16l2 7M18 28h12"/>',
 wheel:'<circle cx="24" cy="24" r="14"/><circle class="g" cx="24" cy="24" r="4"/><path d="M24 10v10M24 28v10M10 24h10M28 24h10"/>',
 seat:'<path class="g" d="M14 9h8c2 0 3 1 3 3l1 15h9c2 0 3 1 3 3v3H14z"/><path d="M14 37v3M37 37v3"/>',
 speedo:'<path d="M9 33a15 15 0 1 1 30 0"/><circle class="g" cx="24" cy="31" r="3.5"/><path d="M26 29l7-8M24 12v3M14 28h2M34 28h-2"/>',
 steer:'<circle cx="24" cy="24" r="15"/><circle cx="24" cy="24" r="10"/><path d="M14 26c6-2 14-2 20 0M24 28v8"/><circle class="g" cx="24" cy="26" r="3"/>',
 belt:'<path class="g" d="M16 10l9-1 6 11-9 8z"/><path d="M31 20l8 13-8 5M13 26l-3 3"/>',
 engine:'<rect class="g" x="13" y="19" width="22" height="15" rx="3"/><path d="M18 19v-4h12v4M9 24v6M39 24v6M24 23l-3.5 4.5h5L23 32"/>',
 radiator:'<rect class="g" x="12" y="12" width="24" height="5" rx="2"/><rect x="14" y="17" width="20" height="18"/><path d="M19 17v18M24 17v18M29 17v18"/><rect class="g" x="12" y="35" width="24" height="4" rx="2"/>',
 brake:'<circle cx="24" cy="24" r="15"/><circle class="g" cx="24" cy="24" r="7"/><circle cx="24" cy="24" r="2.5"/>',
 exhaust:'<rect class="g" x="7" y="21" width="9" height="8" rx="1.5"/><rect x="16" y="21" width="12" height="8" rx="1"/><path d="M33 19c3-2.5 5 .5 3 3 3 .5 3 5-.5 5M32 32l4 3"/>'
};
const partIcon=(icon,flip)=>`<svg class="pi${flip?" flip":""}" viewBox="0 0 48 48" aria-hidden="true"><circle class="bg" cx="24" cy="24" r="21"/>${PI[icon]||PI.bonnet}</svg>`;
// [key, name, icon, flip right-hand icons]
const CONDITION_GROUPS=[
 ["Body",[
  ["front-bumper","Front bumper","bumper"],["bonnet","Bonnet","bonnet"],["roof","Roof","roof"],["lf-wing","Left front wing","wing"],["rf-wing","Right front wing","wing",1],
  ["lf-door","Left front door","door"],["lr-door","Left rear door","door"],["rf-door","Right front door","door",1],["rr-door","Right rear door","door",1],["lr-quarter","Left rear quarter panel","wing"],["rr-quarter","Right rear quarter panel","wing",1],
  ["boot","Boot / tailgate","boot"],["boot-lid","Boot lid","boot"],["grille","Front grille","bumper"],["rear-bumper","Rear bumper","bumper"]
 ]],
 ["Glass and lights",[
  ["windscreen","Front windscreen","glass"],["rear-glass","Rear windscreen","rearglass"],["l-headlight","Left headlight","headlight"],["r-headlight","Right headlight","headlight",1],
  ["l-taillight","Left tail light","taillight"],["r-taillight","Right tail light","taillight",1],["l-mirror","Left mirror","mirror"],["r-mirror","Right mirror","mirror",1]
 ]],
 ["Wheels",[
  ["wheel-lf","Left front wheel","wheel"],["wheel-rf","Right front wheel","wheel"],["wheel-lr","Left rear wheel","wheel"],["wheel-rr","Right rear wheel","wheel"]
 ]],
 ["Interior",[
  ["seats","Seats","seat"],["dashboard","Dashboard","speedo"],["steering","Steering wheel","steer"],["seatbelts","Seat belts","belt"]
 ]],
 ["Under the bonnet and chassis",[
  ["engine","Engine","engine"],["radiator","Radiator","radiator"],["brakes","Brakes","brake"],["exhaust","Exhaust","exhaust"]
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
 const parts=CONDITION_GROUPS.flatMap(([,items])=>items.map(([key,name])=>({key,name})));
 mountVehicleInspectionDiagram($("inspection-grid"),{
  parts,getReport:()=>report,interactive:editable,
  onSelect:key=>{
   if(!editable)return;
   const part=parts.find(item=>item.key===key);
   if(!part)return;
   openVehiclePartEditor({part,entry:report.parts[key],onSave:entry=>{
    report.parts[key]={...entry,dmg:Array.isArray(entry.dmg)?entry.dmg:[]};
    renderDamage();renderInspectionSummary();persistInspectionLocally();if(record?.id)saveAreaMark(key).catch(error=>console.warn("Inspection mark will retry:",error));
   }});
  }
 });
}
function persistInspectionLocally(){
 try{localStorage.setItem("centric-inspection-draft-"+(record?.id||"new"),JSON.stringify({report,updated_at:new Date().toISOString()}));$("inspection-save-state").textContent="Saved on this device";}
 catch{$("inspection-save-state").textContent="Couldn't save this draft on this device";}
}
async function saveAreaMark(area){
 if(!record?.id||!editable)return;
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
 $("delete-checklist").hidden=!record||Boolean(record.voided_at);
 $("void-checklist").hidden=!record||Boolean(record.voided_at);
 $("confirm-check").checked=false;
 $("save-checklist").disabled=editable;
 $("confirm-label").classList.toggle("hidden",!editable);
 if(editable)applyNoDamageDefaults();
 renderDamage();renderInspectionSummary();syncInspectionStrip();
}
function startNewChecklist(prefillJob=null){
 record=null;report={parts:{},notes:""};try{const local=JSON.parse(localStorage.getItem("centric-inspection-draft-new")||"null");if(local?.report)report=local.report;}catch{}selectedJob=prefillJob;
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
}
function renderChecklistList(rows){
 $("checklist-list").innerHTML=rows.length?rows.map(item=>{
  const customer=item.customer_name||item.customers?.full_name||"Customer not recorded";
  const vehicle=item.vehicle_registration||item.vehicles?.license_plate||"Registration not recorded";
  const linkedJob=item.repair_jobs?.cro_number||`JC-${String(item.repair_jobs?.job_number??"").padStart(5,"0")}`;
  const status=item.voided_at?`Voided ${new Date(item.voided_at).toLocaleString()} · ${item.void_reason||"No reason recorded"}`:item.job_id?`Linked to ${linkedJob}`:"Ready to link to a job card";
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
  report.parts[mark.area_code]={...(report.parts[mark.area_code]||{}),dmg:[mark.condition],note:mark.note||"",photo};
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
 $("detail-status").textContent=item.voided_at?`Voided ${new Date(item.voided_at).toLocaleString()}. ${item.void_reason||"No reason recorded"}`:item.confirmed_at?`Completed ${new Date(item.confirmed_at).toLocaleString()}. This inspection is read-only.`:"Complete the inspection when all drop-off details are ready.";
 $("save-checklist").textContent=item.confirmed_at?"Inspection completed":"Complete inspection";
 $("confirmed-notice").textContent=item.confirmed_at?`Checklist confirmed by ${item.checked_by||"staff"}.`:"";
 $("confirmed-notice").classList.toggle("hidden",!item.confirmed_at);
 $("voided-notice").textContent=item.voided_at?`Checklist voided ${new Date(item.voided_at).toLocaleString()} · ${item.void_reason||"No reason recorded"}`:"";
 $("voided-notice").classList.toggle("hidden",!item.voided_at);
 $("open-job").classList.toggle("hidden",!item.confirmed_at||Boolean(item.voided_at));
 $("open-job").textContent=item.job_id?"Open linked job card":"Create job card with checklist details";
 $("open-job").href=item.job_id
  ?`repairs.html?edit=${encodeURIComponent(item.job_id)}`
  :`repairs.html?checklist=${encodeURIComponent(item.id)}`;
 $("link-existing-fields").hidden=!item.confirmed_at||Boolean(item.job_id)||Boolean(item.voided_at);
 $("link-job").disabled=true;
 setEditable(!item.voided_at);
 $("reopen-inspection").hidden=true;
 if(item.status==="completed"||item.confirmed_at){const {data:u}=await supabase.auth.getUser();if(u?.user?.id){const {data:p}=await supabase.from("profiles").select("role").eq("id",u.user.id).maybeSingle();$("reopen-inspection").hidden=!["super_admin","superadmin"].includes(String(p?.role||"").toLowerCase());}}
 renderInspectionSummary();syncInspectionStrip();
 setDetailMessage("");
 if(item.confirmed_at&&!item.job_id&&!item.voided_at)await loadMatchingJobs(item);
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
  if(!payload.job_id)return setDetailMessage("Link this inspection to its job card before completing it.",true);
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
   let photo_path=null;
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

function printChecklist(){
 const printWindow=window.open("","_blank");
 if(!printWindow){setDetailMessage("Your browser blocked the print window. Allow pop-ups for this site and try again.",true);return}
 printWindow.addEventListener("load",()=>{printWindow.focus();printWindow.print()},{once:true});
 const parts=CONDITION_GROUPS.map(([group,items])=>`
  <section><h2>${esc(group)}</h2><table><tbody>${items.map(([key,name])=>{
   const marked=report.parts?.[key],damage=Array.isArray(marked?.dmg)?marked.dmg:[];
   const condition=damage.length?damage.join(", "):"No Damage";
   return `<tr><th>${esc(name)}</th><td>${esc(condition)}</td></tr>`;
  }).join("")}</tbody></table></section>`).join("");
 const checklistNumber=record?.checklist_number?`#${esc(record.checklist_number)}`:"Draft — not yet saved";
 const linkedJob=selectedJob?(selectedJob.cro_number||`JC-${String(selectedJob.job_number??"").padStart(5,"0")}`):"—";
 const confirmed=record?.voided_at?`Voided ${new Date(record.voided_at).toLocaleString()} · ${record.void_reason||"No reason recorded"}`:record?.confirmed_at?new Date(record.confirmed_at).toLocaleString():"Not confirmed";
 const note=String(report.notes||"").trim();
 const logo=new URL("../assets/logo.png",location.href).href;
 printWindow.document.write(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Vehicle checklist ${checklistNumber}</title>
 <style>
 *{box-sizing:border-box}body{max-width:190mm;margin:0 auto;padding:10mm;color:#18212b;font:13px/1.5 Arial,sans-serif}
 header{display:flex;align-items:center;gap:14px;padding-bottom:14px;border-bottom:2px solid #394554}
 header img{width:58px;height:58px;object-fit:contain}header h1{margin:0;font-size:21px}header p{margin:3px 0;color:#536273}
 .number{margin-left:auto;text-align:right;font-size:16px;font-weight:700}
 .summary{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 18px;margin:18px 0}
 .summary div{padding:8px 10px;border:1px solid #d2d9e2;border-radius:6px;break-inside:avoid}
 .summary b{display:block;color:#536273;font-size:10px;text-transform:uppercase;letter-spacing:.06em}
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
  <div><b>Customer</b>${esc($("customer-name-input").value.trim()||"—")}</div>
  <div><b>Vehicle registration</b>${esc($("vehicle-registration-input").value.trim().toUpperCase()||"—")}</div>
  <div><b>Checklist completed by</b>${esc($("checked-by-input").value.trim()||"—")}</div>
  <div><b>Job card</b>${esc(linkedJob)}</div>
  <div><b>Odometer at drop-off</b>${esc($("odometer").value||"—")} km</div>
  <div><b>Fuel at drop-off</b>${esc($("fuel").value||"—")}</div>
  <div><b>Checklist status</b>${esc(confirmed)}</div>
  <div><b>Printed</b>${esc(new Date().toLocaleString())}</div>
 </div>
 ${parts}
 ${note?`<div class="note"><b>Notes</b><br>${esc(note).replace(/\n/g,"<br>")}</div>`:""}
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
$("checklist-notes").addEventListener("input",event=>{report.notes=event.target.value});
$("confirm-check").onchange=event=>{$("save-checklist").disabled=!event.target.checked};
$("save-checklist").onclick=()=>{if(!validateInspection())return;if(!$("confirm-check").checked)return setDetailMessage("Confirm that the customer name and registration above are correct for this vehicle at drop-off.",true);saveAndConfirm()};
$("job-select").onchange=event=>{$("link-job").disabled=!event.target.value};
$("delete-checklist").onclick=()=>deleteChecklist(record?.id);
$("void-checklist").onclick=()=>voidChecklist(record?.id);
$("print-checklist").onclick=printChecklist;
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

