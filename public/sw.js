const CACHE = "recoverydesk-mobile-preview-12";
const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./pricing-engine.js",
  "./invoice-checkout.js",
  "./firebase.js",
  "./icons.js",
  "./documents.js",
  "./reminders.js",
  "./notifications.js",
  "./manifest.webmanifest",
  "./logo.png",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL.map(path => new Request(path, { cache: "reload" })))));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);

  if (url.origin !== location.origin) return;

  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(() => caches.match("./index.html")));
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached =>
      cached || fetch(event.request).then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(event.request, copy));
        }
        return response;
      })
    )
  );
});

self.addEventListener('push',event=>{
  let data={};try {data=event.data?.json() || {};}catch {}
  event.waitUntil(self.registration.showNotification('RecoveryDesk',{body:String(data.body || 'Open RecoveryDesk for an update.').slice(0,180),tag:String(data.tag || 'recoverydesk').slice(0,100),icon:new URL('./icon-192.png',self.registration.scope).href,data:{url:self.registration.scope}}));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async clients=>{
    const client=clients.find(c=>c.url.startsWith(self.registration.scope));
    if(client)return client.focus();
    return self.clients.openWindow(self.registration.scope);
  }));
});
