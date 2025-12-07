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
const PROXIMITY_THRESHOLD = 50;

// Thamel area check 
const THAMEL_CENTER = { lat: 27.7172, lng: 85.324 }; 
const THAMEL_ACCESS_RADIUS = 2000; 

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

const getDistance = (lat1, lng1, lat2, lng2) => {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

export default function FastMapComponent({ qrList, scannedQRIds, onMapReadyAndInZone }) {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markerRefs = useRef({});
  const resizeObserverRef = useRef(null);

  const [mapReady, setMapReady] = useState(false);
  const [userLocation, setUserLocation] = useState(null);
  const [selectedQR, setSelectedQR] = useState(null);
  const [checkingReward, setCheckingReward] = useState(false);
  const [rewardPopup, setRewardPopup] = useState(null);
  const [isNearThamel, setIsNearThamel] = useState(null); // null = checking, true/false = result
  const [locationChecked, setLocationChecked] = useState(false);

  const playerMarkerRef = useRef(null);
  const PLAYER_MARKER_SIZE = 50;
  const PLAYER_MARKER_ICON = "/images/playerlocation.png";




  // ------------------------
  // Check if user is near Thamel
  // ------------------------
  useEffect(() => {
    if (!userLocation || locationChecked) return;

    const distanceToThamel = getDistance(
      userLocation.lat,
      userLocation.lng,
      THAMEL_CENTER.lat,
      THAMEL_CENTER.lng
    );

    const nearThamel = distanceToThamel <= THAMEL_ACCESS_RADIUS;
    setIsNearThamel(nearThamel);
    setLocationChecked(true);

    console.log(`Distance to Thamel: ${Math.round(distanceToThamel)}m`);
  }, [userLocation, locationChecked]);

  // ------------------------
  // Check Reward Logic
  // ------------------------
  const checkReward = async (qrName) => {
    setCheckingReward(true);
    try {
      const user = auth.currentUser;
      if (!user) {
        setRewardPopup({
          type: "error",
          message: "Please login to check rewards",
        });
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
        let foundReward = null;
        let notifKey = null;

        Object.entries(notifications).forEach(([key, notif]) => {
          const usernameMatch =
            notif.username?.trim().toLowerCase() ===
            username?.trim().toLowerCase();
          const qrNameMatch =
            notif.qrName?.trim().toLowerCase() ===
            qrName?.trim().toLowerCase();
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
            alreadyClaimed: foundReward.claimed || false,
          });
        } else {
          setRewardPopup({
            type: "info",
            message: `No reward found for ${qrName}. Keep scanning more QR codes!`,
          });
        }
      } else {
        setRewardPopup({
          type: "info",
          message: "No reward notifications found. Keep scanning more QR codes!",
        });
      }
    } catch (error) {
      console.error("Error checking rewards:", error);
      setRewardPopup({
        type: "error",
        message: "Error checking rewards. Please try again.",
      });
    } finally {
      setCheckingReward(false);
    }
  };

  const closeRewardPopup = async () => {
    if (rewardPopup?.notificationKey && !rewardPopup?.alreadyClaimed) {
      try {
        const notifRef = dbRef(
          realtimeDb,
          `notifications/${rewardPopup.notificationKey}`
        );
        await update(notifRef, {
          claimed: true,
          claimedAt: Date.now(),
        });
      } catch (err) {
        console.error("Error marking claimed:", err);
      }
    }
    setRewardPopup(null);
  };

  // ------------------------
  // Map Utility Buttons
  // ------------------------
  const relocateToUser = () => {
    if (!mapInstanceRef.current || !userLocation) return;
    const map = mapInstanceRef.current.map;
    map.flyTo({
      center: [userLocation.lng, userLocation.lat],
      zoom: 18,
      speed: 1.2,
    });
  };

  const goToLastQR = () => {
    if (!mapInstanceRef.current || !qrList?.length) return;
    const activeQRs = qrList.filter((qr) => qr.status === "Active");
    if (!activeQRs.length) return;
    const lastQR = activeQRs[activeQRs.length - 1];
    const lat = parseFloat(lastQR.latitude);
    const lng = parseFloat(lastQR.longitude);
    if (isNaN(lat) || isNaN(lng)) return;

    mapInstanceRef.current.map.flyTo({
      center: [lng, lat],
      zoom: 18,
      speed: 1.2,
    });
  };

  // ------------------------
  // Save Player Location
  // ------------------------
  useEffect(() => {
    if (!userLocation) return;

    const savePlayerNav = async () => {
      try {
        const user = auth.currentUser;
        if (!user) return;

        const userSnap = await get(dbRef(realtimeDb, `Users/${user.uid}`));
        const username = userSnap.exists()
          ? userSnap.val().username || "guest"
          : "guest";

        await set(dbRef(realtimeDb, `playernav/${user.uid}`), {
          username,
          latitude: userLocation.lat,
          longitude: userLocation.lng,
          datetime: new Date().toLocaleString(),
        });
      } catch { }
    };

    savePlayerNav();
    const interval = setInterval(savePlayerNav, 5000);
    return () => clearInterval(interval);
  }, [userLocation]);

  // ------------------------
  // Get User Location
  // ------------------------
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) =>
          setUserLocation({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
          }),
        () => setUserLocation({ lat: CENTER.lat, lng: CENTER.lng })
      );
    } else {
      setUserLocation({ lat: CENTER.lat, lng: CENTER.lng });
    }
  }, []);

  // ------------------------
  // Init Map (only if near Thamel)
  // ------------------------
  useEffect(() => {
    if (!userLocation || !isNearThamel || mapInstanceRef.current) return;

    const initMap = async () => {
      if (!window.GalliMapPlugin) {
        const script = document.createElement("script");
        script.src =
          "https://gallimap.com/static/dist/js/gallimaps.vector.min.latest.js";
        script.async = true;
        document.head.appendChild(script);
        await new Promise((resolve) => (script.onload = resolve));
      }
      if (!window.GalliMapPlugin) return;

      const panoDiv = document.createElement("div");
      panoDiv.id = "hidden-pano";
      panoDiv.style.cssText =
        "position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;";
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
          const dist = getDistance(
            CENTER.lat,
            CENTER.lng,
            c.lat,
            c.lng
          );
          if (dist > MAX_RADIUS) {
            const angle = Math.atan2(c.lat - CENTER.lat, c.lng - CENTER.lng);
            const newLat =
              CENTER.lat + (MAX_RADIUS / 111111) * Math.sin(angle);
            const newLng =
              CENTER.lng + (MAX_RADIUS / 111111) * Math.cos(angle);
            map.setCenter([newLng, newLat]);
          }
        });

        map.on("load", () => {
          setMapReady(true);
          setTimeout(() => {
            document
              .querySelectorAll(
                'button[title*="360"], button[title*="Location"]'
              )
              .forEach((b) => (b.style.display = "none"));
          }, 600);
        });

        resizeObserverRef.current = new ResizeObserver(() => map.resize());
        resizeObserverRef.current.observe(mapContainerRef.current);
      } catch (e) {
        console.error(e);
      }
    };

    initMap();

    return () => {
      resizeObserverRef.current?.disconnect();
      document.getElementById("hidden-pano")?.remove();
      mapInstanceRef.current?.map?.remove();
      mapInstanceRef.current = null;
    };
  }, [userLocation, isNearThamel]);

  // ------------------------
  // Player Marker
  // ------------------------
  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current || !userLocation) return;

    const map = mapInstanceRef.current.map;

    if (!playerMarkerRef.current) {
      playerMarkerRef.current = mapInstanceRef.current.displayPinMarker({
        latLng: [userLocation.lat, userLocation.lng],
      });

      const check = setInterval(() => {
        const el = playerMarkerRef.current?.getElement();
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
            border: "4px solid #3B82F6",
            borderRadius: "50%",
            boxShadow: "0 0 20px #3B82F6",
          });
          el.innerHTML = "";
        }
      }, 50);
    } else {
      playerMarkerRef.current.setLngLat([
        userLocation.lng,
        userLocation.lat,
      ]);
    }
  }, [mapReady, userLocation]);

  // ------------------------
  // QR Markers + Proximity
  // ------------------------
  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current || !userLocation) return;

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
      const distance = getDistance(
        userLocation.lat,
        userLocation.lng,
        lat,
        lng
      );

      const isNearby = distance <= PROXIMITY_THRESHOLD;
      const isScanned = scannedQRIds.has(id);
      const borderColor =
        isScanned || isNearby
          ? HIGHLIGHT_COLOR
          : getBorderColor(qr.type);

      if (!markerRefs.current[id]) {
        const marker = mapInstanceRef.current.displayPinMarker({
          latLng: [lat, lng],
        });
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
              border: `${BORDER_WIDTH} solid ${borderColor}`,
              boxShadow:
                isNearby && !isScanned
                  ? "0 0 20px 6px #10B981"
                  : "0 4px 16px rgba(0,0,0,0.4)",
              transform:
                "translate(-50%, -50%)" +
                (isNearby && !isScanned ? " scale(1.2)" : ""),
              cursor: "pointer",
              pointerEvents: "auto",
              transition: "all 0.3s ease",
            });
            el.innerHTML = "";

            el.onclick = () => {
              if (!userLocation) {
                setRewardPopup({
                  type: "error",
                  message: "Location not available yet.",
                });
                return;
              }

              const currentDistance = getDistance(
                userLocation.lat,
                userLocation.lng,
                lat,
                lng
              );

              if (currentDistance > PROXIMITY_THRESHOLD) {
                setRewardPopup({
                  type: "error",
                  message: `Too far away!\nGet within 50m to scan "${qr.name}".\n\nDistance: ${Math.round(
                    currentDistance
                  )}m`,
                });
                map.flyTo({
                  center: [lng, lat],
                  zoom: 18,
                  speed: 1.5,
                });
              } else {
                setSelectedQR({ ...qr, id });
                setRewardPopup(null);
                map.setCenter([lng, lat]);
              }
            };
          }
        }, 50);
      } else {
        const el = markerRefs.current[id].getElement();
        if (el) {
          el.style.border = `${BORDER_WIDTH} solid ${borderColor}`;
          if (isNearby && !isScanned) {
            el.style.boxShadow = "0 0 20px 6px #10B981";
            el.style.transform = "translate(-50%, -50%) scale(1.2)";
          } else {
            el.style.boxShadow = "0 4px 16px rgba(0,0,0,0.4)";
            el.style.transform = "translate(-50%, -50%)";
          }
        }
      }
    });

    Object.keys(markerRefs.current).forEach((id) => {
      if (!activeIds.has(id)) {
        markerRefs.current[id]?.remove?.();
        delete markerRefs.current[id];
      }
    });
  }, [qrList, scannedQRIds, mapReady, userLocation]);

    // ADD THIS useEffect — RIGHT HERE (just before the return)
  useEffect(() => {
    // Only signal parent when:
    // 1. Map is fully loaded
    // 2. User location is known
    // 3. Player is inside Thamel (isNearThamel === true)
    if (mapReady && userLocation && isNearThamel === true) {
      // Call parent to show floating bar
      onMapReadyAndInZone();
    }
  }, [mapReady, userLocation, isNearThamel, onMapReadyAndInZone]);

  // ------------------------
  // Render: Show popup if not near Thamel
  // ------------------------
  if (isNearThamel === null) {
    // Still checking location
    return (
      <div
        style={{
          width: "100%",
          height: "100vh",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          backgroundColor: "#1f2937",
        }}
      >
        <div style={{ textAlign: "center", color: "white" }}>
          <div
            style={{
              width: "60px",
              height: "60px",
              border: "6px solid #e5e7eb",
              borderTopColor: "#3b82f6",
              borderRadius: "50%",
              margin: "0 auto 20px",
              animation: "spin 1s linear infinite",
            }}
          />
          <p style={{ fontSize: "18px", fontWeight: "600" }}>
            Checking your location...
          </p>
          <style>{`
            @keyframes spin {
              to { transform: rotate(360deg); }
            }
          `}</style>
        </div>
      </div>
    );
  }

  if (isNearThamel === false) {
    // User is too far from Thamel
    const distanceToThamel = userLocation
      ? Math.round(
        getDistance(
          userLocation.lat,
          userLocation.lng,
          THAMEL_CENTER.lat,
          THAMEL_CENTER.lng
        )
      )
      : 0;

    return (
      <div
        style={{
          width: "100%",
          height: "100vh",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          backgroundColor: "#1f2937",
          padding: "20px",
        }}
      >
        <div
          style={{
            background: "white",
            borderRadius: "20px",
            padding: "40px 32px",
            maxWidth: "450px",
            textAlign: "center",
            boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
          }}
        >
          <img
            src="/animation/confuse.gif"
            alt="Location"
            style={{
              width: "160px",
              height: "160px",
              margin: "0 auto 24px",
            }}
          />

          <h1
            style={{
              fontSize: "28px",
              fontWeight: "bold",
              color: "#1f2937",
              marginBottom: "12px",
            }}
          >
            Not in Thamel Area
          </h1>

          <p
            style={{
              fontSize: "18px",
              color: "#4b5563",
              lineHeight: "1.6",
              marginBottom: "8px",
            }}
          >
            You need to be in the Thamel area to play this game.
          </p>

          <p
            style={{
              fontSize: "16px",
              color: "#6b7280",
              marginBottom: "24px",
            }}
          >
            Distance to Thamel: <strong>{distanceToThamel}m</strong>
            <br />
            (Must be within {THAMEL_ACCESS_RADIUS}m)
          </p>

          <div
            style={{
              backgroundColor: "#fef3c7",
              border: "2px solid #f59e0b",
              borderRadius: "12px",
              padding: "16px",
              marginBottom: "24px",
            }}
          >
            <p
              style={{
                fontSize: "16px",
                color: "#92400e",
                fontWeight: "600",
                margin: 0,
              }}
            >
              📍 Please travel to Thamel to start playing!
            </p>
          </div>

          <button
            onClick={() => {
              setLocationChecked(false);
              setIsNearThamel(null);
            }}
            style={{
              width: "100%",
              padding: "14px",
              backgroundColor: "#3b82f6",
              color: "white",
              border: "none",
              borderRadius: "12px",
              fontSize: "18px",
              fontWeight: "bold",
              cursor: "pointer",
              transition: "background-color 0.2s",
            }}
            onMouseOver={(e) =>
              (e.target.style.backgroundColor = "#2563eb")
            }
            onMouseOut={(e) =>
              (e.target.style.backgroundColor = "#3b82f6")
            }
          >
            Refresh Location
          </button>
        </div>
      </div>
    );
  }
  
  // User is near Thamel - show the map
  return (
    <div
      ref={mapContainerRef}
      style={{ width: "100%", height: "100vh", position: "relative" }}
    >
      <div id="galli-map" style={{ width: "100%", height: "100%" }} />

      {/* Buttons */}
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
        <img
          src="/images/map.png"
          style={{ width: "32px", height: "32px" }}
          alt="Last QR"
        />
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
        <img
          src="/images/playericon.png"
          style={{ width: "40px", height: "40px" }}
          alt="You"
        />
      </button>

      {/* QR Popup */}
      {selectedQR && (
        <>
          <div
            onClick={() => setSelectedQR(null)}
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(0,0,0,0.5)",
              zIndex: 999,
            }}
          />

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
                style={{
                  width: "100%",
                  height: "200px",
                  objectFit: "cover",
                  borderRadius: "12px",
                  marginBottom: "16px",
                }}
              />
            )}

            <h2
              style={{
                color: "black",
                margin: "0 0 8px",
                fontSize: "28px",
                fontWeight: "bold",
              }}
            >
              {selectedQR.name}
            </h2>

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: "16px",
                fontSize: "18px",
                fontWeight: "600",
              }}
            >
              <span
                style={{
                  color: scannedQRIds.has(selectedQR.id)
                    ? "#10B981"
                    : "black",
                }}
              >
                Points: {selectedQR.points || 0}{" "}
                {scannedQRIds.has(selectedQR.id) && "(Scanned)"}
              </span>
            </div>

            <hr
              style={{
                borderTop: "1px solid #e5e7eb",
                margin: "16px 0",
              }}
            />

            <p
              style={{
                color: "black",
                margin: "0 0 24px",
                fontSize: "16px",
                lineHeight: "1.6",
              }}
            >
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
                  cursor: checkingReward
                    ? "not-allowed"
                    : "pointer",
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
          <div
            onClick={closeRewardPopup}
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(0,0,0,0.7)",
              zIndex: 1001,
            }}
          />

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
                <img
                  src={rewardPopup.imgUrl}
                  alt="Reward"
                  style={{ width: "128px", height: "128px", objectFit: "contain" }}
                />
              ) : rewardPopup.type === "success" ? (
                <img
                  src="/animation/gift.gif"
                  alt="Win"
                  style={{ width: "160px", height: "160px" }}
                />
              ) : (
                <img
                  src="/animation/confuse.gif"
                  alt="Info"
                  style={{ width: "128px", height: "128px" }}
                />
              )}
            </div>

            <h1
              style={{
                fontSize: "24px",
                fontWeight: "bold",
                margin: "0 0 8px",
              }}
            >
              {rewardPopup.type === "success"
                ? "Reward Received!"
                : "Too Far!"}
            </h1>

            <p
              style={{
                fontSize: "18px",
                fontWeight: "600",
                whiteSpace: "pre-line",
                margin: "8px 0 24px",
              }}
            >
              {rewardPopup.message}
            </p>

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
                <p
                  style={{
                    margin: "0 0 4px",
                    fontSize: "14px",
                  }}
                >
                  Your Prize Code:
                </p>

                <p
                  style={{
                    margin: 0,
                    fontSize: "24px",
                    fontWeight: "bold",
                    letterSpacing: "2px",
                    color: "#d97706",
                  }}
                >
                  {rewardPopup.prizeCode}
                </p>
              </div>
            )}

            <button
              onClick={closeRewardPopup}
              style={{
                width: "100%",
                padding: "12px",
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
