"use client";

import React, { useEffect, useRef, useState } from "react";
import { onValue, ref as dbRef, set, get } from "firebase/database";
import { realtimeDb, auth } from "../lib/firebase";

const DEFAULT_MARKER = "/images/navPointLogo.png";
const MARKER_SIZE = 55;
const BORDER_WIDTH = "3px";
const HIGHLIGHT_COLOR = "#10B981";

const CENTER = { lat: 27.7172, lng: 85.324 };
const MAX_RADIUS = 10000;

const getBorderColor = (type) => {
  if (!type) return "black";
  const map = { demo: "red", event: "red", sponsor: "blue", special: "white", challenge: "orange" };
  return map[type.toLowerCase().trim()] || "black";
};

const getDistance = (lat1, lng1, lat2, lng2) => {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

export default function FastMapComponent({ qrList, scannedQRIds }) {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markerRefs = useRef({});
  const resizeObserverRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);
  const [userLocation, setUserLocation] = useState(null);
  const [selectedQR, setSelectedQR] = useState(null);

  const PLAYER_MARKER_SIZE = 50;
  const PLAYER_MARKER_ICON = "/images/playerlocation.png";
  const playerMarkerRef = useRef(null);

  // --- Relocate to user button ---
  const relocateToUser = () => {
    if (!mapInstanceRef.current || !userLocation) return;
    const map = mapInstanceRef.current.map;

    map.flyTo({
      center: [userLocation.lng, userLocation.lat],
      zoom: 16,
      speed: 0.8,
    });
  };

  // --- Update player marker ---
  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current || !userLocation) return;
    const map = mapInstanceRef.current.map;

    if (!playerMarkerRef.current) {
      playerMarkerRef.current = mapInstanceRef.current.displayPinMarker({
        latLng: [userLocation.lat, userLocation.lng],
      });

      const check = setInterval(() => {
        const el = playerMarkerRef.current.getElement();
        if (el) {
          clearInterval(check);
          Object.assign(el.style, {
            backgroundImage: `url("${PLAYER_MARKER_ICON}")`,
            backgroundSize: "contain",
            backgroundRepeat: "no-repeat",
            backgroundPosition: "center",
            width: `${PLAYER_MARKER_SIZE}px`,
            height: `${PLAYER_MARKER_SIZE}px`,
            transform: "translate(-50%, -50%)",
            cursor: "default",
            pointerEvents: "none",
          });
          el.innerHTML = "";
        }
      }, 50);
    } else {
      playerMarkerRef.current.setLngLat([userLocation.lng, userLocation.lat]);
    }
    map.setCenter([userLocation.lng, userLocation.lat]);
  }, [mapReady, userLocation]);

  // --- Get user location ---
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

  // --- Go to last QR button ---
  const goToLastQR = () => {
    if (!mapInstanceRef.current || !qrList?.length) return;

    const activeQRs = qrList.filter(qr => qr.status === "Active");
    if (!activeQRs.length) return;

    const lastQR = activeQRs[activeQRs.length - 1];
    const lat = parseFloat(lastQR.latitude);
    const lng = parseFloat(lastQR.longitude);
    if (isNaN(lat) || isNaN(lng)) return;

    mapInstanceRef.current.map.flyTo({
      center: [lng, lat],
      zoom: 16,
      speed: 0.8,
    });
  };

  // --- Save player coordinates to Firebase ---
  useEffect(() => {
    if (!userLocation) return;

    const savePlayerNav = async () => {
      try {
        const user = auth.currentUser;
        if (!user) return;

        const userSnap = await get(dbRef(realtimeDb, `Users/${user.uid}`));
        const username = userSnap.exists() ? (userSnap.val().username || "guest") : "guest";

        const now = new Date();
        await set(dbRef(realtimeDb, `playernav/${user.uid}`), {
          username,
          latitude: userLocation.lat,
          longitude: userLocation.lng,
          datetime: now.toLocaleString(),
        });
      } catch { }
    };

    savePlayerNav();
    const intervalId = setInterval(savePlayerNav, 5000);
    return () => clearInterval(intervalId);
  }, [userLocation]);

  // --- Initialize map ---
  useEffect(() => {
    if (!userLocation || mapInstanceRef.current) return;

    const initMap = async () => {
      if (!window.GalliMapPlugin) {
        const script = document.createElement("script");
        script.src = "https://gallimap.com/static/dist/js/gallimaps.vector.min.latest.js";
        script.async = true;
        document.head.appendChild(script);
        await new Promise(resolve => { script.onload = resolve; });
      }

      if (!window.GalliMapPlugin) return;

      const panoDiv = document.createElement("div");
      panoDiv.id = "hidden-pano";
      panoDiv.style.cssText = "position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;";
      document.body.appendChild(panoDiv);

      const config = {
        accessToken: "d141e786-97e5-48e7-89e0-7f87e7ed20dd",
        map: {
          container: "galli-map",
          style: "https://map-init.gallimap.com/styles/light/style.json",
          center: [userLocation.lng, userLocation.lat],
          zoom: 16,
          minZoom: 14,
          maxZoom: 21,
        },
        pano: { container: "hidden-pano" },
        controls: { geolocate: false },
      };

      try {
        mapInstanceRef.current = new window.GalliMapPlugin(config);
        const map = mapInstanceRef.current.map;

        // Constrain map to MAX_RADIUS
        map.on("move", () => {
          const c = map.getCenter();
          const dist = getDistance(CENTER.lat, CENTER.lng, c.lat, c.lng);
          if (dist > MAX_RADIUS) {
            const angle = Math.atan2(c.lat - CENTER.lat, c.lng - CENTER.lng);
            const newLat = CENTER.lat + (MAX_RADIUS / 111111) * Math.sin(angle);
            const newLng = CENTER.lng + (MAX_RADIUS / 111111) * Math.cos(angle);
            map.setCenter([newLng, newLat]);
          }
        });

        map.on("load", () => {
          setMapReady(true);
          // Hide unnecessary buttons
          setTimeout(() => {
            document.querySelectorAll('button[title*="360"], button[title*="Location"]').forEach(b => b.style.display = "none");
          }, 600);
        });

        resizeObserverRef.current = new ResizeObserver(() => map.resize());
        resizeObserverRef.current.observe(mapContainerRef.current);

      } catch { }
    };

    initMap();

    return () => {
      resizeObserverRef.current?.disconnect();
      document.getElementById("hidden-pano")?.remove();
      mapInstanceRef.current?.map?.remove();
      mapInstanceRef.current = null;
    };
  }, [userLocation]);

  // --- QR markers ---
  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current) return;
    const map = mapInstanceRef.current.map;
    const activeIds = new Set();

    qrList.forEach((qr) => {
      if (qr.status !== "Active") return;
      const id = qr.id;
      activeIds.add(id);

      const lat = parseFloat(qr.latitude);
      const lng = parseFloat(qr.longitude);
      if (isNaN(lat) || isNaN(lng)) return;

      const img = qr.picture?.trim() || DEFAULT_MARKER;
      const border = scannedQRIds.has(id) ? HIGHLIGHT_COLOR : getBorderColor(qr.type);

      if (!markerRefs.current[id]) {
        const marker = mapInstanceRef.current.displayPinMarker({ latLng: [lat, lng] });
        marker.setLngLat([lng, lat]);
        markerRefs.current[id] = marker;

        const check = setInterval(() => {
          const el = marker.getElement();
          if (el) {
            clearInterval(check);
            Object.assign(el.style, {
              backgroundImage: `url("${img}")`,
              backgroundSize: "cover",
              backgroundPosition: "center",
              width: `${MARKER_SIZE}px`,
              height: `${MARKER_SIZE}px`,
              borderRadius: "50%",
              border: `${BORDER_WIDTH} solid ${border}`,
              boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
              transform: "translate(-50%, -50%)",
              cursor: "pointer",
              pointerEvents: "auto",
            });
            el.innerHTML = "";
            el.onclick = () => {
              setSelectedQR({ ...qr, id });
              map.setCenter([lng, lat]);
            };
          }
        }, 50);

      } else {
        const el = markerRefs.current[id].getElement();
        if (el) el.style.border = `${BORDER_WIDTH} solid ${border}`;
      }
    });

    // Remove inactive markers
    Object.keys(markerRefs.current).forEach((id) => {
      if (!activeIds.has(id)) {
        markerRefs.current[id]?.remove?.();
        delete markerRefs.current[id];
      }
    });
  }, [qrList, scannedQRIds, mapReady]);

  return (
    <div ref={mapContainerRef} style={{ width: "100%", height: "100vh", position: "relative" }}>
      <div id="galli-map" style={{ width: "100%", height: "100%" }} />

      {/* Go to latest QR */}
      <button
        onClick={goToLastQR}
        style={{
          position: "absolute",
          bottom: "170px",
          right: "20px",
          zIndex: 1000,
          borderRadius: "50%",
          width: "50px",
          height: "50px",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          boxShadow: "0 4px 10px rgba(0,0,0,0.3)",
          border: "none",
          cursor: "pointer",
          backgroundColor: "white",
        }}
      >
        <img src="/images/map.png" style={{ width: "32px", height: "32px" }} />
      </button>

      {/* Relocate to player */}
      <button
        onClick={relocateToUser}
        style={{
          position: "absolute",
          bottom: "100px",
          right: "20px",
          zIndex: 1000,
          borderRadius: "50%",
          width: "50px",
          height: "50px",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          boxShadow: "0 4px 10px rgba(0,0,0,0.3)",
          border: "none",
          cursor: "pointer",
          backgroundColor: "white",
        }}
      >
        <img src="/images/playericon.png" style={{ width: "40px", height: "40px" }} />
      </button>

      {/* QR popup */}
      {selectedQR && (
        <>
          <div onClick={() => setSelectedQR(null)} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 999 }} />
          <div style={{
            position: "absolute",
            top: "50%", left: "50%",
            transform: "translate(-50%, -50%)",
            background: "white",
            borderRadius: "16px",
            padding: "24px",
            width: "90%",
            maxWidth: "400px",
            maxHeight: "80vh",
            overflowY: "auto",
            boxShadow: "0 10px 40px rgba(0,0,0,0.4)",
            zIndex: 1000,
          }}>
            {selectedQR.picture && <img src={selectedQR.picture} alt={selectedQR.name} style={{ width: "100%", height: "200px", objectFit: "cover", borderRadius: "12px", marginBottom: "16px" }} />}
            <h2 style={{ color: "black", margin: "0 0 8px", fontSize: "28px", fontWeight: "bold" }}>{selectedQR.name}</h2>
            <div className="flex justify-between mb-4 text-lg font-semibold">
              <span className={scannedQRIds.has(selectedQR.id) ? "text-green-500" : "text-black"}>
                Points: {selectedQR.points || 0} {scannedQRIds.has(selectedQR.id) && "(Scanned)"}
              </span>
              <span className="text-black">
                Reward: {selectedQR.reward || 0}
              </span>
            </div>

            <hr style={{ borderTop: "1px solid #e5e7eb", margin: "16px 0" }} />
            <p style={{ color: "black", margin: "0 0 24px", fontSize: "16px", lineHeight: "1.6" }}>
              {selectedQR.description || "No description available."}
            </p>
            <button
              onClick={() => setSelectedQR(null)}
              style={{ width: "100%", padding: "14px", backgroundColor: "#ef4444", color: "white", border: "none", borderRadius: "12px", fontSize: "18px", fontWeight: "bold" }}
              onMouseEnter={e => e.currentTarget.style.backgroundColor = "#dc2626"}
              onMouseLeave={e => e.currentTarget.style.backgroundColor = "#ef4444"}
            >
              Close
            </button>
          </div>
        </>
      )}
    </div>
  );
}
