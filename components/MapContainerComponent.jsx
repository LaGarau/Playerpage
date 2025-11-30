"use client";

import React, { useEffect, useRef, useState } from "react";
import { onValue, ref as dbRef, set, get } from "firebase/database";
import { realtimeDb, auth } from "../lib/firebase";

const DEFAULT_MARKER = "/images/navPointLogo.png";
const MARKER_SIZE = 55;
const BORDER_WIDTH = "3px";
const HIGHLIGHT_COLOR = "#10B981";

// Kathmandu Valley center for circular boundary
const CENTER = { lat: 27.7172, lng: 85.324 };
const MAX_RADIUS = 15000; // in meters

const getBorderColor = (type) => {
if (!type) return "black";
const typeLower = type.toLowerCase().trim();
const colorMap = {
demo: "red",
event: "pink",
sponsor: "blue",
special: "white",
limited: "green",
challenge: "orange",
};
return colorMap[typeLower] || "black";
};

// Haversine distance
const getDistance = (lat1, lng1, lat2, lng2) => {
const R = 6371000; // meters
const dLat = (lat2 - lat1) * Math.PI / 180;
const dLng = (lng2 - lng1) * Math.PI / 180;
const a =
Math.sin(dLat/2)**2 +
Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) * Math.sin(dLng/2)**2;
const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
return R * c;
};

export default function QRMapsPage() {
const galliMapInstance = useRef(null);
const markerRefs = useRef({});

const [userLocation, setUserLocation] = useState(null);
const [scannedQRs, setScannedQRs] = useState({});
const [selectedQR, setSelectedQR] = useState(null);
const [mapReady, setMapReady] = useState(false);
const [userId, setUserId] = useState(null);
const [username, setUsername] = useState("unknown");

// 1. Auth & Username
useEffect(() => {
const user = auth.currentUser;
if (user) setUserId(user.uid);
else {
const unsubscribe = auth.onAuthStateChanged((u) => {
if (u) setUserId(u.uid);
});
return () => unsubscribe();
}
}, []);

useEffect(() => {
if (!userId) return;
const fetchUsername = async () => {
try {
const userRef = dbRef(realtimeDb, `Users/${userId}`);
const snapshot = await get(userRef);
const name = snapshot.val()?.username || "unknown";
setUsername(name);
} catch (err) {
console.error("Failed to fetch username:", err);
}
};
fetchUsername();
}, [userId]);

// 2. User Location
useEffect(() => {
if (navigator.geolocation) {
navigator.geolocation.getCurrentPosition(
(pos) => setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
() => setUserLocation({ lat: CENTER.lat, lng: CENTER.lng })
);
} else {
setUserLocation({ lat: CENTER.lat, lng: CENTER.lng });
}
}, []);

// 3. playernav (every 5 sec)
useEffect(() => {
if (!userId || !userLocation || !username) return;


const updatePlayerLocation = () => {
  const playerNavRef = dbRef(realtimeDb, `playernav/${userId}`);
  const now = new Date();
  set(playerNavRef, {
    username,
    latitude: userLocation.lat,
    longitude: userLocation.lng,
    datetime: now.toLocaleString(),
  });
};

updatePlayerLocation();
const interval = setInterval(updatePlayerLocation, 5000);
return () => clearInterval(interval);


}, [userId, userLocation, username]);

// 4. Listen to scanned QRs
useEffect(() => {
if (!userId) return;
const statusRef = dbRef(realtimeDb, `scannedQRCodes/${userId}`);
const unsubscribe = onValue(statusRef, (snap) => {
setScannedQRs(snap.val() || {});
});
return () => {
try { unsubscribe(); } catch (e) {}
};
}, [userId]);

// 5. Map Init
useEffect(() => {
if (!userLocation) return;


window.gallimapsConfig = { accessToken: "d141e786-97e5-48e7-89e0-7f87e7ed20dd" };

const loadScript = () =>
  new Promise((resolve, reject) => {
    if (window.GalliMapPlugin) return resolve();
    const script = document.createElement("script");
    script.src = "https://gallimap.com/static/dist/js/gallimaps.vector.min.latest.js";
    script.async = true;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });

const initMap = async () => {
  try {
    await loadScript();
    if (!window.GalliMapPlugin) throw new Error("GalliMapPlugin not loaded");

    const config = {
      accessToken: "d141e786-97e5-48e7-89e0-7f87e7ed20dd",
      map: {
        container: "galli-map",
        style: "https://map-init.gallimap.com/styles/light/style.json",
        center: [userLocation.lng, userLocation.lat],
        zoom: 14,
        interactive: true,
        minZoom: 15,
        maxZoom: 20,
      },
      pano: { container: "hidden-pano" },
      controls: { geolocate: false },
    };

    galliMapInstance.current = new window.GalliMapPlugin(config);

    // Restrict panning within circular radius
    galliMapInstance.current.map.on("move", () => {
      const centerMap = galliMapInstance.current.map.getCenter();
      const dist = getDistance(CENTER.lat, CENTER.lng, centerMap[1], centerMap[0]);
      if (dist > MAX_RADIUS) {
        const angle = Math.atan2(centerMap[1] - CENTER.lat, centerMap[0] - CENTER.lng);
        const newLat = CENTER.lat + (MAX_RADIUS / 111111) * Math.sin(angle);
        const newLng = CENTER.lng + (MAX_RADIUS / 111111) * Math.cos(angle);
        galliMapInstance.current.map.setCenter([newLng, newLat]);
      }
    });

    galliMapInstance.current.map.on("load", () => {
      setMapReady(true);
      galliMapInstance.current.map.flyTo({ center: [userLocation.lng, userLocation.lat], zoom: 14 });
    });

    setTimeout(() => galliMapInstance.current?.map?.resize(), 100);
    setTimeout(() => {
      document.querySelectorAll('button[title*="360"], button[title*="Location"]').forEach((b) => (b.style.display = "none"));
    }, 600);
  } catch (err) {
    console.error("Map init failed:", err);
  }
};

initMap();
return () => { try { galliMapInstance.current?.map?.remove(); } catch (e) {} };


}, [userLocation]);

// 6. Markers
useEffect(() => {
if (!mapReady) return;


const qrRef = dbRef(realtimeDb, "QR-Data");
const unsubscribe = onValue(qrRef, (snapshot) => {
  if (!galliMapInstance.current) return;
  const data = snapshot.val() || {};
  const activeIds = new Set();

  Object.entries(data).forEach(([id, qr]) => {
    if (qr.status !== "Active") return;
    activeIds.add(id);
    const lat = parseFloat(qr.latitude);
    const lng = parseFloat(qr.longitude);
    if (isNaN(lat) || isNaN(lng)) return;

    const markerImageUrl = qr.picture?.trim() ? qr.picture : DEFAULT_MARKER;
    const borderColor = getBorderColor(qr.type);

    if (!markerRefs.current[id]) {
      const marker = galliMapInstance.current.displayPinMarker({ latLng: [lat, lng], color: "#2563EB" });
      markerRefs.current[id] = { marker, type: qr.type };

      const waiter = setInterval(() => {
        const el = marker.getElement?.();
        if (el) {
          clearInterval(waiter);
          el.style.backgroundImage = `url("${markerImageUrl}")`;
          el.style.backgroundSize = "cover";
          el.style.backgroundPosition = "center";
          el.style.width = `${MARKER_SIZE}px`;
          el.style.height = `${MARKER_SIZE}px`;
          el.style.borderRadius = "50%";
          el.style.border = `${BORDER_WIDTH} solid ${borderColor}`;
          el.style.boxShadow = "0 4px 12px rgba(0,0,0,0.3)";
          el.style.transform = "translate(-50%, -50%)";
          el.style.cursor = "pointer";
          el.innerHTML = "";
          el.onclick = () => {
            Object.keys(markerRefs.current).forEach((mid) => {
              const { marker: m, type } = markerRefs.current[mid];
              const el2 = m.getElement?.();
              if (el2) el2.style.border = `${BORDER_WIDTH} solid ${getBorderColor(type)}`;
            });
            el.style.border = `${BORDER_WIDTH} solid ${HIGHLIGHT_COLOR}`;
            galliMapInstance.current.map.flyTo({ center: [lng, lat], zoom: 17, duration: 1500 });
            setSelectedQR({ ...qr, id });
          };
        }
      }, 50);
    } else {
      const { marker } = markerRefs.current[id];
      markerRefs.current[id].type = qr.type;
      const el = marker.getElement?.();
      if (el) {
        el.style.backgroundImage = `url("${markerImageUrl}")`;
        el.style.border = `${BORDER_WIDTH} solid ${borderColor}`;
      }
    }
  });

  Object.keys(markerRefs.current).forEach((id) => {
    if (!activeIds.has(id)) {
      const { marker } = markerRefs.current[id];
      if (marker) {
        if (typeof marker.remove === "function") marker.remove();
        else if (typeof marker.removeMarker === "function") marker.removeMarker();
        else if (marker.getElement?.()?.parentNode) marker.getElement().parentNode.removeChild(marker.getElement());
      }
      delete markerRefs.current[id];
    }
  });
});

return () => { try { unsubscribe(); } catch (e) {} };


}, [mapReady]);

const closePopup = () => {
setSelectedQR(null);
Object.keys(markerRefs.current).forEach((id) => {
const { marker, type } = markerRefs.current[id];
const el = marker.getElement?.();
if (el) el.style.border = `${BORDER_WIDTH} solid ${getBorderColor(type)}`;
});
};

const isCurrentlyScanned = selectedQR
? Object.keys(scannedQRs).some((k) => k.split(",")[0] === selectedQR.name)
: false;

return (
<div style={{ width: "100%", height: "100vh", position: "relative" }}>
<div id="galli-map" style={{ width: "100%", height: "100%" }} />
<div id="hidden-pano" style={{ width: 1, height: 1, opacity: 0 }} />

  {selectedQR && (
    <>
      <div onClick={closePopup} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 999 }} />
      <div style={{
        position: "absolute",
        top: "50%", left: "50%",
        transform: "translate(-50%, -50%)",
        background: "white",
        borderRadius: "12px",
        padding: "24px",
        width: "90%",
        maxWidth: "400px",
        maxHeight: "80vh",
        overflowY: "auto",
        boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
        zIndex: 1000,
      }}>
        {selectedQR.picture && (
          <img src={selectedQR.picture || "/dummy.jpg"} alt={selectedQR.name}
            style={{ width: "100%", height: "200px", objectFit: "cover", borderRadius: "8px", marginBottom: "16px" }} />
        )}
        <h2 style={{ margin: "0 0 8px", fontSize: "24px", fontWeight: "bold", color: "black" }}>
          {selectedQR.name || "Unknown Location"}
        </h2>
        <p style={{ margin: "0 0 16px", fontSize: "18px", fontWeight: "600", color: "black" }}>
          Points: {selectedQR.points || 0} {isCurrentlyScanned && " (Already Scanned)"}
        </p>
        <hr style={{ border: "none", borderTop: "1px solid #e5e7eb", margin: "16px 0" }} />
        <p style={{ margin: "0 0 20px", fontSize: "16px", color: "black", lineHeight: "1.6" }}>
          {selectedQR.description || "No description available."}
        </p>
        <button onClick={closePopup}
          style={{ width: "100%", padding: "12px", backgroundColor: "Red", color: "white", border: "none", borderRadius: "8px", fontSize: "16px", fontWeight: "600", cursor: "pointer" }}
          onMouseEnter={(e) => (e.target.style.backgroundColor = "#ff5050")}
          onMouseLeave={(e) => (e.target.style.backgroundColor = "Red")}>
          Close
        </button>
      </div>
    </>
  )}
</div>


);
}
