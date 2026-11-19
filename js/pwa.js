// PWA install and update prompts.
(function () {
  var deferred=null, registrationRef=null, refreshRequested=false, promptEl=null;
  function standalone(){return window.matchMedia("(display-mode: standalone)").matches||window.navigator.standalone===true;}
  function refreshInstall(){var show=!!deferred&&!standalone();document.querySelectorAll("[data-install-app]").forEach(function(el){el.hidden=!show;});}
  function addSidebarButton(){
    var side=document.querySelector(".sidebar");if(!side||side.querySelector("[data-install-app]"))return;
    var a=document.createElement("a");a.href="#";a.className="nav-link nav-install";a.setAttribute("data-install-app","");a.hidden=true;
    a.innerHTML='<i data-lucide="download"></i> Install app';a.addEventListener("click",function(e){e.preventDefault();window.aprInstall();});side.appendChild(a);
    if(window.lucide)window.lucide.createIcons();
  }
  function showUpdatePrompt(){
    if(promptEl||!document.body)return;
    promptEl=document.createElement("aside");promptEl.setAttribute("role","status");
    promptEl.style.cssText="position:fixed;z-index:99999;left:50%;bottom:calc(22px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);display:flex;align-items:center;gap:12px;max-width:calc(100vw - 28px);padding:12px 14px;border:1px solid #3d5960;border-radius:12px;background:#17232b;color:#f4f7fa;box-shadow:0 12px 36px #0008;font:600 14px/1.3 Inter,system-ui,sans-serif";
    promptEl.innerHTML='<span>Update available</span><button type="button" style="border:0;border-radius:8px;padding:9px 13px;background:#19a65a;color:white;font:700 13px Inter,system-ui,sans-serif;cursor:pointer">Refresh</button><button type="button" aria-label="Dismiss update" style="border:0;background:transparent;color:#b9c5cf;font-size:20px;line-height:1;cursor:pointer">×</button>';
    var buttons=promptEl.querySelectorAll("button");
    buttons[0].addEventListener("click",function(){refreshRequested=true;if(registrationRef&&registrationRef.waiting)registrationRef.waiting.postMessage({type:"SKIP_WAITING"});else window.location.reload();});
    buttons[1].addEventListener("click",function(){promptEl.remove();promptEl=null;});
    document.body.appendChild(promptEl);
  }
  window.aprInstall=async function(){
    if(!deferred){alert('To install: open your browser menu and tap "Install app" or "Add to Home screen".');return;}
    deferred.prompt();try{await deferred.userChoice;}catch(e){}deferred=null;refreshInstall();
  };
  window.addEventListener("beforeinstallprompt",function(e){e.preventDefault();deferred=e;refreshInstall();});
  window.addEventListener("appinstalled",function(){deferred=null;refreshInstall();});
  if("serviceWorker"in navigator){
    window.addEventListener("load",function(){
      navigator.serviceWorker.register("/sw.js").then(function(registration){
        registrationRef=registration;
        if(registration.waiting&&navigator.serviceWorker.controller)showUpdatePrompt();
        registration.addEventListener("updatefound",function(){
          var worker=registration.installing;if(!worker)return;
          worker.addEventListener("statechange",function(){if(worker.state==="installed"&&navigator.serviceWorker.controller)showUpdatePrompt();});
        });
        registration.update().catch(function(){});
      }).catch(function(){});
      navigator.serviceWorker.addEventListener("controllerchange",function(){if(refreshRequested)window.location.reload();});
    });
  }
  document.addEventListener("DOMContentLoaded",function(){addSidebarButton();refreshInstall();});
})();