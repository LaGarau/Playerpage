"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ref as dbRef, get, update, set } from "firebase/database";
import { realtimeDb, auth } from "../lib/firebase";

const DEFAULT_MARKER = "/images/navPointLogo.png";
const MARKER_SIZE = 55;
const BORDER_WIDTH = "3px";
const HIGHLIGHT_COLOR = "#10B981";


// PLAY AREA
const PLAY_AREA_CENTER = { lat: 27.71386797377799, lng: 85.3101511297507 };     //lat: 27.6550, lng: 85.3497  27.71386797377799,85.3101511297507
const PLAY_AREA_RADIUS_METERS = 10000;                        

// MAP BOUNDARY 
const MAP_CENTER = { lat: 27.7172, lng: 85.324 };            
const MAP_MAX_RADIUS_METERS = 10000;                        
const CENTER = MAP_CENTER;
const MAX_RADIUS = MAP_MAX_RADIUS_METERS;

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

export default function FastMapComponent({ 
  qrList,
  scannedQRIds,
  scanning = false,
  scannedData = null,
  startScanner
 }) {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markerRefs = useRef({});
  const resizeObserverRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);
  const [userLocation, setUserLocation] = useState(null);
  const [selectedQR, setSelectedQR] = useState(null);
  const [checkingReward, setCheckingReward] = useState(false);
  const [rewardPopup, setRewardPopup] = useState(null);
  const [isInsidePlayArea, setIsInsidePlayArea] = useState(null); 
  const [locationChecked, setLocationChecked] = useState(false);

  const PLAYER_MARKER_SIZE = 50;
  const PLAYER_MARKER_ICON = "/images/playerlocation.png";
  const playerMarkerRef = useRef(null);

  // --- Check if user is inside 2km play area ---
  const checkPlayAreaProximity = (location) => {
    const distance = getDistance(
      PLAY_AREA_CENTER.lat,
      PLAY_AREA_CENTER.lng,
      location.lat,
      location.lng
    );

    const inside = distance <= PLAY_AREA_RADIUS_METERS;
    setIsInsidePlayArea(inside);
    setLocationChecked(true);

    if (!inside) {
      console.log(`User is ${Math.round(distance / 1000)}km away from play area. Required: <= 2km`);
    }
  };

  // --- Get user location and check play area ---
  useEffect(() => {
    if (!navigator.geolocation) {
      setIsInsidePlayArea(false);
      setLocationChecked(true);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setUserLocation(loc);
        const dist = getDistance(PLAY_AREA_CENTER.lat, PLAY_AREA_CENTER.lng, loc.lat, loc.lng);
        setIsInsidePlayArea(dist <= PLAY_AREA_RADIUS_METERS);
        setLocationChecked(true);
      },
      () => {
        setIsInsidePlayArea(false);
        setLocationChecked(true);
      }
    );
  }, []);

  // --- Check reward for SPECIFIC QR from Firebase notifications ---
  const checkReward = async (qrName) => {
    setCheckingReward(true);

    try {
      const user = auth.currentUser;
      if (!user) {
        setRewardPopup({ 
          type: "error", 
          message: "Please login to check rewards" 
        });
        setCheckingReward(false);
        return;
      }

      const userProfileRef = dbRef(realtimeDb, `Users/${user.uid}`);
      const userProfileSnap = await get(userProfileRef);
      const username = userProfileSnap.exists() 
        ? userProfileSnap.val().username 
        : user.displayName || "guest";

      console.log("Checking reward for:", { username, qrName });

      const notifRef = dbRef(realtimeDb, "notifications");
      const snapshot = await get(notifRef);

      if (snapshot.exists()) {
        const notifications = snapshot.val();
        let foundReward = null;
        let notifKey = null;

        Object.entries(notifications).forEach(([key, notif]) => {
          const usernameMatch = notif.username?.trim().toLowerCase() === username?.trim().toLowerCase();
          const qrNameMatch = notif.qrName?.trim().toLowerCase() === qrName?.trim().toLowerCase();
          const hasPrizeCode = notif.prizeCode && notif.prizeCode.trim() !== "";
          
          if (usernameMatch && qrNameMatch && hasPrizeCode) {
            if (!foundReward || !notif.claimed) {
              foundReward = notif;
              notifKey = key;
            }
          }
        });

        if (foundReward) {
          setRewardPopup({
            type: "success",
            message: foundReward.message || "Congratulations! You won a reward!",
            imgUrl: foundReward.imgUrl || "",
            prizeCode: foundReward.prizeCode,
            notificationKey: foundReward.claimed ? null : notifKey,
            alreadyClaimed: foundReward.claimed || false
          });
        } else {
          setRewardPopup({
            type: "info",
            message: `No reward found for ${qrName}. Keep scanning more QR codes!`
          });
        }
      } else {
        setRewardPopup({
          type: "info",
          message: "No reward notifications found. Keep scanning more QR codes!"
        });
      }
    } catch (error) {
      console.error("Error checking rewards:", error);
      setRewardPopup({
        type: "error",
        message: "Error checking rewards. Please try again."
      });
    } finally {
      setCheckingReward(false);
    }
  };

  const closeRewardPopup = async () => {
    if (rewardPopup?.notificationKey && !rewardPopup?.alreadyClaimed) {
      try {
        const notifRef = dbRef(realtimeDb, `notifications/${rewardPopup.notificationKey}`);
        await update(notifRef, { 
          claimed: true, 
          claimedAt: Date.now() 
        });
      } catch (err) {
        console.error("Error updating notification:", err);
      }
    }
    setRewardPopup(null);
  };

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

    const mapPlugin = mapInstanceRef.current;

    if (!playerMarkerRef.current) {
      const el = document.createElement("div");
      el.style.width = `${PLAYER_MARKER_SIZE}px`;
      el.style.height = `${PLAYER_MARKER_SIZE}px`;
      el.style.backgroundImage = `url(${PLAYER_MARKER_ICON})`;
      el.style.backgroundSize = "contain";
      el.style.backgroundRepeat = "no-repeat";
      el.style.backgroundPosition = "center";
      el.style.borderRadius = "50%";
      el.style.pointerEvents = "none";
      el.style.transform = "translate(-50%, -50%)";

      playerMarkerRef.current = mapPlugin.displayPinMarker({
        latLng: [userLocation.lat, userLocation.lng],
        element: el,
      });
    } else {
      playerMarkerRef.current.setLngLat([userLocation.lat, userLocation.lng]);
    }

    mapPlugin.map.setCenter([userLocation.lng, userLocation.lat]);
  }, [mapReady, userLocation]);

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

  // --- Initialize map ONLY if inside play area ---
  useEffect(() => {
    if (!userLocation || mapInstanceRef.current || !isInsidePlayArea) return;

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
  }, [userLocation, isInsidePlayArea]);

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
              setRewardPopup(null);
              map.setCenter([lng, lat]);
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
        markerRefs.current[id]?.remove?.();
        delete markerRefs.current[id];
      }
    });
  }, [qrList, scannedQRIds, mapReady]);

  // --- RENDER: Show popup if far, otherwise show map ---
  if (!locationChecked || isInsidePlayArea === null) {
    return (
      <div style={{ width: "100%", height: "100vh", background: "#1a1a1a", display: "flex", alignItems: "center", justifyContent: "center", color: "white" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "24px", marginBottom: "16px" }}>Checking your location...</div>
          <div className="animate-spin rounded-full h-12 w-12 border-t-4 border-b-4 border-yellow-500 mx-auto"></div>
        </div>
      </div>
    );
  }

  if (!isInsidePlayArea) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-800">
        <div className="bg-white p-10 rounded-2xl text-center max-w-md">
          <img src="/animation/confuse.gif" alt="Too far" className="w-32 mx-auto mb-6" />
          <h1 className="text-3xl font-bold text-red-600 mb-4">You're Too Far!</h1>
          <p className="text-lg mb-6 text-black">Come within 2km of Thamel to play</p>
          <button onClick={() => window.location.reload()} className="bg-black text-white px-8 py-3 rounded-full text-lg font-bold">
            Try Again
          </button>
        </div>
      </div>
    );
  }

  // --- NORMAL MAP RENDER (Only if inside 2km) ---
  return (
    <div ref={mapContainerRef} style={{ width: "100%", height: "100vh", position: "relative" }}>
      <div id="galli-map" style={{ width: "100%", height: "100%" }} />

      {/* Buttons */}
      <button onClick={goToLastQR} style={{ position: "absolute", bottom: "170px", right: "20px", zIndex: 1000, borderRadius: "50%", width: "50px", height: "50px", display: "flex", justifyContent: "center", alignItems: "center", boxShadow: "0 4px 10px rgba(0,0,0,0.3)", border: "none", cursor: "pointer", backgroundColor: "white" }}>
        <img src="/images/map.png" style={{ width: "32px", height: "32px" }} alt="Map" />
      </button>

      <button onClick={relocateToUser} style={{ position: "absolute", bottom: "100px", right: "20px", zIndex: 1000, borderRadius: "50%", width: "50px", height: "50px", display: "flex", justifyContent: "center", alignItems: "center", boxShadow: "0 4px 10px rgba(0,0,0,0.3)", border: "none", cursor: "pointer", backgroundColor: "white" }}>
        <img src="/images/playericon.png" style={{ width: "40px", height: "40px" }} alt="Player" />
      </button>

      {/* Bottom Floating Bar */}

        {isInsidePlayArea && mapReady && !scanning && !scannedData && (
          <div className="fixed bottom-3 sm:bottom-4 left-1/2 transform -translate-x-1/2 flex justify-between items-center w-[70%] sm:w-[60%] max-w-md bg-white p-2 sm:p-3 rounded-full shadow-lg z-50">
            <Link href="/leaderboard" className="group p-2 sm:p-3 rounded-full hover:bg-black transition">
              <svg width="20" height="20" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none" className="sm:w-6 sm:h-6 text-black group-hover:text-white">
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </Link>

            <div onClick={startScanner} className="flex justify-center items-center w-14 h-14 sm:w-16 sm:h-16 bg-red-600 rounded-full shadow-lg cursor-pointer hover:bg-red-700 transition">
              <svg width="28" height="28" viewBox="0 0 24 24" stroke="white" strokeWidth="2" fill="none" className="sm:w-8 sm:h-8">
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


            <Link href="/profile" className="group p-3 rounded-full hover:bg-black transition">
              <svg width="24" height="24" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none" className="text-black group-hover:text-white">
                <path d="M3 10L12 3L21 10" />
                <path d="M5 10V21H19V10" />
              </svg>
            </Link>
          </div>
        )}

      {/* QR Popup & Reward Popup - unchanged */}
      {selectedQR && (
        <>
          <div onClick={() => setSelectedQR(null)} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 999 }} />
          <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", background: "white", borderRadius: "16px", padding: "24px", width: "90%", maxWidth: "400px", maxHeight: "80vh", overflowY: "auto", boxShadow: "0 10px 40px rgba(0,0,0,0.4)", zIndex: 1000 }}>
            {selectedQR.picture && <img src={selectedQR.picture} alt={selectedQR.name} style={{ width: "100%", height: "200px", objectFit: "cover", borderRadius: "12px", marginBottom: "16px" }} />}
            <h2 style={{ color: "black", margin: "0 0 8px", fontSize: "28px", fontWeight: "bold" }}>{selectedQR.name}</h2>
            <div className="flex justify-between mb-4 text-lg font-semibold">
              <span className={scannedQRIds.has(selectedQR.id) ? "text-green-500" : "text-black"}>
                Points: {selectedQR.points || 0} {scannedQRIds.has(selectedQR.id) && "(Scanned)"}
              </span>
            </div>
            <hr style={{ borderTop: "1px solid #e5e7eb", margin: "16px 0" }} />
            <p style={{ color: "black", margin: "0 0 24px", fontSize: "16px", lineHeight: "1.6" }}>
              {selectedQR.description || "No description available."}
            </p>

            {scannedQRIds.has(selectedQR.id) && (
              <button onClick={() => checkReward(selectedQR.name)} disabled={checkingReward}
                style={{ width: "100%", padding: "14px", backgroundColor: checkingReward ? "#9ca3af" : "#eab308", color: "white", border: "none", borderRadius: "12px", fontSize: "18px", fontWeight: "bold", marginBottom: "12px", cursor: checkingReward ? "not-allowed" : "pointer" }}>
                {checkingReward ? "Checking..." : "Check Reward"}
              </button>
            )}

            <button onClick={() => setSelectedQR(null)}
              style={{ width: "100%", padding: "14px", backgroundColor: "#ef4444", color: "white", border: "none", borderRadius: "12px", fontSize: "18px", fontWeight: "bold" }}>
              Close
            </button>
          </div>
        </>
      )}

      {rewardPopup && (
        <>
          <div onClick={closeRewardPopup} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1001 }} />
          <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", background: "white", borderRadius: "16px", padding: "32px", width: "90%", maxWidth: "400px", textAlign: "center", boxShadow: "0 10px 40px rgba(0,0,0,0.4)", zIndex: 1002 }}>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: "16px" }}>
              {rewardPopup.type === "success" && rewardPopup.imgUrl ? (
                <img src={rewardPopup.imgUrl} alt="Reward" style={{ width: "128px", height: "128px", objectFit: "contain", borderRadius: "8px" }} />
              ) : rewardPopup.type === "success" && rewardPopup.prizeCode ? (
                <img src="/animation/gift.gif" alt="Reward" style={{ width: "160px", height: "160px", objectFit: "contain" }} />
              ) : (
                <img src="/animation/confuse.gif" alt="Info" style={{ width: "128px", height: "128px", objectFit: "contain" }} />
              )}
            </div>
            <h1 style={{ color: "#1f2937", margin: "0 0 8px", fontSize: "24px", fontWeight: "bold" }}>
              {rewardPopup.type === "success" && rewardPopup.prizeCode ? "Reward Received!" : 
               rewardPopup.type === "success" ? "Points Claimed!" :
               "Error"}
            </h1>
            <p style={{ color: "#374151", margin: "8px 0 24px", fontSize: "18px", lineHeight: "1.6", fontWeight: "600" }}>
              {rewardPopup.message}
            </p>
            {rewardPopup.prizeCode && (
              <div style={{ padding: "16px", backgroundColor: "#fef3c7", border: "2px solid #f59e0b", borderRadius: "8px", margin: "16px 0" }}>
                <p style={{ color: "#78716c", margin: "0 0 4px" }}>Your Prize Code:</p>
                <p style={{ color: "#d97706", margin: 0, fontSize: "24px", fontWeight: "bold", letterSpacing: "2px" }}>
                  {rewardPopup.prizeCode}
                </p>
              </div>
            )}
            <button onClick={closeRewardPopup}
              style={{ width: "100%", padding: "12px 40px", backgroundColor: "#16a34a", color: "white", border: "none", borderRadius: "9999px", fontSize: "18px", fontWeight: "600", cursor: "pointer" }}>
              Continue
            </button>
          </div>
        </>
      )}
    </div>
  );
}
