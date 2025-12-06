"use client";

import { useEffect, useRef, useState } from "react";
import { onValue, ref as dbRef, set, get, update } from "firebase/database";
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
  const [checkingReward, setCheckingReward] = useState(false);
  const [rewardPopup, setRewardPopup] = useState(null);

  const PLAYER_MARKER_SIZE = 50;
  const PLAYER_MARKER_ICON = "/images/playerlocation.png";
  const playerMarkerRef = useRef(null);

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

      // Get username
      const userProfileRef = dbRef(realtimeDb, `Users/${user.uid}`);
      const userProfileSnap = await get(userProfileRef);
      const username = userProfileSnap.exists() 
        ? userProfileSnap.val().username 
        : user.displayName || "guest";

      console.log("Checking reward for:", { username, qrName });

      // Check notifications table
      const notifRef = dbRef(realtimeDb, "notifications");
      const snapshot = await get(notifRef);

      if (snapshot.exists()) {
        const notifications = snapshot.val();
        let foundReward = null;
        let notifKey = null;

        // Search for matching notification (username + qrName)
        // IMPORTANT: Only show notifications that have actual prizes (prizeCode exists and not empty)
        Object.entries(notifications).forEach(([key, notif]) => {
          const usernameMatch = notif.username?.trim().toLowerCase() === username?.trim().toLowerCase();
          const qrNameMatch = notif.qrName?.trim().toLowerCase() === qrName?.trim().toLowerCase();
          
          // Check if this is an actual prize (has prizeCode and it's not empty)
          const hasPrizeCode = notif.prizeCode && notif.prizeCode.trim() !== "";
          
          console.log(`Checking notification:`, {
            key,
            notifUsername: notif.username,
            notifQrName: notif.qrName,
            usernameMatch,
            qrNameMatch,
            claimed: notif.claimed,
            hasPrizeCode,
            prizeCode: notif.prizeCode
          });

          // Match username, qrName, AND must have a valid prize code
          // Skip "Sorry, no prizes available" notifications
          if (usernameMatch && qrNameMatch && hasPrizeCode) {
            // Prioritize unclaimed, but if not found, use claimed ones
            if (!foundReward || !notif.claimed) {
              foundReward = notif;
              notifKey = key;
              console.log("✅ Found matching reward with prize code!", notif.claimed ? "(Already Claimed)" : "(Unclaimed)");
            }
          }
        });

        if (foundReward) {
          setRewardPopup({
            type: "success",
            message: foundReward.message || "Congratulations! You won a reward!",
            imgUrl: foundReward.imgUrl || "",
            prizeCode: foundReward.prizeCode,
            notificationKey: foundReward.claimed ? null : notifKey, // Don't update if already claimed
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

  // Mark notification as claimed when closing reward popup (only if not already claimed)
  const closeRewardPopup = async () => {
    if (rewardPopup?.notificationKey && !rewardPopup?.alreadyClaimed) {
      try {
        const notifRef = dbRef(realtimeDb, `notifications/${rewardPopup.notificationKey}`);
        await update(notifRef, { 
          claimed: true, 
          claimedAt: Date.now() 
        });
        console.log("Notification marked as claimed");
      } catch (err) {
        console.error("Error updating notification:", err);
      }
    }
    setRewardPopup(null);
  };

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
        <img src="/images/map.png" style={{ width: "32px", height: "32px" }} alt="Map" />
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
        <img src="/images/playericon.png" style={{ width: "40px", height: "40px" }} alt="Player" />
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
              {/* <span className="text-black">
                Reward: {selectedQR.reward || 0}
              </span> */}
            </div>

            <hr style={{ borderTop: "1px solid #e5e7eb", margin: "16px 0" }} />
            <p style={{ color: "black", margin: "0 0 24px", fontSize: "16px", lineHeight: "1.6" }}>
              {selectedQR.description || "No description available."}
            </p>

            {/* Check Reward Button - Only for scanned QRs */}
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
                  cursor: checkingReward ? "not-allowed" : "pointer"
                }}
                onMouseEnter={e => !checkingReward && (e.currentTarget.style.backgroundColor = "#ca8a04")}
                onMouseLeave={e => !checkingReward && (e.currentTarget.style.backgroundColor = "#eab308")}
              >
                {checkingReward ? "Checking..." : "🎁 Check Reward"}
              </button>
            )}

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

      {/* Reward Result Popup - Same design as scanning page */}
      {rewardPopup && (
        <>
          <div onClick={closeRewardPopup} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1001 }} />
          <div style={{
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
          }}>
            {/* Icon/Image */}
            <div style={{ display: "flex", justifyContent: "center", marginBottom: "16px" }}>
              {rewardPopup.type === "success" && rewardPopup.imgUrl ? (
                <img src={rewardPopup.imgUrl} alt="Reward" style={{ width: "128px", height: "128px", objectFit: "contain", borderRadius: "8px" }} />
              ) : rewardPopup.type === "success" && rewardPopup.prizeCode ? (
                <img src="/animation/gift.gif" alt="Reward" style={{ width: "160px", height: "160px", objectFit: "contain" }} />
              ) : rewardPopup.type === "error" ? (
                <img src="/animation/confuse.gif" alt="Error" style={{ width: "128px", height: "128px", objectFit: "contain" }} />
              ) : (
                <img src="/animation/confuse.gif" alt="Info" style={{ width: "128px", height: "128px", objectFit: "contain" }} />
              )}
            </div>

            {/* Title */}
            <h1 style={{ 
              color: "#1f2937", 
              margin: "0 0 8px", 
              fontSize: "24px", 
              fontWeight: "bold" 
            }}>
              {rewardPopup.type === "success" && rewardPopup.prizeCode ? "🎁 Reward Received!" : 
               rewardPopup.type === "success" ? "🎉 Points Claimed!" :
               rewardPopup.type === "error" ? "Error" : 
               "🎉 Points Claimed!"}
            </h1>

            {/* Message */}
            <p style={{ 
              color: "#374151", 
              margin: "8px 0 24px", 
              fontSize: "18px", 
              lineHeight: "1.6",
              fontWeight: "600",
              whiteSpace: "pre-line"
            }}>
              {rewardPopup.message}
            </p>

            {/* Prize Code - Only if available */}
            {rewardPopup.prizeCode && (
              <div style={{
                padding: "16px",
                backgroundColor: "#fef3c7",
                border: "2px solid #f59e0b",
                borderRadius: "8px",
                marginTop: "16px",
                marginBottom: "24px"
              }}>
                <p style={{ color: "#78716c", margin: "0 0 4px", fontSize: "14px", fontWeight: "500" }}>
                  Your Prize Code:
                </p>
                <p style={{ 
                  color: "#d97706", 
                  margin: 0, 
                  fontSize: "24px", 
                  fontWeight: "bold",
                  letterSpacing: "2px"
                }}>
                  {rewardPopup.prizeCode}
                </p>
              </div>
            )}

            {/* Close Button */}
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
                transition: "background-color 0.2s"
              }}
              onMouseEnter={e => e.currentTarget.style.backgroundColor = "#15803d"}
              onMouseLeave={e => e.currentTarget.style.backgroundColor = "#16a34a"}
            >
              Continue
            </button>
          </div>
        </>
      )}
    </div>
  );
}
