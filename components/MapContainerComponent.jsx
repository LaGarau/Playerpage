"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ref as dbRef, get, update, set } from "firebase/database"; // ← Added "set"
import { realtimeDb, auth } from "../lib/firebase";

const DEFAULT_MARKER = "/images/navPointLogo.png";
const MARKER_SIZE = 55;
const BORDER_WIDTH = "3px";
const HIGHLIGHT_COLOR = "#10B981";

const PLAY_AREA_CENTER = { lat: 27.71386797377799, lng: 85.3101511297507 };
const PLAY_AREA_RADIUS_METERS = 10000;

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
  // Check location
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

  
  // RESTORED & MODIFIED: Check reward logic using ONLY the PrizeWon table
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
    
    console.log("Checking reward for:", { username, userId: user.uid });

    // 🔥 Check PrizeWon table directly using userId
    const prizeWonRef = dbRef(realtimeDb, `PrizeWon/${user.uid}`);
    const prizeWonSnap = await get(prizeWonRef);

    if (prizeWonSnap.exists()) {
      const prizeData = prizeWonSnap.val();
      
      // User has won a prize!
      setRewardPopup({
        type: "success",
        message: `🎉 Congratulations ${username}! You completed all 8 scans and won a prize!`,
        imgUrl: prizeData.imgUrl || "",
        prizeCode: prizeData.prizeCode,
        wonAt: prizeData.wonAt,
        scannedCodes: prizeData.scannedCodes || [],
        alreadyClaimed: false
      });
      
      console.log("Prize found:", prizeData.prizeCode);
    } else {
      // User hasn't won yet
      // Check how many unique scans they have
      const scansRef = dbRef(realtimeDb, "scannedQRCodes");
      const scansSnap = await get(scansRef);
      
      let userScansCount = 0;
      if (scansSnap.exists()) {
        const allScans = scansSnap.val();
        const userScans = Object.values(allScans).filter(s => s.userId === user.uid);
        userScansCount = new Set(userScans.map(s => s.qrName)).size;
      }

      setRewardPopup({
        type: "info",
        message: `You have scanned ${userScansCount}/8 unique QR codes. Scan ${8 - userScansCount} more to win a prize!`
      });
      
      console.log("No prize yet. User scans:", userScansCount);
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



  // Close popup and mark prize as claimed
  const closeRewardPopup = async () => {
    if (rewardPopup?.prizeKey && !rewardPopup?.alreadyClaimed) {
      try {
        await update(dbRef(realtimeDb, `PrizeWon/${rewardPopup.prizeKey}`), {
          claimed: true,
          claimedAt: Date.now()
        });
      } catch (err) {
        console.error("Failed to mark prize as claimed:", err);
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


  // Save player location
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
      } catch (err) {
        console.error("Failed to save location:", err);
      }
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

  return (
    <div ref={mapContainerRef} style={{ width: "100%", height: "100vh", position: "relative" }}>
      <div id="galli-map" style={{ width: "100%", height: "100%" }} />

      {/* Buttons */}
      <button onClick={goToLastQR} className="absolute bottom-44 right-5 z-[1000] w-12 h-12 rounded-full bg-white shadow-lg flex items-center justify-center">
        <img src="/images/map.png" className="w-8 h-8" alt="Map" />
      </button>

      <button onClick={relocateToUser} className="absolute bottom-28 right-5 z-[1000] w-12 h-12 rounded-full bg-white shadow-lg flex items-center justify-center">
        <img src="/images/playericon.png" className="w-10 h-10" alt="Player" />
      </button>

      {/* Bottom Bar - Fixed closing tag */}
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

      {/* QR Popup */}
      {selectedQR && (
        <>
          <div onClick={() => setSelectedQR(null)} className="fixed inset-0 bg-black/50 z-[999]" />
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-3xl p-8 w-11/12 max-w-md shadow-2xl z-[1000] max-h-[90vh] overflow-y-auto">
            {selectedQR.picture && (
              <img src={selectedQR.picture} alt={selectedQR.name} className="w-full h-56 object-cover rounded-2xl mb-6" />
            )}
            <h2 className="text-3xl font-bold text-center mb-4">{selectedQR.name}</h2>
            <p className="text-xl text-center mb-6">
              Points: <span className={scannedQRIds.has(selectedQR.id) ? "text-green-600 font-bold" : "text-gray-600"}>
                {selectedQR.points || 0} {scannedQRIds.has(selectedQR.id) && "Scanned"}
              </span>
            </p>

            {scannedQRIds.has(selectedQR.id) && (
              <button
                onClick={() => checkReward(selectedQR.name)}
                disabled={checkingReward}
                className={`w-full py-4 rounded-2xl font-bold text-white text-lg transition ${checkingReward
                    ? "bg-gray-400 cursor-not-allowed"
                    : "bg-gradient-to-r from-orange-500 to-orange-500 hover:shadow-xl"
                  }`}
              >
                {checkingReward ? "Checking..." : "Check Reward!"}
              </button>
            )}

            <button
              onClick={() => setSelectedQR(null)}
              className="w-full mt-4 py-4 bg-red-600 hover:bg-red-700 text-white font-bold rounded-2xl transition"
            >
              Close
            </button>
          </div>
        </>
      )}

      {/* Reward Popup */}
      {rewardPopup && (
        <>
          <div onClick={closeRewardPopup} className="fixed inset-0 bg-black/80 z-[1001]" />
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-3xl p-10 w-11/12 max-w-lg text-center shadow-2xl z-[1002]">
            <div className="p-8">
              {rewardPopup.type === "success" && rewardPopup.prizeCode ? (
                <img src={rewardPopup.imgUrl || "/animation/gift.gif"} alt="Won" className="w-48 h-48 mx-auto mb-6" />
              ) : (
                <img src="/animation/confuse.gif" alt="No prize" className="w-32 h-32 mx-auto mb-6" />
              )}

              <h1 className="text-4xl font-bold mb-4">
                {rewardPopup.type === "success" ? "You Won!" : "No Prize Yet"}
              </h1>

              <p className="text-xl text-gray-700 mb-8">{rewardPopup.message}</p>

              {rewardPopup.prizeCode && (
                <div className="bg-gradient-to-r from-amber-100 to-orange-100 border-4 border-amber-400 rounded-3xl p-6 mb-8">
                  <p className="text-amber-800 font-bold mb-3">Your Prize Code:</p>
                  <p className="text-5xl font-black text-amber-600 tracking-widest">
                    {rewardPopup.prizeCode}
                  </p>
                </div>
              )}

              <button
                onClick={closeRewardPopup}
                className="w-full py-5 bg-gradient-to-r from-green-500 to-emerald-600 text-white text-2xl font-bold rounded-3xl shadow-xl hover:shadow-2xl transition"
              >
                Continue
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
