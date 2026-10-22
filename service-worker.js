const CACHE_NAME = "gestion-recogidas-v17";
const urlsToCache = [
    "./",  // Asegura que coincide con tu repositorio
    "index.html",
    "styles.css",
    "script.js?v=17",
    "manifest.json",
    // Iconos pendientes de diseño: se omiten para que cache.addAll no falle
    // en un perfil limpio. Volver a incluirlos cuando existan los PNG.
    // "icons/icon-192x192.png",
    // "icons/icon-512x512.png",
    "municipios.json", // Archivo de municipios
    "especies.json",
    "./vendor/sweetalert2.all.min.js"
];

// Instalar el Service Worker y cachear archivos
self.addEventListener("install", event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            console.log("Archivos cacheados correctamente");
            return cache.addAll(urlsToCache);
        })
    );
    // ✅ Activar inmediatamente sin esperar
    self.skipWaiting();
});

// Interceptar solicitudes y servir desde el caché si están disponibles
self.addEventListener("fetch", event => {
    event.respondWith(
        caches.match(event.request).then(response => {
            return response || fetch(event.request);
        })
    );
});

// Activar y limpiar cachés antiguas si es necesario
self.addEventListener("activate", event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.filter(cache => cache !== CACHE_NAME).map(cache => caches.delete(cache))
            );
        })
    );
    // ✅ Tomar el control de todos los clientes inmediatamente
    self.clients.claim();
});
