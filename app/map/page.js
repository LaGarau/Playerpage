'use client';

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { onValue, ref, push, set, get, update, query, orderByChild, equalTo } from "firebase/database";
import { auth, realtimeDb } from "../../lib/firebase";
import AuthGuard from "../../components/authGuard";
import LoaderTimer from "../../components/LoaderTimer";

const MapWithNoSSR = dynamic(
  () => import("../../components/MapContainerComponent"),
  { ssr: false }
);

export default function MapPage() {
  const [ready, setReady] = useState(false);
  const [qrList, setQrList] = useState([]);
  const [scannedQRIds, setScannedQRIds] = useState(new Set());
  const [scanning, setScanning] = useState(false);
  const [scannedData, setScannedData] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [qrDescription, setQrDescription] = useState("");
  const [qrLink, setQrLink] = useState(null);
  const [alreadyScannedData, setAlreadyScannedData] = useState(null);
  const [rewardNotif, setRewardNotif] = useState(null);
  const scannerRef = useRef(null);

  // Listen to auth changes
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((user) => {
      setCurrentUser(user);

      if (user && !sessionStorage.getItem('mapLoaderDone')) {
        setReady(false);
        const timer = setTimeout(() => {
          setReady(true);
          sessionStorage.setItem('mapLoaderDone', 'true');
        }, 5000);
        return () => clearTimeout(timer);
      } else {
        setReady(true);
      }

      setScannedQRIds(new Set());
    });

    return () => unsubscribe();
  }, []);

  // Load QR list
  useEffect(() => {
    const qrRef = ref(realtimeDb, "QR-Data");
    const unsubscribe = onValue(qrRef, (snapshot) => {
      const data = snapshot.val();
      const list = data
        ? Object.keys(data).map((key) => ({ id: key, ...data[key] }))
        : [];
      setQrList(list.filter((qr) => qr.status === "Active"));
    });
    return () => unsubscribe();
  }, []);

  // Load user's scanned QRs
  useEffect(() => {
    if (!currentUser) {
      setScannedQRIds(new Set());
      return;
    }

    const scannedRef = ref(realtimeDb, "scannedQRCodes");
    const unsubscribe = onValue(scannedRef, (snapshot) => {
      const data = snapshot.val();
      if (!data) {
        setScannedQRIds(new Set());
        return;
      }

      const userRecords = Object.values(data).filter(
        (item) => item.userId === currentUser.uid
      );

      const scannedIds = new Set();
      userRecords.forEach((record) => {
        const qrName = record.qrName;
        const found = qrList.find((q) => {
          const qClean = (q.name || "").replace(/[,_]\d+$/, "").trim();
          return qClean === qrName;
        });
        if (found) scannedIds.add(found.id);
      });

      setScannedQRIds(scannedIds);
    });

    return () => unsubscribe();
  }, [qrList, currentUser]);

  // Function to get an available prize code for the scanned QR
  const getAvailablePrizeCode = async (qrId, qrName) => {
    try {
      console.log("Looking for prize code for QR:", qrName, "ID:", qrId);
      
      const prizeCodesRef = ref(realtimeDb, "PrizeCodes");
      const snapshot = await get(prizeCodesRef);
      
      if (!snapshot.exists()) {
        console.log("No prize codes found in database");
        return null;
      }

      const data = snapshot.val();
      
      // Find an unused prize code for this QR (match by qrId or qrName)
      for (const [key, prize] of Object.entries(data)) {
        const qrNameMatch = prize.qrName?.trim().toLowerCase() === qrName?.trim().toLowerCase();
        const qrIdMatch = prize.qrId === qrId;
        
        if ((qrNameMatch || qrIdMatch) && !prize.used) {
          console.log("✅ Found available prize code:", prize.code);
          return { key, ...prize };
        }
      }
      
      console.log("No available prize codes for this QR");
      return null;
    } catch (err) {
      console.error("Error getting prize code:", err);
      return null;
    }
  };

  // Function to create notification with prize code
  const createPrizeNotification = async (username, qrName, prizeCode, prizeKey) => {
    try {
      const message = `🎉 ${username} scanned ${qrName} — Congratulations! Prize Code: ${prizeCode}`;
      
      const notificationData = {
        username: username,
        qrName: qrName,
        message: message,
        prizeCode: prizeCode,
        imgUrl: "",
        claimed: false,
        createdAt: Date.now()
      };

      // Create notification
      await push(ref(realtimeDb, "notifications"), notificationData);
      
      // Mark prize code as used
      const prizeRef = ref(realtimeDb, `PrizeCodes/${prizeKey}`);
      await update(prizeRef, { 
        used: true, 
        usedBy: username,
        usedAt: Date.now() 
      });
      
      console.log("✅ Prize notification created and code marked as used");
      return true;
    } catch (err) {
      console.error("Error creating prize notification:", err);
      return false;
    }
  };

  // Function to check for notifications matching BOTH username AND qrName
  const checkForNotification = async (scannedQrName) => {
    const user = auth.currentUser;
    
    if (!user) {
      console.log("No current user");
      return null;
    }

    try {
      // Get username from Firebase Users table
      const userProfileRef = ref(realtimeDb, `Users/${user.uid}`);
      const userProfileSnap = await get(userProfileRef);
      const username = userProfileSnap.exists() 
        ? userProfileSnap.val().username 
        : user.displayName || "guest";

      console.log("Checking notifications for:");
      console.log("- Username:", username);
      console.log("- QR Name:", scannedQrName);

      const notifRef = ref(realtimeDb, "notifications");
      const snapshot = await get(notifRef);

      if (!snapshot.exists()) {
        console.log("No notifications found in database");
        return null;
      }

      const data = snapshot.val();
      let matchingNotifs = [];

      // Find all matching unclaimed notifications for current user AND qrName
      Object.entries(data).forEach(([key, notif]) => {
        // Match both username and qrName (case-insensitive)
        const usernameMatch = notif.username?.trim().toLowerCase() === username?.trim().toLowerCase();
        const qrNameMatch = notif.qrName?.trim().toLowerCase() === scannedQrName?.trim().toLowerCase();
        
        console.log(`Notification ${key}:`, {
          notifUsername: notif.username,
          notifQrName: notif.qrName,
          usernameMatch,
          qrNameMatch,
          claimed: notif.claimed
        });

        if (usernameMatch && qrNameMatch && !notif.claimed) {
          console.log("✅ Match found! Notification:", notif.message);
          matchingNotifs.push({ ...notif, key });
        }
      });

      if (matchingNotifs.length > 0) {
        // Sort by createdAt (newest first for most recent prizes)
        matchingNotifs.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        
        // Return the first (most recent) notification
        const selectedNotif = matchingNotifs[0];
        console.log("Selected notification:", selectedNotif);
        return selectedNotif;
      }

      console.log("No matching notification found");
      return null;
    } catch (err) {
      console.error("Error checking notifications:", err);
      return null;
    }
  };

  // QR Scanner functions
  const startScanner = async () => {
    if (qrList.length === 0) {
      alert("QR data not loaded yet, please wait.");
      return;
    }

    setScanning(true);
    setScannedData(null);

    try {
      const { Html5Qrcode } = await import("html5-qrcode");
      const scanner = new Html5Qrcode("qr-scanner");
      scannerRef.current = scanner;

      await scanner.start(
        { facingMode: "environment" },
        {
          fps: 10,
          qrbox: { width: 250, height: 250 },
          aspectRatio: 1.0,
          disableFlip: false,
          videoConstraints: { facingMode: "environment", focusMode: "continuous", advanced: [{ zoom: 1.0 }] }
        },
        async (decodedText) => {
          const match = decodedText.match(/^(.+?)[,_](\d+)$/);
          const qrName = match ? match[1].trim() : decodedText.trim();
          const points = match ? parseInt(match[2]) : 0;

          const matched = qrList.find((q) => {
            const cleanQrName = (q.name || "").replace(/[,_]\d+$/, "").trim().toLowerCase();
            const qrNameLower = qrName.toLowerCase();
            return cleanQrName === qrNameLower || (q.name || "").toLowerCase().includes(qrNameLower);
          });

          if (matched && scannerRef.current) {
            const alreadyScanned = scannedQRIds.has(matched.id);
            const currentScanner = scannerRef.current;
            scannerRef.current = null;
            await currentScanner.stop();
            await currentScanner.clear();

            if (alreadyScanned) {
              setScanning(false);
              setAlreadyScannedData({ qrName });
              return;
            }

            // Fetch description
            const descSnap = await get(ref(realtimeDb, `QR-Data/${matched.id}/description`));
            setQrDescription(descSnap.exists() ? descSnap.val() : "No description available");

            const qrId = matched.id?.trim();
            const fieldName = "externalLink";
            const qrRef = ref(realtimeDb, `QR-Data/${qrId}/${fieldName}`);
            const snapshot = await get(qrRef);
            setQrLink(snapshot.exists() ? snapshot.val() : null);

            await saveScanned(matched, decodedText, qrName, points);
            setScanning(false);

            setTimeout(() => setScannedData({ ...matched, displayName: qrName, points, qrId: matched.id }), 100);
          } else if (!matched) {
            alert(`QR Code detected but not recognized: ${decodedText}`);
          }
        },
        () => { }
      );
    } catch (err) {
      alert("Camera not available: " + err.message);
      setScanning(false);
    }
  };

  const stopScanner = async () => {
    if (scannerRef.current) {
      try { await scannerRef.current.stop(); await scannerRef.current.clear(); } catch { }
      scannerRef.current = null;
    }
    setScanning(false);
  };

  const updateLeaderboard = async (userId, username, newPoints) => {
    try {
      const leaderboardRef = ref(realtimeDb, `playerleaderboards/${userId}`);
      const snapshot = await get(leaderboardRef);
      
      if (snapshot.exists()) {
        const currentData = snapshot.val();
        const updatedPoints = (currentData.total_points || 0) + newPoints;
        const updatedScanCount = (currentData.scan_count || 0) + 1;
        
        const firstScanTime = currentData.first_scan_time || Date.now();
        const currentTime = Date.now();
        const timeSpanMs = currentTime - firstScanTime;
        const hours = Math.floor(timeSpanMs / (1000 * 60 * 60));
        const minutes = Math.floor((timeSpanMs % (1000 * 60 * 60)) / (1000 * 60));
        const formattedTimeSpan = `${hours}h ${minutes}m`;
        
        await set(leaderboardRef, {
          player_id: userId,
          player_name: username,
          total_points: updatedPoints,
          scan_count: updatedScanCount,
          time_span: timeSpanMs,
          formatted_time_span: formattedTimeSpan,
          last_updated: Date.now(),
          profile_image: currentData.profile_image || null
        });
      } else {
        await set(leaderboardRef, {
          player_id: userId,
          player_name: username,
          total_points: newPoints,
          scan_count: 1,
          time_span: 0,
          formatted_time_span: "-",
          first_scan_time: Date.now(),
          last_updated: Date.now(),
          profile_image: null,
          rank: 0
        });
      }
    } catch (error) {
      console.error("Error updating leaderboard:", error);
    }
  };

  const saveScanned = async (qr, originalText, qrName, points) => {
    const user = auth.currentUser;
    if (!user) return;

    const userProfileRef = ref(realtimeDb, `Users/${user.uid}`);
    const userProfileSnap = await get(userProfileRef);
    const username = userProfileSnap.exists() ? userProfileSnap.val().username : user.displayName || "guest";

    const now = new Date();
    const date = now.toLocaleDateString('en-US');
    const time = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

    try {
      // Save to scannedQRCodes (no prizeCode here)
      await push(ref(realtimeDb, "scannedQRCodes"), { 
        userId: user.uid, 
        username, 
        qrId: originalText, 
        qrName, 
        points, 
        date, 
        time 
      });
      
      await push(ref(realtimeDb, "playerStatus"), { username, qrName });
      await updateUserProfile(user.uid, points);
      await updateLeaderboard(user.uid, username, points);

      // Check if there's an available prize code for this QR
      const prizeCode = await getAvailablePrizeCode(qr.id, qrName);
      
      if (prizeCode) {
        console.log("🎁 Prize code available! Creating notification...");
        await createPrizeNotification(username, qrName, prizeCode.code, prizeCode.key);
      } else {
        console.log("No prize code available for this QR");
      }
    } catch (err) { 
      console.error("Error in saveScanned:", err);
      alert("Failed to save scan. Please try again."); 
    }
  };

  const updateUserProfile = async (userId, pointsToAdd) => {
    try {
      const userRef = ref(realtimeDb, `Users/${userId}`);
      const snapshot = await get(userRef);
      if (snapshot.exists()) {
        const userData = snapshot.val();
        await set(userRef, { 
          ...userData, 
          totalPoints: (userData.totalPoints || 0) + pointsToAdd, 
          qrScanned: (userData.qrScanned || 0) + 1, 
          lastUpdated: new Date().toISOString() 
        });
      } else {
        await set(userRef, { 
          totalPoints: pointsToAdd, 
          qrScanned: 1, 
          createdAt: new Date().toISOString(), 
          lastUpdated: new Date().toISOString() 
        });
      }
    } catch { }
  };

  const closeScannedPopup = () => setScannedData(null);

  // Handle claim reward button click
  const handleClaimReward = async () => {
    const user = auth.currentUser;
    
    if (!user) {
      console.log("No current user for claim");
      return;
    }

    console.log("=== CLAIM REWARD CLICKED ===");
    console.log("User UID:", user.uid);
    
    const qrPoints = scannedData?.points || 0;
    const scannedQrName = scannedData?.displayName || "";

    // Close the scanned popup
    setScannedData(null);

    // Check for notification matching BOTH username AND qrName
    const notification = await checkForNotification(scannedQrName);

    console.log("Notification result:", notification);

    if (notification) {
      // Show notification popup with prize info
      console.log("Showing notification popup with message:", notification.message);
      setRewardNotif(notification);
    } else {
      // Show default success message if no notification found
      console.log("No notification found, showing default message");
      setRewardNotif({
        message: `You have successfully claimed ${qrPoints} ${qrPoints === 1 ? "point" : "points"}!`,
        isDefault: true
      });
    }
  };

  // Handle closing notification popup
  const handleCloseNotification = async () => {
    if (rewardNotif && !rewardNotif.isDefault) {
      // Mark notification as claimed in Firebase
      try {
        const notifRef = ref(realtimeDb, `notifications/${rewardNotif.key}`);
        await update(notifRef, { claimed: true, claimedAt: Date.now() });
        console.log("Notification marked as claimed");
      } catch (err) {
        console.error("Error updating notification:", err);
      }
    }
    setRewardNotif(null);
  };

  if (!ready) return <LoaderTimer />;

  return (
    <AuthGuard>
      <div className="relative h-screen w-full overflow-hidden">
        <MapWithNoSSR qrList={qrList} scannedQRIds={scannedQRIds} />

        {/* QR Scanner Overlay */}
        {scanning && (
          <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black bg-opacity-90 p-4">
            <div className="relative w-80 max-w-[350px] aspect-square border-4 border-green-500 rounded-lg overflow-hidden">
              <div id="qr-scanner" className="absolute inset-0 w-full h-full" />
            </div>
            <button
              onClick={stopScanner}
              className="mt-10 px-10 py-3 bg-red-500 text-white rounded-full hover:bg-red-600 transition"
            >
              Close Scanner
            </button>
          </div>
        )}

        {/* Scanned Popup */}
        {scannedData && (
          <div className="fixed inset-0 flex items-center justify-center z-50 p-4 bg-black bg-opacity-60">
            <div className="bg-white rounded-2xl p-8 max-w-sm w-full text-center shadow-2xl">
              <div className="flex justify-center mb-4">
                <img src="/animation/cheer.gif" alt="Congrats" className="w-32 h-32 sm:w-40 sm:h-40 object-contain" />
              </div>
              <h1 className="text-2xl font-bold text-gray-800 mb-2">{scannedData.displayName}</h1>
              <p className="text-gray-600 text-lg">You have earned</p>
              <p className="text-3xl font-bold text-green-600 mt-1">{scannedData.points} {scannedData.points === 1 ? 'point' : 'points'}</p>
              <p className="text-gray-700 font-bold text-md mb-4">{qrDescription}</p>

              <button
                onClick={handleClaimReward}
                className="mt-4 w-full px-10 py-3 bg-yellow-500 text-white font-semibold rounded-full hover:bg-yellow-600 transition"
              >
               Check if you won
              </button>

              <button
                onClick={closeScannedPopup}
                className="bg-green-600 text-white px-10 py-3 rounded-full font-semibold hover:bg-green-700 transition w-full mt-2"
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {/* Reward Notification Popup */}
        {rewardNotif && (
          <div className="fixed inset-0 flex items-center justify-center z-50 p-4 bg-black bg-opacity-70">
            <div className="bg-white rounded-2xl p-8 max-w-sm w-full text-center shadow-2xl">
              <div className="flex justify-center mb-4">
                {rewardNotif.isDefault ? (
                  <img src="/animation/confuse.gif" alt="Success" className="w-32 h-32 sm:w-40 sm:h-40 object-contain" />
                ) : rewardNotif.imgUrl ? (
                  <img src={rewardNotif.imgUrl} alt="Reward" className="w-32 h-32 sm:w-40 sm:h-40 object-contain rounded-lg" />
                ) : (
                  <img src="/animation/cheer.gif" alt="Reward" className="w-32 h-32 sm:w-40 sm:h-40 object-contain" />
                )}
              </div>
              <h1 className="text-2xl font-bold text-gray-800 mb-2">
                {rewardNotif.isDefault ? "🎉 Points Claimed!" : "🎁 Congratulations!"}
              </h1>
              <p className="text-gray-700 font-semibold text-lg mt-2 whitespace-pre-line">{rewardNotif.message}</p>

              {/* Show Prize Code if available */}
              {!rewardNotif.isDefault && rewardNotif.prizeCode && (
                <div className="mt-4 p-4 bg-yellow-50 border-2 border-yellow-400 rounded-lg">
                  <p className="text-sm text-gray-600 mb-1">Your Prize Code:</p>
                  <p className="text-2xl font-bold text-yellow-600 tracking-wider">{rewardNotif.prizeCode}</p>
                </div>
              )}

              <button
                onClick={handleCloseNotification}
                className="bg-green-600 text-white px-10 py-3 rounded-full font-semibold hover:bg-green-700 transition w-full mt-6"
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {/* Already Scanned Popup */}
        {alreadyScannedData && (
          <div className="fixed inset-0 flex items-center justify-center z-50 p-4 bg-black bg-opacity-60">
            <div className="bg-white rounded-2xl p-8 max-w-sm w-full text-center shadow-2xl">
              <div className="flex justify-center mb-4">
                <img src="/animation/confuse.gif" alt="Alert" className="w-24 h-24 object-contain" />
              </div>
              <h1 className="text-2xl font-bold text-gray-800 mb-2">Already Scanned</h1>
              <p className="text-gray-600 text-lg">You have already scanned <strong>{alreadyScannedData.qrName}</strong>!</p>
              <button
                onClick={() => setAlreadyScannedData(null)}
                className="mt-6 w-full px-10 py-3 bg-red-600 text-white rounded-full font-semibold hover:bg-red-700 transition"
              >
                Close
              </button>
            </div>
          </div>
        )}

        {/* Bottom Floating Bar */}
        {!scanning && !scannedData && (
          <div className="fixed bottom-4 left-1/2 transform -translate-x-1/2 flex justify-between items-center w-[60%] max-w-md bg-white p-3 rounded-full shadow-lg z-50">
            <Link href="/leaderboard" className="group p-3 rounded-full hover:bg-black transition">
              <svg width="24" height="24" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none" className="text-black group-hover:text-white">
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </Link>

            <div onClick={startScanner} className="flex justify-center items-center w-16 h-16 bg-red-600 rounded-full shadow-lg cursor-pointer hover:bg-red-700 transition">
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

            <Link href="/profile" className="group p-3 rounded-full hover:bg-black transition">
              <svg width="24" height="24" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none" className="text-black group-hover:text-white">
                <path d="M3 10L12 3L21 10" />
                <path d="M5 10V21H19V10" />
              </svg>
            </Link>
          </div>
        )}

      </div>
    </AuthGuard>
  );
}
