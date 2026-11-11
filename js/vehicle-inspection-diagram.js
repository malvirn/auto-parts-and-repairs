const CONDITIONS=[
 {name:"Scratch",label:"Scratched",color:"#f59e0b"},
 {name:"Crack",label:"Cracked",color:"#a855f7"},
 {name:"Missing",label:"Missing",color:"#3b82f6"},
 {name:"Broken",label:"Broken",color:"#64748b"},
 {name:"Dent",label:"Dent",color:"#ef4444"}
];
const PART_SPRITES={
 bonnet:[0,0,120,80],windscreen:[120,0,120,80],roof:[240,0,120,80],"rear-glass":[360,0,120,80],"boot":[480,0,120,80],"boot-lid":[480,0,120,80],
 "front-bumper":[0,80,120,80],"rear-bumper":[120,80,120,80],
 "l-headlight":[240,80,120,80],"r-headlight":[360,80,120,80],
 "l-taillight":[480,80,120,80],"r-taillight":[0,160,120,80],
 "lf-wing":[120,160,120,80],"rf-wing":[240,160,120,80],
 "lf-door":[360,160,120,80],"lr-door":[480,160,120,80],
 "rf-door":[0,240,120,80],"rr-door":[120,240,120,80],
 "l-mirror":[240,240,120,80],"r-mirror":[360,240,120,80],
 "wheel-lf":[480,240,120,80],"wheel-rf":[0,320,120,80],"wheel-lr":[120,320,120,80],"wheel-rr":[240,320,120,80],
 "l-fog-light":[240,80,120,80],"r-fog-light":[360,80,120,80],
 "front-plate-area":[480,0,120,80],"rear-plate-area":[480,0,120,80],
 "boot-spoiler":[480,0,120,80],"lr-quarter":[120,160,120,80],"rr-quarter":[240,160,120,80],
 "l-side-skirt":[0,80,120,80],"r-side-skirt":[120,80,120,80],"spare-wheel":[240,320,120,80]
};
const CONDITION_LABELS=Object.fromEntries(CONDITIONS.map(c=>[c.name,c.label]));
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function conditionFor(entry){return entry?.dmg?.[0]||"No Damage";}
function colorFor(condition){return CONDITIONS.find(c=>c.name===condition)?.color||"#20ad5a";}
function spriteStyle(key){
 const crop=PART_SPRITES[key];if(!crop)return "";
 const scale=Math.min(100/crop[2],66/crop[3]);
 return `background-size:${600*scale}px ${400*scale}px;background-position:${-crop[0]*scale}px ${-crop[1]*scale}px`;
}
function ensureStyles(){
 if(document.getElementById("vehicle-inspection-diagram-styles"))return;
 const style=document.createElement("style");style.id="vehicle-inspection-diagram-styles";
 style.textContent=`
 .vi-wrap{width:100%;min-width:0}
 .vi-legend{display:flex;flex-wrap:wrap;gap:8px 12px;margin:0 0 14px;color:var(--check-muted,#9ca8b7);font-size:.76rem}
 .vi-legend span{display:inline-flex;align-items:center;gap:6px}
 .vi-dot{width:10px;height:10px;border-radius:50%;display:inline-block}
 .vi-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(135px,1fr));gap:10px}
 .vi-part-card{position:relative;display:flex;flex-direction:column;align-items:center;gap:7px;min-width:0;padding:9px;border:2px solid var(--check-border,#394554);border-radius:11px;background:var(--check-card-2,#1c242e);color:var(--check-text,#edf1f7);text-align:center;cursor:pointer;transition:border-color .15s,background .15s,box-shadow .15s}
 .vi-part-card:focus-visible{outline:3px solid #fff;outline-offset:2px}
 .vi-part-card[disabled]{cursor:default}
 .vi-part-image{position:relative;display:block;width:100px;height:66px;flex:none;border-radius:7px;background-color:#0b1220;background-image:url("../img/vehicle-parts.webp");background-repeat:no-repeat;mix-blend-mode:screen;filter:drop-shadow(0 0 5px var(--part-color,#20ad5a))}
 .vi-part-image:after{content:"";position:absolute;inset:0;border-radius:7px;background:var(--part-color,#20ad5a);opacity:.25;mix-blend-mode:color}
 .vi-part-card[data-condition="No Damage"]{--part-color:#20ad5a}
 .vi-part-card[data-condition="Scratch"]{--part-color:#f59e0b;border-color:#f59e0b;background:color-mix(in srgb,#f59e0b 13%,var(--check-card-2,#1c242e))}
 .vi-part-card[data-condition="Crack"]{--part-color:#a855f7;border-color:#a855f7;background:color-mix(in srgb,#a855f7 13%,var(--check-card-2,#1c242e))}
 .vi-part-card[data-condition="Missing"]{--part-color:#3b82f6;border-color:#3b82f6;background:color-mix(in srgb,#3b82f6 13%,var(--check-card-2,#1c242e))}
 .vi-part-card[data-condition="Broken"]{--part-color:#94a3b8;border-color:#94a3b8;background:color-mix(in srgb,#64748b 18%,var(--check-card-2,#1c242e))}
 .vi-part-card[data-condition="Dent"]{--part-color:#ef4444;border-color:#ef4444;background:color-mix(in srgb,#ef4444 16%,var(--check-card-2,#1c242e))}
 .vi-part-name{font-size:.78rem;font-weight:800;line-height:1.25}
 .vi-part-condition{display:inline-flex;align-items:center;justify-content:center;min-height:25px;padding:4px 8px;border-radius:999px;background:var(--part-color,#20ad5a);color:#101820;font-size:.68rem;font-weight:900}
 .vi-no-sprite{display:grid;place-items:center;width:100px;height:66px;border-radius:7px;background:#0b1220;color:#9aa8b8;font-size:.65rem;font-weight:800}
 .vi-hotspot-hint{margin:10px 0 0;color:var(--check-muted,#9ca8b7);font-size:.8rem}
 .vi-summary{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
 .vi-count{padding:7px 10px;border:1px solid var(--check-border,#394554);border-radius:8px;font-size:.78rem;font-weight:700;color:var(--check-text,#e7edf3)}
 .vi-part-dialog{position:fixed;inset:0;z-index:99999;display:grid;place-items:end center;padding:12px;background:#000a}
 .vi-part-panel{width:min(100%,460px);max-height:90vh;overflow:auto;padding:18px;border:1px solid #44505d;border-radius:18px;background:#17212d;color:#f2f5f8;box-shadow:0 20px 60px #0008}
 .vi-part-panel h3{margin:0 0 4px;font-size:1.1rem}.vi-part-panel p{margin:0 0 14px;color:#aeb9c7;font-size:.84rem}
 .vi-options{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
 .vi-options button{min-height:44px;border:1px solid #465363;border-radius:9px;background:#202d3b;color:#f2f5f8;font:inherit;font-weight:700}
 .vi-options button[aria-pressed=true]{border-color:#24b66a;background:#12663b}
 .vi-options button[data-damage=Scratch][aria-pressed=true]{background:#80500a;border-color:#f59e0b}
 .vi-options button[data-damage=Dent][aria-pressed=true]{background:#842a2a;border-color:#ef4444}
 .vi-options button[data-damage=Missing][aria-pressed=true]{background:#173f78;border-color:#3b82f6}
 .vi-options button[data-damage=Broken][aria-pressed=true]{background:#39434f;border-color:#94a3b8}
 .vi-options button[data-damage=Crack][aria-pressed=true]{background:#562c7d;border-color:#a855f7}
 .vi-part-panel label{display:grid;gap:6px;margin-top:12px;font-size:.82rem;font-weight:700}
 .vi-part-panel textarea,.vi-part-panel input[type=file]{width:100%;min-height:44px;padding:9px;border:1px solid #465363;border-radius:8px;background:#202d3b;color:#fff;font:inherit}
 .vi-part-photo{display:block;max-width:100%;max-height:190px;object-fit:contain;border-radius:8px;margin-top:8px}
 .vi-part-actions{display:flex;gap:8px;margin-top:14px}.vi-part-actions button{flex:1;min-height:44px;border:0;border-radius:9px;background:#18a65b;color:white;font:inherit;font-weight:800}.vi-part-actions .vi-cancel{background:#344252}
 @media(min-width:760px){.vi-part-dialog{place-items:center}}
 @media(max-width:520px){.vi-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}.vi-part-card{padding:7px 4px}.vi-part-image,.vi-no-sprite{width:100px;height:66px;flex:none}}
 `;
 document.head.append(style);
}
function partCard(part,report,interactive){
 const entry=report?.parts?.[part.key]||{dmg:[]},condition=conditionFor(entry),sprite=PART_SPRITES[part.key];
 const visual=sprite?`<span class="vi-part-image" aria-hidden="true" style="${spriteStyle(part.key)}"></span>`:'<span class="vi-no-sprite" aria-hidden="true">PART VIEW</span>';
 return `<button type="button" class="vi-part-card" data-part="${esc(part.key)}" data-condition="${esc(condition)}" ${interactive?"":"disabled"} aria-label="${esc(part.name)}: ${esc(condition)}">
 ${visual}<span class="vi-part-name">${esc(part.name)}</span><span class="vi-part-condition">${esc(condition==="No Damage"?condition:CONDITION_LABELS[condition]||condition)}</span></button>`;
}
function summaryMarkup(parts,report){
 const marked=parts.filter(p=>report?.parts?.[p.key]?.dmg?.length).length;
 return `<span class="vi-count">${marked} damaged part${marked===1?"":"s"}</span><span class="vi-count">${parts.length-marked} parts: No Damage</span>`;
}
export function mountVehicleInspectionDiagram(el,{parts,getReport,onSelect,interactive=true}){
 if(!el)return;ensureStyles();const report=getReport?.()||{parts:{}};
 el.innerHTML=`<div class="vi-wrap">
 <div class="vi-legend"><span><i class="vi-dot" style="background:#20ad5a"></i>No Damage</span><span><i class="vi-dot" style="background:#f59e0b"></i>Scratched</span><span><i class="vi-dot" style="background:#a855f7"></i>Cracked</span><span><i class="vi-dot" style="background:#3b82f6"></i>Missing</span><span><i class="vi-dot" style="background:#64748b"></i>Broken</span><span><i class="vi-dot" style="background:#ef4444"></i>Dent</span></div>
 <div class="vi-grid">${parts.map(part=>partCard(part,report,interactive)).join("")}</div>
 <p class="vi-hotspot-hint">${interactive?"Select any silver vehicle part to change its condition. All parts start as No Damage.":"Vehicle part conditions recorded at drop-off."}</p>
 <div class="vi-summary">${summaryMarkup(parts,report)}</div></div>`;
 if(interactive)el.onclick=event=>{const card=event.target.closest("[data-part]");if(card)onSelect?.(card.dataset.part)};
}
export function vehicleDiagramSnapshot(parts,report){
 ensureStyles();return `<div class="vi-wrap"><div class="vi-grid">${parts.map(part=>partCard(part,report,false)).join("")}</div></div>`;
}
export function openVehiclePartEditor({part,entry,onSave,readOnly=false}){
 ensureStyles();const choices=CONDITIONS.map(c=>c.name);
 const draft={dmg:[...(entry?.dmg||[])],photo:entry?.photo||"",note:entry?.note||""};
 const overlay=document.createElement("div");overlay.className="vi-part-dialog";
 const render=()=>{const selected=draft.dmg[0]||"";
 overlay.innerHTML=`<section class="vi-part-panel" role="dialog" aria-modal="true" aria-label="${esc(part.name)} condition">
 <h3>${esc(part.name)}</h3><p>Choose the condition of this part.</p>
 <div class="vi-options"><button type="button" data-none aria-pressed="${!selected}" ${readOnly?"disabled":""}>No Damage</button>${choices.map(type=>`<button type="button" data-damage="${type}" aria-pressed="${selected===type}" ${readOnly?"disabled":""}>${CONDITION_LABELS[type]}</button>`).join("")}</div>
 <label>Notes (optional)<textarea data-note rows="2" maxlength="500" ${readOnly?"disabled":""} placeholder="Describe the damage">${esc(draft.note)}</textarea></label>
 <label>Photo (optional)<input type="file" accept="image/*" data-photo ${readOnly?"disabled":""}></label>
 ${draft.photo?`<img class="vi-part-photo" src="${draft.photo}" alt="Photo of ${esc(part.name)}"><button type="button" class="vi-cancel" data-remove-photo ${readOnly?"disabled":""}>Remove photo</button>`:""}
 <div class="vi-part-actions"><button type="button" class="vi-cancel" data-reset ${readOnly?"disabled":""}>Reset area</button><button type="button" class="vi-cancel" data-close>Cancel</button><button type="button" data-save ${readOnly?"disabled":""}>Save condition</button></div></section>`;};
 const close=()=>{overlay.remove();document.removeEventListener("keydown",keyHandler)};
 const keyHandler=e=>{if(e.key==="Escape")close()};
 overlay.addEventListener("click",e=>{
  if(e.target===overlay||e.target.closest("[data-close]")){close();return}
  if(e.target.closest("[data-none]")){draft.dmg=[];render();return}
  const damage=e.target.closest("[data-damage]");if(damage){draft.dmg=[damage.dataset.damage];render();return}
  if(e.target.closest("[data-remove-photo]")){draft.photo="";draft.photo_path=null;render();return}
  if(e.target.closest("[data-reset]")){if(!window.confirm("Clear the condition, notes and photo for this area?"))return;draft.dmg=[];draft.note="";draft.photo="";draft.photo_path=null;render();return}
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
