// public/sw.js - Service Worker for Kathmandu Valley Offline Map

const CACHE_NAME = "kathmandu-map-tiles-v1";

// Kathmandu Valley bounding box (example: zoom 14-17)
const KATHMANDU_BOUNDS = {
  zMin: 14,
  zMax: 17,
  xMin: 8850,
  xMax: 8870,
  yMin: 11460,
  yMax: 11480,
};

// Helper: check if a tile is within Kathmandu Valley
function isKathmanduTile(url) {
  try {
    const parts = url.split("/");
    const z = parseInt(parts[parts.length - 3]);
    const x = parseInt(parts[parts.length - 2]);
    const y = parseInt(parts[parts.length - 1].split(".")[0]);

    return (
      z >= KATHMANDU_BOUNDS.zMin &&
      z <= KATHMANDU_BOUNDS.zMax &&
      x >= KATHMANDU_BOUNDS.xMin &&
      x <= KATHMANDU_BOUNDS.xMax &&
      y >= KATHMANDU_BOUNDS.yMin &&
      y <= KATHMANDU_BOUNDS.yMax
    );
  } catch {
    return false;
  }
}

// Install - skip waiting
self.addEventListener("install", (event) => {
  console.log("Service Worker installing...");
  self.skipWaiting();
});

// Activate - claim clients
self.addEventListener("activate", (event) => {
  console.log("Service Worker activated");
  event.waitUntil(self.clients.claim());
});

// Fetch - cache tiles dynamically
self.addEventListener("fetch", (event) => {
  const url = event.request.url;

  if (isKathmanduTile(url)) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cachedResponse = await cache.match(event.request);
        if (cachedResponse) {
          // Serve from cache
          return cachedResponse;
        } else {
          // Fetch and cache
          try {
            const response = await fetch(event.request);
            if (response && response.status === 200) {
              cache.put(event.request, response.clone());
            }
            return response;
          } catch (err) {
            console.error("Tile fetch failed:", err);
            return new Response(null, { status: 504 });
          }
        }
      })
    );
  }
});
