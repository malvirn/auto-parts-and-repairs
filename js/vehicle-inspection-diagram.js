const CONDITIONS=[
 {name:"Scratch",color:"#f59e0b"},{name:"Dent",color:"#ef4444"},{name:"Crack",color:"#a855f7"},
 {name:"Broken",color:"#64748b"},{name:"Missing",color:"#3b82f6"},{name:"Chip",color:"#8b5cf6"},
 {name:"Stretched",color:"#14b8a6"},{name:"Worn",color:"#a16207"},{name:"Flat",color:"#ec4899"},{name:"Bald",color:"#eab308"}
];
const ZONES={
 "front-bumper":[242,166,250,42],"bonnet":[260,42,214,112],"windscreen":[274,278,170,84],
 "roof":[278,375,165,190],"rear-glass":[278,575,165,80],"boot":[278,650,165,68],"rear-bumper":[240,755,255,45],
 "lf-wing":[28,240,135,115],"lf-door":[24,365,142,160],"lr-door":[24,525,142,130],"lr-quarter":[24,650,140,80],
 "rf-wing":[557,240,135,115],"rf-door":[554,365,142,160],"rr-door":[554,525,142,130],"rr-quarter":[556,650,140,80],
 "wheel-lf":[72,300,80,92],"wheel-lr":[72,590,80,92],"wheel-rf":[568,300,80,92],"wheel-rr":[568,590,80,92],
 "l-headlight":[244,120,52,38],"r-headlight":[438,120,52,38],"l-taillight":[248,780,58,36],"r-taillight":[430,780,58,36],
 "l-mirror":[238,280,42,45],"r-mirror":[440,280,42,45],"grille":[300,155,135,35],"boot-lid":[285,790,160,70],
 "dashboard":[300,405,130,35],"steering":[300,450,70,65],"seats":[320,520,90,85],"seatbelts":[285,515,30,85],
 "engine":[300,70,130,55],"radiator":[300,135,130,22],"brakes":[80,330,65,40],"exhaust":[300,705,130,25]
};
const esc=v=>String(v??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const isTyre=key=>key.startsWith("wheel-");
const isGlass=key=>["windscreen","rear-glass"].includes(key);
function conditionsFor(key){return ["Scratch","Dent","Crack","Broken","Missing",...(isTyre(key)?["Stretched","Worn","Flat","Bald"]:[]),...(isGlass(key)?["Chip"]:[])];}
function statusFor(entry){return entry?.dmg?.[0]||"No Damage";}
function tintFor(value){return CONDITIONS.find(x=>x.name===value)?.color||"#16a34a";}
function ensureStyles(){
 if(document.getElementById("vehicle-inspection-diagram-styles"))return;
 const style=document.createElement("style");style.id="vehicle-inspection-diagram-styles";
 style.textContent=`
 .vi-wrap{width:100%;min-width:0}.vi-legend{display:flex;flex-wrap:wrap;gap:8px 13px;margin:0 0 12px;color:var(--check-muted,#9ca8b7);font-size:.76rem}
 .vi-legend span{display:inline-flex;align-items:center;gap:6px}.vi-dot{width:10px;height:10px;border-radius:50%;display:inline-block}
 .vi-stage{position:relative;width:100%;max-width:780px;margin:0 auto;padding:6px;border:1px solid var(--check-border,#394554);border-radius:14px;background:#101820;overflow:hidden}
 .vi-stage svg{display:block;width:100%;height:auto}
 .vi-zone{cursor:pointer;outline:none}.vi-zone rect{fill:#16a34a;fill-opacity:.08;stroke:#16a34a;stroke-opacity:.45;stroke-width:2;vector-effect:non-scaling-stroke;transition:fill-opacity .15s,stroke-width .15s}
 .vi-zone.vi-marked rect{fill-opacity:.48;stroke-opacity:1;stroke-width:3}
 .vi-zone:focus rect,.vi-zone:hover rect{fill-opacity:.42;stroke:#fff;stroke-width:3}
 .vi-pin{fill:#fff;stroke:#111827;stroke-width:2;vector-effect:non-scaling-stroke}
 .vi-view-label{font:700 13px Arial,sans-serif;letter-spacing:1.1px;fill:#d8e1e9;paint-order:stroke;stroke:#111827;stroke-width:3px;stroke-linejoin:round}
 .vi-hotspot-hint{margin:9px 0 0;color:var(--check-muted,#9ca8b7);font-size:.8rem;text-align:center}
 .vi-summary{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
 .vi-count{padding:7px 10px;border:1px solid var(--check-border,#394554);border-radius:8px;font-size:.78rem;font-weight:700;color:var(--check-text,#e7edf3)}
 .vi-extra{display:flex;flex-wrap:wrap;gap:7px;margin-top:12px}
 .vi-extra button{min-height:42px;padding:8px 11px;border:1px solid var(--check-border,#394554);border-radius:9px;background:var(--check-card-2,#1c242e);color:var(--check-text,#edf1f7);font:inherit;font-size:.8rem;font-weight:700}
 .vi-extra button[data-marked=true]{border-color:#f59e0b;background:#4a3213}
 .vi-part-dialog{position:fixed;inset:0;z-index:99999;display:grid;place-items:end center;padding:12px;background:#000a}
 .vi-part-panel{width:min(100%,460px);max-height:90vh;overflow:auto;padding:18px;border:1px solid #44505d;border-radius:18px;background:#17212d;color:#f2f5f8;box-shadow:0 20px 60px #0008}
 .vi-part-panel h3{margin:0 0 4px;font-size:1.1rem}.vi-part-panel p{margin:0 0 14px;color:#aeb9c7;font-size:.84rem}
 .vi-options{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
 .vi-options button{min-height:44px;border:1px solid #465363;border-radius:9px;background:#202d3b;color:#f2f5f8;font:inherit;font-weight:700}
 .vi-options button[aria-pressed=true]{border-color:#24b66a;background:#12663b}
 .vi-options button[data-damage=Scratch][aria-pressed=true]{background:#80500a;border-color:#f59e0b}
 .vi-options button[data-damage=Dent][aria-pressed=true]{background:#842a2a;border-color:#ef4444}
 .vi-options button[data-damage=Crack][aria-pressed=true],.vi-options button[data-damage=Chip][aria-pressed=true]{background:#562c7d;border-color:#a855f7}
 .vi-part-panel label{display:grid;gap:6px;margin-top:12px;font-size:.82rem;font-weight:700}
 .vi-part-panel textarea,.vi-part-panel input[type=file]{width:100%;min-height:44px;padding:9px;border:1px solid #465363;border-radius:8px;background:#202d3b;color:#fff;font:inherit}
 .vi-part-photo{display:block;max-width:100%;max-height:190px;object-fit:contain;border-radius:8px;margin-top:8px}
 .vi-part-actions{display:flex;gap:8px;margin-top:14px}.vi-part-actions button{flex:1;min-height:44px;border:0;border-radius:9px;background:#18a65b;color:white;font:inherit;font-weight:800}.vi-part-actions .vi-cancel{background:#344252}
 @media(min-width:760px){.vi-part-dialog{place-items:center}.vi-stage{max-height:calc(100vh - 230px)}.vi-stage svg{max-height:690px}}
 @media(max-width:520px){.vi-stage{padding:2px}.vi-zone rect{stroke-width:3}.vi-legend{font-size:.7rem}.vi-part-panel{padding:15px}}
 `;
 document.head.append(style);
}
function svgZone(part,report,interactive){
 const rect=ZONES[part.key];if(!rect)return "";
 const entry=report?.parts?.[part.key],marked=Boolean(entry?.dmg?.length);
 const color=marked?tintFor(entry.dmg[0]):"#16a34a";
 const [x,y,w,h]=rect;
 return `<g class="vi-zone ${marked?"vi-marked":""}" data-part="${esc(part.key)}" ${interactive?'role="button" tabindex="0"':'aria-hidden="true"'} aria-label="${esc(part.name)}: ${esc(statusFor(entry))}">
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" style="fill:${color};stroke:${color}"></rect>
  ${marked?'<circle class="vi-pin" cx="'+(x+w-7)+'" cy="'+(y+7)+'" r="7"/>':""}
 </g>`;
}
function summaryMarkup(parts,report){
 const marked=parts.filter(p=>report?.parts?.[p.key]?.dmg?.length).length;
 return `<span class="vi-count">${marked} mark${marked===1?"":"s"}</span><span class="vi-count">${parts.length-marked} other areas: No Damage</span>`;
}
export function mountVehicleInspectionDiagram(el,{parts,getReport,onSelect,interactive=true}){
 if(!el)return;ensureStyles();const report=getReport?.()||{parts:{}};
 const mapped=parts.filter(p=>ZONES[p.key]);
 const extra=parts.filter(p=>!ZONES[p.key]);
 el.innerHTML=`<div class="vi-wrap">
  <div class="vi-legend"><span><i class="vi-dot" style="background:#16a34a"></i>No Damage</span><span><i class="vi-dot" style="background:#f59e0b"></i>Scratch</span><span><i class="vi-dot" style="background:#ef4444"></i>Dent</span><span><i class="vi-dot" style="background:#a855f7"></i>Crack / Chip</span><span><i class="vi-dot" style="background:#64748b"></i>Broken</span></div>
  <div class="vi-stage"><svg viewBox="0 0 720 960" role="img" aria-label="Four-view vehicle inspection diagram">
   <image href="../img/vehicle-inspection.webp" x="0" y="0" width="720" height="960" preserveAspectRatio="none"/>
   <text class="vi-view-label" x="360" y="20" text-anchor="middle">FRONT</text>
   <text class="vi-view-label" x="360" y="950" text-anchor="middle">REAR</text>
   <text class="vi-view-label" x="90" y="215" text-anchor="middle">LEFT SIDE</text>
   <text class="vi-view-label" x="630" y="215" text-anchor="middle">RIGHT SIDE</text>
   ${mapped.map(p=>svgZone(p,report,interactive)).join("")}
  </svg></div>
  <p class="vi-hotspot-hint">${interactive?"Tap a vehicle area to record damage. Unmarked areas remain No Damage.":"Vehicle condition markings recorded at drop-off."}</p>
  ${extra.length?'<div class="vi-extra"><strong style="width:100%">Interior and mechanical checks</strong>'+extra.map(p=>'<button type="button" data-extra-part="'+esc(p.key)+'" data-marked="'+Boolean(report.parts?.[p.key]?.dmg?.length)+'">'+esc(p.name)+(report.parts?.[p.key]?.dmg?.length?' · '+esc(report.parts[p.key].dmg[0]):'')+'</button>').join("")+'</div>':""}
  <div class="vi-summary">${summaryMarkup(parts,report)}</div>
 </div>`;
 if(interactive){
  el.onclick=event=>{const zone=event.target.closest("[data-part]");const extraButton=event.target.closest("[data-extra-part]");const key=zone?.dataset.part||extraButton?.dataset.extraPart;if(key)onSelect?.(key)};
  el.onkeydown=event=>{if((event.key==="Enter"||event.key===" ")&&event.target.matches("[data-part]")){event.preventDefault();onSelect?.(event.target.dataset.part)}};
 }
}
export function vehicleDiagramSnapshot(parts,report){
 ensureStyles();const mapped=parts.filter(p=>ZONES[p.key]);
 return `<div class="vi-wrap vi-print"><div class="vi-stage"><svg viewBox="0 0 720 960" role="img" aria-label="Vehicle inspection diagram">
 <image href="../img/vehicle-inspection.webp" x="0" y="0" width="720" height="960"/>
 ${mapped.map(p=>svgZone(p,report,false)).join("")}</svg></div></div>`;
}
export function openVehiclePartEditor({part,entry,onSave,readOnly=false}){
 ensureStyles();const key=part.key,choices=conditionsFor(key);
 const draft={dmg:[...(entry?.dmg||[])],photo:entry?.photo||"",note:entry?.note||""};
 const overlay=document.createElement("div");overlay.className="vi-part-dialog";
 const render=()=>{const selected=draft.dmg[0]||"";
 overlay.innerHTML=`<section class="vi-part-panel" role="dialog" aria-modal="true" aria-label="${esc(part.name)} condition">
 <h3>${esc(part.name)}</h3><p>Choose the condition. Leave it on No Damage if the area is clear.</p>
 <div class="vi-options"><button type="button" data-none aria-pressed="${!selected}" ${readOnly?"disabled":""}>No Damage</button>${choices.map(type=>`<button type="button" data-damage="${type}" aria-pressed="${selected===type}" ${readOnly?"disabled":""}>${type}</button>`).join("")}</div>
 <label>Notes (optional)<textarea data-note rows="2" maxlength="500" ${readOnly?"disabled":""} placeholder="Describe the damage">${esc(draft.note)}</textarea></label>
 <label>Photo (optional)<input type="file" accept="image/*" data-photo ${readOnly?"disabled":""}></label>
 ${draft.photo?`<img class="vi-part-photo" src="${draft.photo}" alt="Photo of ${esc(part.name)}"><button type="button" class="vi-cancel" data-remove-photo ${readOnly?"disabled":""}>Remove photo</button>`:""}
 <div class="vi-part-actions"><button type="button" class="vi-cancel" data-reset ${readOnly?"disabled":""}>Reset area</button><button type="button" class="vi-cancel" data-close>Cancel</button><button type="button" data-save ${readOnly?"disabled":""}>Save Mark</button></div></section>`;
 };
 const close=()=>{overlay.remove();document.removeEventListener("keydown",keyHandler)};
 const keyHandler=e=>{if(e.key==="Escape")close()};
 overlay.addEventListener("click",e=>{
  if(e.target===overlay||e.target.closest("[data-close]")){close();return}
  if(e.target.closest("[data-none]")){draft.dmg=[];render();return}
  const damage=e.target.closest("[data-damage]");if(damage){draft.dmg=[damage.dataset.damage];render();return}
  if(e.target.closest("[data-remove-photo]")){draft.photo="";render();return}
  if(e.target.closest("[data-reset]")){if(!window.confirm("Clear the condition, notes and photo for this area?"))return;draft.dmg=[];draft.note="";draft.photo="";render();return}
  if(e.target.closest("[data-save]")){onSave?.({...entry,...draft,dmg:draft.dmg});close()}
 });
 overlay.addEventListener("input",e=>{if(e.target.matches("[data-note]"))draft.note=e.target.value});
 overlay.addEventListener("change",e=>{
  const file=e.target.closest("[data-photo]")?.files?.[0];if(!file)return;
  if(file.size>20*1024*1024){alert("Choose a photo smaller than 20 MB.");return}
  const url=URL.createObjectURL(file),img=new Image();
  img.onload=()=>{const scale=Math.min(1,1280/Math.max(img.width,img.height)),canvas=document.createElement("canvas");canvas.width=Math.round(img.width*scale);canvas.height=Math.round(img.height*scale);canvas.getContext("2d").drawImage(img,0,0,canvas.width,canvas.height);draft.photo=canvas.toDataURL("image/jpeg",.8);URL.revokeObjectURL(url);render()};
  img.onerror=()=>{URL.revokeObjectURL(url);alert("Couldn't read that photo.")};img.src=url;
 });
 document.addEventListener("keydown",keyHandler);document.body.append(overlay);render();
}
