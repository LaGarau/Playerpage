"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ref as dbRef, get, update, set } from "firebase/database";
import { realtimeDb, auth } from "../lib/firebase";

const DEFAULT_MARKER = "/images/navPointLogo.png";
const MARKER_SIZE = 55;
const BORDER_WIDTH = "3px";
const HIGHLIGHT_COLOR = "#10B981";

const getBorderColor = (type) => {
  if (!type) return "black";
  const map = {
    demo: "red",
    event: "red",
    sponsor: "blue",
    special: "white",
    challenge: "orange",
  };
  return map[type.toLowerCase().trim()] || "black";
};

const getDistance = (lat1: number, lng1: number, lat2: number, lng2: number) => {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

export default function FastMapComponent({
  qrList,
  scannedQRIds,
  scanning = false,
  scannedData = null,
  startScanner,
}: {
  qrList: any[];
  scannedQRIds: Set<string>;
  scanning?: boolean;
  scannedData?: any;
  startScanner: () => void;
}) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const markerRefs = useRef<Record<string, any>>({});
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const playerMarkerRef = useRef<any>(null);

  const [mapReady, setMapReady] = useState(false);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [selectedQR, setSelectedQR] = useState<any>(null);
  const [checkingReward, setCheckingReward] = useState(false);
  const [rewardPopup, setRewardPopup] = useState<any>(null);

  const PLAYER_MARKER_SIZE = 50;
  const PLAYER_MARKER_ICON = "/images/playerlocation.png";

  // Get & track user location (no blocking)
  useEffect(() => {
    if (!navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition(
      (pos) => setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => console.log("Location denied or unavailable"),
      { enableHighAccuracy: true, timeout: 10000 }
    );

    const watchId = navigator.geolocation.watchPosition(
      (pos) => setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { enableHighAccuracy: true }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  // Save player location to Firebase every 5s
  useEffect(() => {
    if (!userLocation) return;

    const saveLocation = async () => {
      try {
        const user = auth.currentUser;
        if (!user) return;

        const snap = await get(dbRef(realtimeDb, `Users/${user.uid}`));
        const username = snap.exists() ? snap.val().username || "guest" : "guest";

        await set(dbRef(realtimeDb, `playernav/${user.uid}`), {
          username,
          latitude: userLocation.lat,
          longitude: userLocation.lng,
          datetime: new Date().toLocaleString(),
        });
      } catch (err) {
        console.error("Failed to save location:", err);
      }
    };

    saveLocation();
    const interval = setInterval(saveLocation, 5000);
    return () => clearInterval(interval);
  }, [userLocation]);

  // Initialize GalliMaps
  useEffect(() => {
    if (mapInstanceRef.current) return;

    const initMap = async () => {
      if (!window.GalliMapPlugin) {
        const script = document.createElement("script");
        script.src = "https://gallimap.com/static/dist/js/gallimaps.vector.min.latest.js";
        script.async = true;
        document.head.appendChild(script);
        await new Promise((resolve) => (script.onload = resolve));
      }

      if (!window.GalliMapPlugin) return;

      const panoDiv = document.createElement("div");
      panoDiv.id = "hidden-pano";
      panoDiv.style.cssText = "position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;";
      document.body.appendChild(panoDiv);

      const center = userLocation
        ? [userLocation.lng, userLocation.lat]
        : [85.324, 27.7172];

      const config = {
        accessToken: "d141e786-97e5-48e7-89e0-7f87e7ed20dd",
        map: {
          container: "galli-map",
          style: "https://map-init.gallimap.com/styles/light/style.json",
          center,
          zoom: userLocation ? 18 : 15,
          minZoom: 14,
          maxZoom: 21,
        },
        pano: { container: "hidden-pano" },
        controls: { geolocate: false },
      };

      try {
        mapInstanceRef.current = new window.GalliMapPlugin(config);
        const map = mapInstanceRef.current.map;

        map.on("move", () => {
          const c = map.getCenter();
          const dist = getDistance(27.7172, 85.324, c.lat, c.lng);
          if (dist > 10000) {
            const angle = Math.atan2(c.lat - 27.7172, c.lng - 85.324);
            const newLat = 27.7172 + (10000 / 111111) * Math.sin(angle);
            const newLng = 85.324 + (10000 / 111111) * Math.cos(angle);
            map.setCenter([newLng, newLat]);
          }
        });

        map.on("load", () => {
          setMapReady(true);
          setTimeout(() => {
            document
              .querySelectorAll('button[title*="360"], button[title*="Location"]')
              .forEach((b: any) => (b.style.display = "none"));
          }, 600);
        });

        resizeObserverRef.current = new ResizeObserver(() => map.resize());
        resizeObserverRef.current.observe(mapContainerRef.current!);
      } catch (err) {
        console.error("Map failed to load:", err);
      }
    };

    initMap();

    return () => {
      resizeObserverRef.current?.disconnect();
      document.getElementById("hidden-pano")?.remove();
      mapInstanceRef.current?.map?.remove();
      mapInstanceRef.current = null;
    };
  }, [userLocation]);

  // Player marker on map
  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current || !userLocation) return;

    const mapPlugin = mapInstanceRef.current;

    if (!playerMarkerRef.current) {
      const el = document.createElement("div");
      Object.assign(el.style, {
        width: `${PLAYER_MARKER_SIZE}px`,
        height: `${PLAYER_MARKER_SIZE}px`,
        backgroundImage: `url(${PLAYER_MARKER_ICON})`,
        backgroundSize: "contain",
        backgroundRepeat: "no-repeat",
        backgroundPosition: "center",
        borderRadius: "50%",
        pointerEvents: "none",
        transform: "translate(-50%, -50%)",
      });

      playerMarkerRef.current = mapPlugin.displayPinMarker({
        latLng: [userLocation.lat, userLocation.lng],
        element: el,
      });
    } else {
      playerMarkerRef.current.setLngLat([userLocation.lng, userLocation.lat]);
    }
  }, [mapReady, userLocation]);

  // QR Markers
  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current) return;

    const activeIds = new Set<string>();

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

        const interval = setInterval(() => {
          const el = marker.getElement();
          if (el) {
            clearInterval(interval);
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
            el.onclick = () => {
              setSelectedQR({ ...qr, id });
              setRewardPopup(null);
              mapInstanceRef.current.map.flyTo({ center: [lng, lat], zoom: 18 });
            };
          }
        }, 50);
      } else {
        const el = markerRefs.current[id].getElement();
        if (el) el.style.border = `${BORDER_WIDTH} solid ${border}`;
      }
    });

    Object.keys(markerRefs.current).forEach((id) => {
      if (!activeIds.has(id)) {
        markerRefs.current[id]?.remove();
        delete markerRefs.current[id];
      }
    });
  }, [qrList, scannedQRIds, mapReady]);

  // Check Reward
  const checkReward = async (qrName: string) => {
    setCheckingReward(true);
    try {
      const user = auth.currentUser;
      if (!user) {
        setRewardPopup({ type: "error", message: "Please login to check rewards" });
        setCheckingReward(false);
        return;
      }

      const userProfileRef = dbRef(realtimeDb, `Users/${user.uid}`);
      const userProfileSnap = await get(userProfileRef);
      const username = userProfileSnap.exists()
        ? userProfileSnap.val().username
        : user.displayName || "guest";

      const notifRef = dbRef(realtimeDb, "notifications");
      const snapshot = await get(notifRef);

      if (snapshot.exists()) {
        const notifications = snapshot.val();
        let foundReward: any = null;
        let notifKey: string | null = null;

        Object.entries(notifications).forEach(([key, notif]: [string, any]) => {
          const match =
            notif.username?.trim().toLowerCase() === username.trim().toLowerCase() &&
            notif.qrName?.trim().toLowerCase() === qrName.trim().toLowerCase() &&
            notif.prizeCode?.trim();

          if (match && (!foundReward || !notif.claimed)) {
            foundReward = notif;
            notifKey = key;
          }
        });

        if (foundReward) {
          setRewardPopup({
            type: "success",
            message: foundReward.message || "Congratulations! You won a reward!",
            imgUrl: foundReward.imgUrl || "",
            prizeCode: foundReward.prizeCode,
            notificationKey: foundReward.claimed ? null : notifKey,
            alreadyClaimed: foundReward.claimed || false,
          });
        } else {
          setRewardPopup({
            type: "info",
            message: `No reward found for ${qrName}. Keep scanning!`,
          });
        }
      } else {
        setRewardPopup({ type: "info", message: "No rewards available yet." });
      }
    } catch (error) {
      setRewardPopup({ type: "error", message: "Error checking reward." });
    } finally {
      setCheckingReward(false);
    }
  };

  const closeRewardPopup = async () => {
    if (rewardPopup?.notificationKey && !rewardPopup?.alreadyClaimed) {
      try {
        await update(dbRef(realtimeDb, `notifications/${rewardPopup.notificationKey}`), {
          claimed: true,
          claimedAt: Date.now(),
        });
      } catch (err) {
        console.error("Failed to mark claimed:", err);
      }
    }
    setRewardPopup(null);
  };

  const relocateToUser = () => {
    if (!mapInstanceRef.current || !userLocation) return;
    mapInstanceRef.current.map.flyTo({
      center: [userLocation.lng, userLocation.lat],
      zoom: 18,
      speed: 0.8,
    });
  };

  const goToLastQR = () => {
    if (!qrList?.length || !mapInstanceRef.current) return;
    const active = qrList.filter((q) => q.status === "Active").pop();
    if (!active) return;
    const lat = parseFloat(active.latitude);
    const lng = parseFloat(active.longitude);
    if (isNaN(lat) || isNaN(lng)) return;
    mapInstanceRef.current.map.flyTo({ center: [lng, lat], zoom: 18, speed: 0.8 });
  };

  return (
    <div ref={mapContainerRef} style={{ width: "100%", height: "100vh", position: "relative" }}>
      <div id="galli-map" style={{ width: "100%", height: "100%" }} />

      {/* Floating Action Buttons */}
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
        <img src="/images/map.png" style={{ width: "32px", height: "32px" }} alt="Last QR" />
      </button>

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
        <img src="/images/playericon.png" style={{ width: "40px", height: "40px" }} alt="My Location" />
      </button>

      {/* Bottom Floating Bar */}
      {mapReady && !scanning && !scannedData && (
        <div
          style={{
            position: "fixed",
            bottom: "12px",
            left: "50%",
            transform: "translateX(-50%)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            width: "70%",
            maxWidth: "448px",
            backgroundColor: "white",
            padding: "8px",
            borderRadius: "9999px",
            boxShadow: "0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -2px rgba(0,0,0,0.05)",
            zIndex: 50,
          }}
        >
          <Link href="/leaderboard" style={{ padding: "12px", borderRadius: "50%" }}>
            <svg width="24" height="24" viewBox="0 0 24 24" stroke="black" strokeWidth="2" fill="none">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </Link>

          <div
            onClick={startScanner}
            style={{
              width: "64px",
              height: "64px",
              backgroundColor: "#dc2626",
              borderRadius: "50%",
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              boxShadow: "0 10px 15px -3px rgba(0,0,0,0.1)",
              cursor: "pointer",
            }}
          >
            <svg width="32" height="32" viewBox="0 0 24 24" stroke="white" strokeWidth="2" fill="none">
              <path d="M3 7V3H7" />
              <path d="M17 3H21V7" />
              <path d="M3 17V21H7" />
              <path d="M17 21H21V17" />
              <rect x="8" y="8.5" width="2" height="2" rx="0.5" fill="white" />
              <rect x="14" y="8.5" width="2" height="2" rx="0.5" fill="white" />
              <rect x="8" y="13" width="2" height="2" rx="0.5" fill="white" />
              <rect x="14" y="13" width="2" height="2" rx="0.5" fill="white" />
            </svg>
          </div>

          <Link href="/profile" style={{ padding: "12px", borderRadius: "50%" }}>
            <svg width="24" height="24" viewBox="0 0 24 24" stroke="black" strokeWidth="2" fill="none">
              <path d="M3 10L12 3L21 10" />
              <path d="M5 10V21H19V10" />
            </svg>
          </Link>
        </div>
      )}

      {/* QR Detail Popup */}
      {selectedQR && (
        <>
          <div onClick={() => setSelectedQR(null)} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 999 }} />
          <div
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
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
            }}
          >
            {selectedQR.picture && (
              <img
                src={selectedQR.picture}
                alt={selectedQR.name}
                style={{ width: "100%", height: "200px", objectFit: "cover", borderRadius: "12px", marginBottom: "16px" }}
              />
            )}
            <h2 style={{ fontSize: "28px", fontWeight: "bold", margin: "0 0 8px" }}>{selectedQR.name}</h2>
            <div style={{ marginBottom: "16px", fontSize: "18px", fontWeight: "600" }}>
              <span style={{ color: scannedQRIds.has(selectedQR.id) ? "#10b981" : "black" }}>
                Points: {selectedQR.points || 0} {scannedQRIds.has(selectedQR.id) && "(Scanned)"}
              </span>
            </div>
            <hr style={{ borderTop: "1px solid #e5e7eb", margin: "16px 0" }} />
            <p style={{ margin: "0 0 24px", fontSize: "16px", lineHeight: "1.6" }}>
              {selectedQR.description || "No description available."}
            </p>

            {scannedQRIds.has(selectedQR.id) && (
              <button
                onClick={() => checkReward(selectedQR.name)}
                disabled={checkingReward}
                style={{
                  width: "100%",
                  padding: "14px",
                  backgroundColor: checkingReward ? "#9ca3af" : "#eab308",
                  color: "white",
                  border: "none",
                  borderRadius: "12px",
                  fontSize: "18px",
                  fontWeight: "bold",
                  marginBottom: "12px",
                  cursor: checkingReward ? "not-allowed" : "pointer",
                }}
              >
                {checkingReward ? "Checking..." : "Check Reward"}
              </button>
            )}

            <button
              onClick={() => setSelectedQR(null)}
              style={{
                width: "100%",
                padding: "14px",
                backgroundColor: "#ef4444",
                color: "white",
                border: "none",
                borderRadius: "12px",
                fontSize: "18px",
                fontWeight: "bold",
              }}
            >
              Close
            </button>
          </div>
        </>
      )}

      {/* Reward Popup */}
      {rewardPopup && (
        <>
          <div onClick={closeRewardPopup} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1001 }} />
          <div
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              background: "white",
              borderRadius: "16px",
              padding: "32px",
              width: "90%",
              maxWidth: "400px",
              textAlign: "center",
              boxShadow: "0 10px 40px rgba(0,0,0,0.4)",
              zIndex: 1002,
            }}
          >
            <div style={{ marginBottom: "16px" }}>
              {rewardPopup.type === "success" && rewardPopup.imgUrl ? (
                <img src={rewardPopup.imgUrl} alt="Reward" style={{ width: "128px", height: "128px", objectFit: "contain" }} />
              ) : rewardPopup.type === "success" ? (
                <img src="/animation/gift.gif" alt="Win" style={{ width: "160px", height: "160px" }} />
              ) : (
                <img src="/animation/confuse.gif" alt="Info" style={{ width: "128px", height: "128px" }} />
              )}
            </div>

            <h1 style={{ fontSize: "24px", fontWeight: "bold", margin: "0 0 8px" }}>
              {rewardPopup.type === "success" && rewardPopup.prizeCode
                ? "Reward Received!"
                : rewardPopup.type === "success"
                ? "Points Added!"
                : "No Reward"}
            </h1>

            <p style={{ fontSize: "18px", fontWeight: "600", margin: "8px 0 24px" }}>{rewardPopup.message}</p>

            {rewardPopup.prizeCode && (
              <div
                style={{
                  padding: "16px",
                  backgroundColor: "#fef3c7",
                  border: "2px solid #f59e0b",
                  borderRadius: "8px",
                  margin: "16px 0",
                }}
              >
                <p style={{ margin: "0 0 4px", color: "#78716c" }}>Your Prize Code:</p>
                <p style={{ margin: 0, fontSize: "24px", fontWeight: "bold", color: "#d97706", letterSpacing: "2px" }}>
                  {rewardPopup.prizeCode}
                </p>
              </div>
            )}

            <button
              onClick={closeRewardPopup}
              style={{
                width: "100%",
                padding: "12px 40px",
                backgroundColor: "#16a34a",
                color: "white",
                border: "none",
                borderRadius: "9999px",
                fontSize: "18px",
                fontWeight: "600",
                cursor: "pointer",
              }}
            >
              Continue
            </button>
          </div>
        </>
      )}
    </div>
  );
}
