"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ref as dbRef, get, update, set } from "firebase/database";
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

  const [isInsidePlayArea, setIsInsidePlayArea] = useState(true);
  const [locationChecked, setLocationChecked] = useState(true);

  const [rulesAccepted, setRulesAccepted] = useState(false);
  const [checkingRulesStatus, setCheckingRulesStatus] = useState(true);

  const [showTooFarPopup, setShowTooFarPopup] = useState(false);
  const [totalRewardsLeft, setTotalRewardsLeft] = useState(0);
  const [loadingRewards, setLoadingRewards] = useState(false);

  const PLAYER_MARKER_SIZE = 50;
  const PLAYER_MARKER_ICON = "/images/navPointLogo.png";
  const playerMarkerRef = useRef(null);

  const fetchTotalRewardsLeft = async () => {
  setLoadingRewards(true);
  try {
    const prizeCodesRef = dbRef(realtimeDb, 'PrizeCodes');
    const prizeWonRef = dbRef(realtimeDb, 'PrizeWon');

    const prizeCodesSnap = await get(prizeCodesRef);
    const prizeWonSnap = await get(prizeWonRef);

    let totalPrizeCodes = 0;
    let totalPrizeWon = 0;

    // Count prize codes (all)
    if (prizeCodesSnap.exists()) {
      const allCodes = prizeCodesSnap.val();
      totalPrizeCodes = Object.keys(allCodes).length;
    }

    // Count how many prizes already won
    if (prizeWonSnap.exists()) {
      const allWon = prizeWonSnap.val();
      totalPrizeWon = Object.keys(allWon).length;
    }

    // FINAL REMAINING
    const remaining = totalPrizeCodes - totalPrizeWon;
    setTotalRewardsLeft(remaining);
  } catch (error) {
    console.error('Error fetching global rewards:', error);
    setTotalRewardsLeft(0);
  } finally {
    setLoadingRewards(false);
  }
};


  useEffect(() => {
  fetchTotalRewardsLeft();
}, []);

  useEffect(() => {
    const checkRulesAcceptance = async () => {
      try {
        const user = auth.currentUser;
        if (!user) {
          setRulesAccepted(false);
          setCheckingRulesStatus(false);
          return;
        }

        const rulesRef = dbRef(realtimeDb, `Users/${user.uid}/rulesAccepted`);
        const rulesSnap = await get(rulesRef);

        if (rulesSnap.exists() && rulesSnap.val() === true) {
          setRulesAccepted(true);
        } else {
          setRulesAccepted(false);
        }
      } catch (err) {
        console.error("Failed to check rules status:", err);
        setRulesAccepted(false);
      } finally {
        setCheckingRulesStatus(false);
      }
    };

    checkRulesAcceptance();
  }, []);

  const acceptRules = async () => {
    try {
      const user = auth.currentUser;
      if (!user) {
        alert("Please login first");
        return;
      }

      await set(dbRef(realtimeDb, `Users/${user.uid}/rulesAccepted`), true);
      setRulesAccepted(true);
    } catch (err) {
      console.error("Failed to save rules acceptance:", err);
      alert("Error saving acceptance. Please try again.");
    }
  };

  useEffect(() => {
    if (!rulesAccepted || checkingRulesStatus) return;

    if (!navigator.geolocation) {
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setUserLocation(loc);
      },
      () => {
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0
      }
    );
  }, [rulesAccepted, checkingRulesStatus]);

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

      const prizeWonRef = dbRef(realtimeDb, `PrizeWon/${user.uid}`);
      const prizeWonSnap = await get(prizeWonRef);

      if (prizeWonSnap.exists()) {
        const prizeData = prizeWonSnap.val();

        setRewardPopup({
          type: "success",
          message: `🎉 Congratulations ${username}! You completed all 8 scans and won a prize!`,
          imgUrl: prizeData.imgUrl || "",
          prizeCode: prizeData.prizeCode,
          wonAt: prizeData.wonAt,
          scannedCodes: prizeData.scannedCodes || [],
          alreadyClaimed: false
        });
      } else {
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
      }

      // Refresh reward count after checking
      setTimeout(() => fetchTotalRewardsLeft(), 1000);

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

  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current || !userLocation || !isInsidePlayArea) return;

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
  }, [mapReady, userLocation, isInsidePlayArea]);

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
          minZoom: 13,
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

  if (checkingRulesStatus) {
    return (
      <div style={{ width: "100%", height: "100vh", background: "#1a1a1a", display: "flex", alignItems: "center", justifyContent: "center", color: "white" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "24px", marginBottom: "16px" }}>Loading...</div>
          <div className="animate-spin rounded-full h-12 w-12 border-t-4 border-b-4 border-yellow-500 mx-auto"></div>
        </div>
      </div>
    );
  }

  if (!rulesAccepted) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-blue-900 via-purple-900 to-indigo-900 p-3">
        <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full p-5 sm:p-8 max-h-[90vh] overflow-y-auto">
          <div className="text-center mb-5 sm:mb-8">
            <h1 className="text-2xl sm:text-4xl font-black text-gray-900 mb-1 sm:mb-2">Before You Play</h1>
            <p className="text-base sm:text-xl text-gray-600 font-semibold">Quick Rules</p>
          </div>

          <div className="space-y-3 sm:space-y-4 mb-5 sm:mb-8">
            {[
              "One account per player.",
              "Scan all available QR codes to earn one prize (while supplies last).",
              "Don't take or share photos of QR codes.",
              "Don't damage, tamper with, or remove QR codes.",
              "Respect each participating location — follow their rules and staff instructions.",
              "No cheating, automation, or exploits.",
              "Prizes are first-come, first-served.",
              "Be considerate of other players and don't block QR codes.",
              "Stay safe and avoid restricted areas.",
              "Supporting our partner establishments with a Google Review or social post is greatly appreciated!"
            ].map((rule, idx) => (
              <div key={idx} className="flex items-start gap-2 sm:gap-4 bg-gray-50 p-3 sm:p-4 rounded-lg sm:rounded-xl hover:bg-gray-100 transition">
                <div className="flex-shrink-0 w-6 h-6 sm:w-8 sm:h-8 bg-gradient-to-br from-blue-500 to-purple-600 text-white rounded-full flex items-center justify-center font-bold text-xs sm:text-sm">
                  {idx + 1}
                </div>
                <p className="text-gray-800 text-sm sm:text-lg leading-relaxed">{rule}</p>
              </div>
            ))}
          </div>

          <button
            onClick={acceptRules}
            className="w-full py-3 sm:py-5 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white text-lg sm:text-2xl font-bold rounded-xl sm:rounded-2xl shadow-xl hover:shadow-2xl transition transform hover:scale-105"
          >
            I Accept — Let's Play! 🎮
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div ref={mapContainerRef} style={{ width: "100%", height: "100vh", position: "relative" }}>
        <div id="galli-map" style={{ width: "100%", height: "100%" }} />
        <button
          onClick={goToLastQR}
          className="absolute bottom-[140px] right-3 sm:right-5 z-[1000] w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-white shadow-lg flex items-center justify-center"
        >
          <img src="/images/map.png" className="w-6 h-6 sm:w-8 sm:h-8" alt="Map" />
        </button>
        <button
          onClick={relocateToUser}
          className="absolute bottom-[88px] right-3 sm:right-5 z-[1000] w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-white shadow-lg flex items-center justify-center"
        >
          <img src="/images/playericon.png" className="w-7 h-7 sm:w-10 sm:h-10" alt="Player" />
        </button>
        {isInsidePlayArea && mapReady && !scanning && !scannedData && (
          <div className="fixed bottom-2 left-1/2 transform -translate-x-1/2 flex justify-between items-center w-[75%] sm:w-[60%] max-w-md bg-white px-3 py-1.5 sm:px-4 sm:py-2 rounded-full shadow-lg z-50">
            <Link href="/leaderboard" className="group p-1.5 sm:p-2 rounded-full hover:bg-black transition">
              <svg width="18" height="18" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none" className="sm:w-5 sm:h-5 text-black group-hover:text-white">
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </Link>
            <div onClick={startScanner} className="flex justify-center items-center w-11 h-11 sm:w-14 sm:h-14 bg-red-600 rounded-full shadow-lg cursor-pointer hover:bg-red-700 transition">
              <svg width="22" height="22" viewBox="0 0 24 24" stroke="white" strokeWidth="2" fill="none" className="sm:w-7 sm:h-7">
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
            <Link href="/profile" className="group p-1.5 sm:p-2 rounded-full hover:bg-black transition">
              <svg width="20" height="20" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none" className="sm:w-6 sm:h-6 text-black group-hover:text-white">
                <path d="M3 10L12 3L21 10" />
                <path d="M5 10V21H19V10" />
              </svg>
            </Link>
          </div>
        )}
      </div>

      {selectedQR && (
        <>
          <div onClick={() => setSelectedQR(null)} className="fixed inset-0 bg-black/50 z-[999]" />
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-2xl sm:rounded-3xl p-5 sm:p-8 w-[90%] sm:w-11/12 max-w-md shadow-2xl z-[1000] max-h-[90vh] overflow-y-auto">
            {selectedQR.picture && (
              <img src={selectedQR.picture} alt={selectedQR.name} className="w-full h-40 sm:h-56 object-cover rounded-xl sm:rounded-2xl mb-4 sm:mb-6" />
            )}
            <h2 className="text-2xl sm:text-3xl text-black font-bold text-center mb-3 sm:mb-4">{selectedQR.name}</h2>

            {/* Points (left) and Total Rewards (right) in one line */}
            <div className="w-full flex justify-between items-center px-4 mb-4">

              {/* Points */}
              <p className="text-lg sm:text-xl text-black">
                Points:{" "}
                <span
                  className={
                    scannedQRIds.has(selectedQR.id)
                      ? "text-green-600 font-bold"
                      : "text-black"
                  }
                >
                  {selectedQR.points || 0}{" "}
                  {scannedQRIds.has(selectedQR.id) && "✓ Scanned"}
                </span>
              </p>

              {/* Total Rewards */}
              <div className="text-right">
                <p className="text-base font-bold text-black">Total Rewards left</p>
                <p className="text-xl font-bold text-black">
                  {loadingRewards ? (
                    <span className="text-base">Loading...</span>
                  ) : (
                    totalRewardsLeft
                  )}
                </p>
              </div>
            </div>


            {selectedQR.description && (
              <p className="text-center text-gray-600 text-sm sm:text-base mb-4">{selectedQR.description}</p>
            )}

            {scannedQRIds.has(selectedQR.id) && (
              <button
                onClick={() => checkReward(selectedQR.name)}
                disabled={checkingReward || totalRewardsLeft === 0}
                className={`w-full py-3 sm:py-4 rounded-xl sm:rounded-2xl font-bold text-white text-base sm:text-lg transition ${checkingReward || totalRewardsLeft === 0
                  ? "bg-gray-400 cursor-not-allowed"
                  : "bg-gradient-to-r from-orange-500 to-orange-600 hover:shadow-xl"
                  }`}
              >
                {checkingReward ? "Checking..." : totalRewardsLeft === 0 ? "No Rewards Left" : "Check Reward!"}
              </button>
            )}

            <button
              onClick={() => setSelectedQR(null)}
              className="w-full mt-3 sm:mt-4 py-3 sm:py-4 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl sm:rounded-2xl transition"
            >
              Close
            </button>
          </div>
        </>
      )}

      {rewardPopup && (
        <>
          <div onClick={closeRewardPopup} className="fixed inset-0 bg-black/80 z-[1001]" />
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-2xl sm:rounded-3xl p-6 sm:p-10 w-[90%] sm:w-11/12 max-w-lg text-center shadow-2xl z-[1002]">
            <div className="p-4 sm:p-8">
              {rewardPopup.type === "success" && rewardPopup.prizeCode ? (
                <img src={rewardPopup.imgUrl || "/animation/cheer.gif"} alt="Won" className="w-32 h-32 sm:w-48 sm:h-48 mx-auto mb-4 sm:mb-6" />
              ) : (
                <img src="/animation/confuse.gif" alt="No prize" className="w-24 h-24 sm:w-32 sm:h-32 mx-auto mb-4 sm:mb-6" />
              )}
              <h1 className="text-2xl sm:text-4xl font-bold mb-3 sm:mb-4">
                {rewardPopup.type === "success" ? "You Won!" : "No Prize Yet"}
              </h1>
              <p className="text-base sm:text-xl text-gray-700 mb-5 sm:mb-8">{rewardPopup.message}</p>
              {rewardPopup.prizeCode && (
                <div className="bg-gradient-to-r from-amber-100 to-orange-100 border-4 border-amber-400 rounded-2xl sm:rounded-3xl p-4 sm:p-6 mb-5 sm:mb-8">
                  <p className="text-amber-800 font-bold mb-2 sm:mb-3 text-sm sm:text-base">Your Prize Code:</p>
                  <p className="text-3xl sm:text-5xl font-black text-amber-600 tracking-widest">
                    {rewardPopup.prizeCode}
                  </p>
                </div>
              )}
              <button
                onClick={closeRewardPopup}
                className="w-full py-3 sm:py-5 bg-gradient-to-r from-green-500 to-emerald-600 text-white text-lg sm:text-2xl font-bold rounded-2xl sm:rounded-3xl shadow-xl hover:shadow-2xl transition"
              >
                Continue
              </button>
            </div>
          </div>
        </>
      )}

      {showTooFarPopup && (
        <>
          <div className="fixed inset-0 bg-black/90 z-[1003]" />
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-2xl sm:rounded-3xl p-6 sm:p-10 w-[90%] sm:w-11/12 max-w-md text-center shadow-2xl z-[1004]">
            <img src="/animation/confuse.gif" alt="Too far" className="w-24 sm:w-32 mx-auto mb-4 sm:mb-6" />
            <h1 className="text-2xl sm:text-3xl font-bold text-red-600 mb-3 sm:mb-4">You're Too Far!</h1>
            <p className="text-base sm:text-lg mb-4 sm:mb-6 text-black">Come within 1km of Thamel to play</p>
            <button
              onClick={() => window.location.reload()}
              className="w-full bg-black text-white px-8 py-3 rounded-full text-lg font-bold hover:bg-gray-800 transition"
            >
              Try Again
            </button>
          </div>
        </>
      )}
    </>
  );
}
