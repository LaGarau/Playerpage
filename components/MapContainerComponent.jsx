"use client";

import React, { useEffect, useRef, useState } from "react";
import { onValue, ref as dbRef, set, get } from "firebase/database";
import { realtimeDb, auth } from "../lib/firebase";

const DEFAULT_MARKER = "/images/navPointLogo.png";
const SCANNED_MARKER = "/images/qrpic.png";
const MARKER_SIZE = 55;
const BORDER_WIDTH = "3px";
const DEFAULT_BORDER_COLOR = "#ffffff";
const HIGHLIGHT_COLOR = "#10B981";

export default function QRMapsPage() {
  const galliMapInstance = useRef(null);
  const markerRefs = useRef({});
  const scannedQRsRef = useRef({});
  const [userLocation, setUserLocation] = useState(null);
  const [scannedQRs, setScannedQRs] = useState({});
  const [selectedQR, setSelectedQR] = useState(null);
  const [mapReady, setMapReady] = useState(false);
  const [userId, setUserId] = useState(null);
  const [username, setUsername] = useState("unknown"); // store username from Users table

  // Keep scannedQRsRef updated
  useEffect(() => {
    scannedQRsRef.current = scannedQRs || {};
  }, [scannedQRs]);

  // Get Firebase Auth user
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

  // Get user location
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => setUserLocation({ lat: 27.7172, lng: 85.324 })
      );
    } else {
      setUserLocation({ lat: 27.7172, lng: 85.324 });
    }
  }, []);

  // Fetch username from Users table
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

  // Background player location update every 5 seconds
  useEffect(() => {
    if (!userId || !userLocation) return;

    const updatePlayerLocation = () => {
      const playerNavRef = dbRef(realtimeDb, `playernav/${userId}`);
      const now = new Date();
      set(playerNavRef, {
        username, // use username from Users table
        latitude: userLocation.lat,
        longitude: userLocation.lng,
        datetime: now.toLocaleString(),
      });
    };

    updatePlayerLocation(); // initial update
    const interval = setInterval(updatePlayerLocation, 5000); // update every 5 sec
    return () => clearInterval(interval);
  }, [userId, userLocation, username]);

  // Listen for scanned QR updates (this user only)
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

  // Initialize GalliMap
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
            minZoom: 10,
            maxZoom: 20,
          },
          pano: { container: "hidden-pano" },
          controls: { geolocate: false },
        };

        galliMapInstance.current = new window.GalliMapPlugin(config);

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

    return () => {
      try { galliMapInstance.current?.map?.remove(); } catch (e) {}
    };
  }, [userLocation]);

  // Load & update markers
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

        const isScanned = Object.keys(scannedQRsRef.current).some(
          (k) => k.split(",")[0] === qr.name
        );
        const markerImg = isScanned ? SCANNED_MARKER : DEFAULT_MARKER;

        if (!markerRefs.current[id]) {
          const marker = galliMapInstance.current.displayPinMarker({ latLng: [lat, lng], color: "#2563EB" });
          markerRefs.current[id] = marker;

          const waiter = setInterval(() => {
            const el = marker.getElement?.();
            if (el) {
              clearInterval(waiter);
              el.style.backgroundImage = `url("${markerImg}")`;
              el.style.backgroundSize = "cover";
              el.style.backgroundPosition = "center";
              el.style.width = `${MARKER_SIZE}px`;
              el.style.height = `${MARKER_SIZE}px`;
              el.style.borderRadius = "50%";
              el.style.border = `${BORDER_WIDTH} solid ${isScanned ? HIGHLIGHT_COLOR : DEFAULT_BORDER_COLOR}`;
              el.style.boxShadow = "0 4px 12px rgba(0,0,0,0.3)";
              el.style.transform = "translate(-50%, -50%)";
              el.style.cursor = "pointer";
              el.innerHTML = "";

              el.onclick = () => {
                Object.keys(markerRefs.current).forEach((mid) => {
                  const mEl = markerRefs.current[mid]?.getElement?.();
                  if (mEl) {
                    const scanned = Object.keys(scannedQRsRef.current).some(
                      (k) => k.split(",")[0] === data[mid].name
                    );
                    mEl.style.border = `${BORDER_WIDTH} solid ${scanned ? HIGHLIGHT_COLOR : DEFAULT_BORDER_COLOR}`;
                  }
                });
                el.style.border = `${BORDER_WIDTH} solid ${HIGHLIGHT_COLOR}`;
                galliMapInstance.current.map.flyTo({ center: [lng, lat], zoom: 17, duration: 1500 });
                setSelectedQR({ ...qr, id });
              };
            }
          }, 50);
        } else {
          const el = markerRefs.current[id].getElement?.();
          if (el) {
            el.style.backgroundImage = `url("${markerImg}")`;
            el.style.border = `${BORDER_WIDTH} solid ${isScanned ? HIGHLIGHT_COLOR : DEFAULT_BORDER_COLOR}`;
          }
        }
      });

      Object.keys(markerRefs.current).forEach((id) => {
        if (!activeIds.has(id)) {
          const marker = markerRefs.current[id];
          if (marker) {
            if (typeof marker.remove === "function") marker.remove();
            else if (typeof marker.removeMarker === "function") marker.removeMarker();
            else if (marker.getElement?.()?.parentNode) marker.getElement().parentNode.removeChild(marker.getElement());
          }
          delete markerRefs.current[id];
        }
      });
    });

    return () => {
      try { unsubscribe(); } catch (e) {}
    };
  }, [mapReady, scannedQRs]);

  const closePopup = () => {
    setSelectedQR(null);
    Object.keys(markerRefs.current).forEach((id) => {
      const el = markerRefs.current[id]?.getElement?.();
      if (el) {
        const scanned = Object.keys(scannedQRsRef.current).some(
          (k) => k.split(",")[0] === id
        );
        el.style.border = `${BORDER_WIDTH} solid ${scanned ? HIGHLIGHT_COLOR : DEFAULT_BORDER_COLOR}`;
      }
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
          <div
            onClick={closePopup}
            style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 999 }}
          />
          <div
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
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
            }}
          >
            {selectedQR.picture && (
              <img
                src={selectedQR.picture || "/dummy.jpg"}
                alt={selectedQR.name}
                style={{ width: "100%", height: "200px", objectFit: "cover", borderRadius: "8px", marginBottom: "16px" }}
              />
            )}
            <h2 style={{ margin: "0 0 8px", fontSize: "24px", fontWeight: "bold" }}>
              {selectedQR.name || "Unknown Location"}
            </h2>
            <p style={{ margin: "0 0 16px", fontSize: "18px", fontWeight: "600", color: "#10B981" }}>
              Points: {selectedQR.points || 0} {isCurrentlyScanned && " (Already Scanned)"}
            </p>
            <hr style={{ border: "none", borderTop: "1px solid #e5e7eb", margin: "16px 0" }} />
            <p style={{ margin: "0 0 20px", fontSize: "14px", color: "#6b7280", lineHeight: "1.6" }}>
              {selectedQR.description || "No description available."}
            </p>
            <button
              onClick={closePopup}
              style={{ width: "100%", padding: "12px", backgroundColor: "#2563EB", color: "white", border: "none", borderRadius: "8px", fontSize: "16px", fontWeight: "600", cursor: "pointer" }}
              onMouseEnter={(e) => (e.target.style.backgroundColor = "#1d4ed8")}
              onMouseLeave={(e) => (e.target.style.backgroundColor = "#2563EB")}
            >
              Close
            </button>
          </div>
        </>
      )}
    </div>
  );
}
