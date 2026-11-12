// Network-first app shell. New workers wait until the user taps Refresh.
const CACHE="apr-v67";
const SHELL=["/","/index.html","/login.html","/css/style.css","/css/mh-theme.css","/assets/logo.png","/img/vehicle-parts.webp","/pages/accounting.html","/pages/analytics.html","/pages/cashbook.html","/pages/checklist.html","/pages/commissions.html","/pages/customers.html","/pages/financial-statements.html","/pages/fixed-assets.html","/pages/landed-cost.html","/pages/ledger.html","/pages/payables.html","/pages/quotations.html","/pages/receipts.html","/pages/repairs.html","/pages/reset-password.html","/pages/settings.html","/pages/shop.html","/pages/suppliers.html","/pages/technicians.html","/js/connectionManager.js","/js/supabaseClient.js","/js/auth.js","/js/profile.js","/js/toast.js","/js/checklist.js","/js/vehicle-inspection-diagram.js","/icons/icon-192.png","/manifest.webmanifest"];
self.addEventListener("install",event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)));});
self.addEventListener("activate",event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));});
self.addEventListener("message",event=>{if(event.data&&event.data.type==="SKIP_WAITING")self.skipWaiting();});
self.addEventListener("fetch",event=>{
 const request=event.request;
 if(request.method!=="GET"||new URL(request.url).origin!==location.origin)return;
 event.respondWith(fetch(request).then(response=>{
  if(response.ok&&response.type==="basic"){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(request,copy));}
  return response;
 }).catch(()=>caches.match(request).then(cached=>cached||(request.mode==="navigate"?caches.match("/login.html"):Response.error()))));
});