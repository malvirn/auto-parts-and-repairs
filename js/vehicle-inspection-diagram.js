const DAMAGE_TYPES=["Dent","Scratch","Crack","Broken","Missing"];
const ZONES={
 "front-bumper":[430,230,140,34],"bonnet":[445,268,110,72],"windscreen":[440,342,120,42],"roof":[440,388,120,112],"rear-glass":[440,500,120,42],"boot":[445,542,110,55],"rear-bumper":[430,598,140,32],
 "lf-wing":[385,285,55,58],"rf-wing":[560,285,55,58],"lf-door":[382,365,55,80],"rf-door":[563,365,55,80],"lr-door":[382,455,55,78],"rr-door":[563,455,55,78],
 "l-mirror":[360,350,28,34],"r-mirror":[612,350,28,34],"l-headlight":[405,235,35,28],"r-headlight":[560,235,35,28],"l-taillight":[405,598,35,26],"r-taillight":[560,598,35,26],
 "wheel-lf":[365,300,34,58],"wheel-rf":[601,300,34,58],"wheel-lr":[365,535,34,58],"wheel-rr":[601,535,34,58],
 "dashboard":[455,390,90,24],"steering":[458,414,30,30],"seats":[485,440,55,48],"seatbelts":[445,438,28,55],
 "engine":[455,275,90,30],"radiator":[455,248,90,20],"brakes":[365,315,34,34],"exhaust":[485,605,30,20]
};
const esc=value=>String(value??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
function condition(entry){
 const dmg=Array.isArray(entry?.dmg)?entry.dmg:[];
 if(!entry)return "good";
 if(!dmg.length)return "good";
 if(dmg.every(type=>type==="Scratch"))return "scratch";
 return "damage";
}
function zoneMarkup(parts,report,interactive){
 return parts.map(p=>{
  const z=ZONES[p.key]||[470,650,60,24],state=condition(report?.parts?.[p.key]);
  return `<g class="vi-zone vi-${state}" data-part="${esc(p.key)}" ${interactive?'role="button" tabindex="0"':'aria-hidden="true"'} aria-label="${esc(p.name)}: ${state==="good"?"No damage":state==="uninspected"?"Not inspected":(report?.parts?.[p.key]?.dmg||[]).join(", ")}">
   <rect x="${z[0]}" y="${z[1]}" width="${z[2]}" height="${z[3]}" rx="9"></rect>
   <title>${esc(p.name)}</title>
  </g>`;
 }).join("");
}
function baseDrawing(){
 return `<g class="vi-car-lines">
  <path d="M500 210 C430 210 405 242 400 300 L382 355 L382 545 L400 600 C410 650 445 665 500 665 C555 665 590 650 600 600 L618 545 L618 355 L600 300 C595 242 570 210 500 210Z"/>
  <path d="M430 285 Q500 250 570 285 L560 345 Q500 360 440 345Z"/>
  <path d="M440 355 Q500 372 560 355 L560 390 L440 390Z"/>
  <path d="M440 395 L560 395 L560 505 L440 505Z"/>
  <path d="M440 510 Q500 525 560 510 L570 570 Q500 590 430 570Z"/>
  <path d="M410 360 L430 350 M590 350 L610 360 M410 540 L430 550 M590 550 L610 540"/>
  <path d="M420 300 Q500 280 580 300 M420 590 Q500 610 580 590"/>
  <path d="M390 370 L420 370 M580 370 L610 370 M390 450 L420 450 M580 450 L610 450"/>
  <path d="M455 400 Q500 385 545 400 M455 500 Q500 515 545 500"/>
  <rect x="360" y="300" width="32" height="72" rx="14"/><rect x="608" y="300" width="32" height="72" rx="14"/>
  <rect x="360" y="535" width="32" height="72" rx="14"/><rect x="608" y="535" width="32" height="72" rx="14"/>
  <path d="M455 218 Q500 195 545 218 M455 660 Q500 682 545 660"/>
  <path d="M440 270 L560 270 M440 600 L560 600"/>
  <path d="M465 420 L535 420 M465 470 L535 470"/>
  <path d="M475 430 Q500 420 525 430 L525 475 Q500 488 475 475Z"/>
  <path d="M485 405 Q500 398 515 405 M485 515 Q500 522 515 515"/>
 </g>`;
}
function ensureStyles(){
 if(document.getElementById("vehicle-inspection-diagram-styles"))return;
 const style=document.createElement("style");style.id="vehicle-inspection-diagram-styles";
 style.textContent=`
 .vi-wrap{width:100%;min-width:0}.vi-legend{display:flex;flex-wrap:wrap;gap:8px 14px;margin:0 0 12px;color:var(--text,var(--check-text,#dce5eb));font-size:.78rem}
 .vi-legend span{display:inline-flex;align-items:center;gap:6px}.vi-dot{width:10px;height:10px;border-radius:50%;display:inline-block}
 .vi-stage{position:relative;width:100%;max-width:780px;margin:0 auto;padding:8px;border:1px solid var(--line,#394554);border-radius:14px;background:#fff;overflow:hidden}
 .vi-stage svg{display:block;width:100%;height:auto;max-height:690px}
 .vi-car-lines{fill:none;stroke:#15191d;stroke-width:4;stroke-linecap:round;stroke-linejoin:round}
 .vi-zone rect{fill:#8994a5;fill-opacity:.22;stroke:#758092;stroke-width:2;stroke-dasharray:5 4;cursor:pointer;transition:fill-opacity .15s,stroke-width .15s}
 .vi-zone.vi-good rect{fill:#19a653;fill-opacity:.30;stroke:#138344;stroke-dasharray:none}
 .vi-zone.vi-scratch rect{fill:#f59e0b;fill-opacity:.48;stroke:#c47700;stroke-dasharray:none}
 .vi-zone.vi-damage rect{fill:#e33e38;fill-opacity:.45;stroke:#bd2828;stroke-dasharray:none}
 .vi-zone.vi-uninspected rect{fill:#8994a5;fill-opacity:.16;stroke:#758092}
 .vi-zone:focus rect,.vi-zone:hover rect{stroke:#111;stroke-width:4;fill-opacity:.68;outline:none}
 .vi-zone[role=button]{cursor:pointer}
 .vi-view-label{font:700 15px Arial,sans-serif;fill:#56606c;letter-spacing:1px}
 .vi-hotspot-hint{margin:9px 0 0;color:var(--muted,#9ca8b7);font-size:.8rem;text-align:center}
 .vi-summary{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
 .vi-count{padding:7px 10px;border:1px solid var(--line,#394554);border-radius:8px;font-size:.78rem;font-weight:700}
 .vi-part-dialog{position:fixed;inset:0;z-index:99999;display:grid;place-items:end center;padding:16px;background:#0009}
 .vi-part-panel{width:min(100%,440px);max-height:88vh;overflow:auto;padding:18px;border:1px solid #44505d;border-radius:18px;background:#17212d;color:#f2f5f8;box-shadow:0 20px 60px #0008}
 .vi-part-panel h3{margin:0 0 4px;font-size:1.1rem}.vi-part-panel p{margin:0 0 14px;color:#aeb9c7;font-size:.84rem}
 .vi-options{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
 .vi-options button{min-height:42px;border:1px solid #465363;border-radius:9px;background:#202d3b;color:#f2f5f8;font:inherit;font-weight:700}
 .vi-options button[aria-pressed=true]{border-color:#24b66a;background:#12663b}
 .vi-options button[data-damage=Scratch][aria-pressed=true]{border-color:#f59e0b;background:#80500a}
 .vi-options button[data-damage=Broken][aria-pressed=true],.vi-options button[data-damage=Dent][aria-pressed=true],.vi-options button[data-damage=Crack][aria-pressed=true],.vi-options button[data-damage=Missing][aria-pressed=true]{border-color:#f05a52;background:#842a2a}
 .vi-part-panel label{display:grid;gap:6px;margin-top:12px;font-size:.82rem;font-weight:700}
 .vi-part-panel input[type=file]{width:100%;padding:8px;border:1px solid #465363;border-radius:8px;color:#fff}
 .vi-part-photo{max-width:100%;max-height:160px;object-fit:contain;border-radius:8px;margin-top:8px}
 .vi-part-actions{display:flex;gap:8px;margin-top:14px}.vi-part-actions button{flex:1;min-height:42px;border:0;border-radius:9px;background:#18a65b;color:white;font:inherit;font-weight:800}.vi-part-actions .vi-cancel{background:#344252}
 @media(max-width:520px){.vi-stage{padding:3px}.vi-zone rect{stroke-width:3}.vi-legend{font-size:.72rem}.vi-part-panel{padding:15px}}
 `;
 document.head.append(style);
}
export function mountVehicleInspectionDiagram(el,{parts,getReport,onSelect,interactive=true}){
 if(!el)return;
 ensureStyles();
 const report=getReport?.()||{parts:{}};
 const markup=`<div class="vi-wrap">
  <div class="vi-legend"><span><i class="vi-dot" style="background:#19a653"></i>Good</span><span><i class="vi-dot" style="background:#f59e0b"></i>Scratched</span><span><i class="vi-dot" style="background:#e33e38"></i>Dented / broken</span><span><i class="vi-dot" style="background:#8994a5"></i>Not inspected</span></div>
  <div class="vi-stage"><svg viewBox="0 0 1000 800" role="img" aria-label="Vehicle inspection diagram with front at the top and rear at the bottom">
   <text class="vi-view-label" x="500" y="34" text-anchor="middle">FRONT</text>
   <path class="vi-car-lines" d="M420 60 Q500 38 580 60 L600 90 L590 160 Q500 180 410 160 L400 90Z M430 75 L570 75 L580 115 L420 115Z M420 135 L580 135"/>
   <text class="vi-view-label" x="500" y="770" text-anchor="middle">REAR</text>
   <path class="vi-car-lines" d="M420 690 Q500 668 580 690 L600 720 L590 750 Q500 770 410 750 L400 720Z M420 710 L580 710 L580 735 L420 735Z"/>
   <text class="vi-view-label" x="165" y="35" text-anchor="middle">LEFT SIDE</text>
   <path class="vi-car-lines" d="M120 75 Q150 55 180 75 L195 130 L195 650 L180 710 Q150 730 120 710 L105 650 L105 130Z M120 160 L180 160 L180 600 L120 600Z M120 360 L180 360 M120 410 L180 410"/>
   <circle class="vi-car-lines" cx="150" cy="190" r="28"/><circle class="vi-car-lines" cx="150" cy="590" r="28"/>
   <text class="vi-view-label" x="835" y="35" text-anchor="middle">RIGHT SIDE</text>
   <path class="vi-car-lines" d="M820 75 Q850 55 880 75 L895 130 L895 650 L880 710 Q850 730 820 710 L805 650 L805 130Z M820 160 L880 160 L880 600 L820 600Z M820 360 L880 360 M820 410 L880 410"/>
   <circle class="vi-car-lines" cx="850" cy="190" r="28"/><circle class="vi-car-lines" cx="850" cy="590" r="28"/>
   ${baseDrawing()}
   ${zoneMarkup(parts,report,interactive)}
  </svg></div>
  <p class="vi-hotspot-hint">${interactive?"Tap a highlighted vehicle area to record its condition.":"Vehicle condition markings recorded at drop-off."}</p>
  <div class="vi-summary">${summaryMarkup(parts,report)}</div>
 </div>`;
 el.innerHTML=markup;
 if(interactive){
  el.onclick=event=>{const zone=event.target.closest("[data-part]");if(zone)onSelect?.(zone.dataset.part)};
  el.onkeydown=event=>{if((event.key==="Enter"||event.key===" ")&&event.target.matches("[data-part]")){event.preventDefault();onSelect?.(event.target.dataset.part)}};
 }
}
function summaryMarkup(parts,report){
 const counts={good:0,scratch:0,damage:0,uninspected:0};
 parts.forEach(p=>counts[condition(report?.parts?.[p.key])]+=1);
 return `<span class="vi-count" style="color:#21b56b">Good ${counts.good}</span><span class="vi-count" style="color:#f5ad36">Scratched ${counts.scratch}</span><span class="vi-count" style="color:#f0645d">Damaged ${counts.damage}</span><span class="vi-count">Not inspected ${counts.uninspected}</span>`;
}
export function vehicleDiagramSnapshot(parts,report){
 ensureStyles();
 return `<div class="vi-wrap vi-print"><div class="vi-stage"><svg viewBox="0 0 1000 800" role="img" aria-label="Vehicle inspection diagram">
 <text class="vi-view-label" x="500" y="34" text-anchor="middle">FRONT</text><path class="vi-car-lines" d="M420 60 Q500 38 580 60 L600 90 L590 160 Q500 180 410 160 L400 90Z M430 75 L570 75 L580 115 L420 115Z M420 135 L580 135"/>
 <text class="vi-view-label" x="500" y="770" text-anchor="middle">REAR</text><path class="vi-car-lines" d="M420 690 Q500 668 580 690 L600 720 L590 750 Q500 770 410 750 L400 720Z M420 710 L580 710 L580 735 L420 735Z"/>
 <text class="vi-view-label" x="165" y="35" text-anchor="middle">LEFT SIDE</text><path class="vi-car-lines" d="M120 75 Q150 55 180 75 L195 130 L195 650 L180 710 Q150 730 120 710 L105 650 L105 130Z M120 160 L180 160 L180 600 L120 600Z M120 360 L180 360 M120 410 L180 410"/><circle class="vi-car-lines" cx="150" cy="190" r="28"/><circle class="vi-car-lines" cx="150" cy="590" r="28"/>
 <text class="vi-view-label" x="835" y="35" text-anchor="middle">RIGHT SIDE</text><path class="vi-car-lines" d="M820 75 Q850 55 880 75 L895 130 L895 650 L880 710 Q850 730 820 710 L805 650 L805 130Z M820 160 L880 160 L880 600 L820 600Z M820 360 L880 360 M820 410 L880 410"/><circle class="vi-car-lines" cx="850" cy="190" r="28"/><circle class="vi-car-lines" cx="850" cy="590" r="28"/>
 ${baseDrawing()}${zoneMarkup(parts,report,false)}</svg></div></div>`;
}
export function openVehiclePartEditor({part,entry,onSave,readOnly=false}){
 ensureStyles();
 const draft={dmg:[...(entry?.dmg||[])],photo:entry?.photo||"",note:entry?.note||""};
 const overlay=document.createElement("div");overlay.className="vi-part-dialog";
 const render=()=>{
  overlay.innerHTML=`<section class="vi-part-panel" role="dialog" aria-modal="true" aria-label="${esc(part.name)} condition">
   <h3>${esc(part.name)}</h3><p>Record the condition of this area at vehicle drop-off.</p>
   <div class="vi-options"><button type="button" data-none aria-pressed="${!draft.dmg.length}" ${readOnly?"disabled":""}>No damage</button>${DAMAGE_TYPES.map(type=>`<button type="button" data-damage="${type}" aria-pressed="${draft.dmg.includes(type)}" ${readOnly?"disabled":""}>${type}</button>`).join("")}</div>
   <label>Inspection note<textarea data-note rows="2" maxlength="500" ${readOnly?"disabled":""} placeholder="Optional details about this area">${esc(draft.note)}</textarea></label>
   <label>Damage photo (optional)<input type="file" accept="image/*" data-photo ${readOnly?"disabled":""}></label>
   ${draft.photo?`<img class="vi-part-photo" src="${draft.photo}" alt="Photo of ${esc(part.name)}"><button type="button" class="vi-cancel" data-remove-photo ${readOnly?"disabled":""}>Remove photo</button>`:""}
   <div class="vi-part-actions"><button type="button" class="vi-cancel" data-close>Cancel</button><button type="button" data-save ${readOnly?"disabled":""}>Save condition</button></div>
  </section>`;
 };
 const close=()=>{overlay.remove();document.removeEventListener("keydown",keyHandler)};
 const keyHandler=e=>{if(e.key==="Escape")close()};
 overlay.addEventListener("click",async e=>{
  if(e.target===overlay||e.target.closest("[data-close]")){close();return}
  if(e.target.closest("[data-none]")){draft.dmg=[];render();return}
  const damage=e.target.closest("[data-damage]");
  if(damage){const type=damage.dataset.damage;draft.dmg=draft.dmg.includes(type)?draft.dmg.filter(x=>x!==type):[...draft.dmg,type];render();return}
  if(e.target.closest("[data-remove-photo]")){draft.photo="";render();return}
  if(e.target.closest("[data-save]")){onSave?.({...entry,...draft,dmg:draft.dmg});close()}
 });
 overlay.addEventListener("change",async e=>{
  const file=e.target.closest("[data-photo]")?.files?.[0];if(!file)return;
  if(file.size>12*1024*1024){alert("Choose a photo smaller than 12 MB.");return}
  try{
   const url=URL.createObjectURL(file),img=new Image();
   img.onload=()=>{const scale=Math.min(1,720/Math.max(img.width,img.height)),canvas=document.createElement("canvas");canvas.width=Math.round(img.width*scale);canvas.height=Math.round(img.height*scale);canvas.getContext("2d").drawImage(img,0,0,canvas.width,canvas.height);draft.photo=canvas.toDataURL("image/jpeg",.68);URL.revokeObjectURL(url);render()};
   img.onerror=()=>{URL.revokeObjectURL(url);alert("Couldn't read that photo.")};img.src=url;
  }catch(error){alert(error.message||"Couldn't process that photo.")}
 });
 document.addEventListener("keydown",keyHandler);document.body.append(overlay);render();
}
