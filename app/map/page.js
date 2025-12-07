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

  // Function to get external links for a QR by name (social media and review)
  const getExternalLinksForQR = async (qrName) => {
    try {
      const qrDataRef = ref(realtimeDb, "QR-Data");
      const snapshot = await get(qrDataRef);

      if (!snapshot.exists()) {
        return { socialMediaLink: null, reviewLink: null };
      }

      const data = snapshot.val();

      for (const [key, qr] of Object.entries(data)) {
        const qrNameClean = (qr.name || "").replace(/[,_]\d+$/, "").trim().toLowerCase();
        const searchNameClean = qrName.trim().toLowerCase();

        if (qrNameClean === searchNameClean) {
          const socialMediaLink = qr.socialMediaLink?.trim() || null;
          const reviewLink = qr.externalLink?.trim() || null;

          return {
            socialMediaLink: socialMediaLink && socialMediaLink !== "" ? socialMediaLink : null,
            reviewLink: reviewLink && reviewLink !== "" ? reviewLink : null
          };
        }
      }

      return { socialMediaLink: null, reviewLink: null };
    } catch (err) {
      return { socialMediaLink: null, reviewLink: null };
    }
  };

  // Function to get an available prize code for the scanned QR
  const getAvailablePrizeCode = async (qrId, qrName) => {
    try {
      const prizeCodesRef = ref(realtimeDb, "PrizeCodes");
      const snapshot = await get(prizeCodesRef);

      if (!snapshot.exists()) {
        return null;
      }

      const data = snapshot.val();

      for (const [key, prize] of Object.entries(data)) {
        const qrNameMatch = prize.qrName?.trim().toLowerCase() === qrName?.trim().toLowerCase();
        const qrIdMatch = prize.qrId === qrId;

        if ((qrNameMatch || qrIdMatch) && !prize.used) {
          return { key, ...prize };
        }
      }

      return null;
    } catch (err) {
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

      await push(ref(realtimeDb, "notifications"), notificationData);

      const prizeRef = ref(realtimeDb, `PrizeCodes/${prizeKey}`);
      await update(prizeRef, {
        used: true,
        usedBy: username,
        usedAt: Date.now()
      });

      return true;
    } catch (err) {
      return false;
    }
  };

  // Function to check for notifications matching BOTH username AND qrName
  const checkForNotification = async (scannedQrName) => {
    const user = auth.currentUser;

    if (!user) {
      return null;
    }

    try {
      const userProfileRef = ref(realtimeDb, `Users/${user.uid}`);
      const userProfileSnap = await get(userProfileRef);
      const username = userProfileSnap.exists()
        ? userProfileSnap.val().username
        : user.displayName || "guest";

      const notifRef = ref(realtimeDb, "notifications");
      const snapshot = await get(notifRef);

      if (!snapshot.exists()) {
        return null;
      }

      const data = snapshot.val();
      let matchingNotifs = [];

      Object.entries(data).forEach(([key, notif]) => {
        const usernameMatch = notif.username?.trim().toLowerCase() === username?.trim().toLowerCase();
        const qrNameMatch = notif.qrName?.trim().toLowerCase() === scannedQrName?.trim().toLowerCase();

        if (usernameMatch && qrNameMatch && !notif.claimed) {
          matchingNotifs.push({ ...notif, key });
        }
      });

      if (matchingNotifs.length > 0) {
        matchingNotifs.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        return matchingNotifs[0];
      }

      return null;
    } catch (err) {
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
      // Silent error
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

      const prizeCode = await getAvailablePrizeCode(qr.id, qrName);

      if (prizeCode) {
        await createPrizeNotification(username, qrName, prizeCode.code, prizeCode.key);
      }
    } catch (err) {
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
      return;
    }

    const qrPoints = scannedData?.points || 0;
    const scannedQrName = scannedData?.displayName || "";

    setScannedData(null);

    const notification = await checkForNotification(scannedQrName);
    const links = await getExternalLinksForQR(scannedQrName);

    if (notification) {
      setRewardNotif({
        ...notification,
        socialMediaLink: links.socialMediaLink,
        reviewLink: links.reviewLink
      });
    } else {
      setRewardNotif({
        message: `You have successfully claimed ${qrPoints} ${qrPoints === 1 ? "point" : "points"}!`,
        isDefault: true,
        socialMediaLink: links.socialMediaLink,
        reviewLink: links.reviewLink
      });
    }
  };

  // Handle closing notification popup
  const handleCloseNotification = async () => {
    if (rewardNotif && !rewardNotif.isDefault) {
      try {
        const notifRef = ref(realtimeDb, `notifications/${rewardNotif.key}`);
        await update(notifRef, { claimed: true, claimedAt: Date.now() });
      } catch (err) {
        // Silent error
      }
    }
    setRewardNotif(null);
  };

  if (!ready) return <LoaderTimer />;

  return (
    <AuthGuard>
      <div className="relative h-screen w-full overflow-hidden">
        {/* PASS ALL REQUIRED PROPS HERE */}
        <MapWithNoSSR
          qrList={qrList}
          scannedQRIds={scannedQRIds}
          scanning={scanning}
          scannedData={scannedData}
          startScanner={startScanner}
        />
        {/* QR Scanner Overlay */}
        {scanning && (
          <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black bg-opacity-90 p-4">
            <div className="relative w-full max-w-[350px] aspect-square border-4 border-green-500 rounded-lg overflow-hidden">
              <div id="qr-scanner" className="absolute inset-0 w-full h-full" />
            </div>
            <button
              onClick={stopScanner}
              className="mt-6 sm:mt-10 px-8 sm:px-10 py-2.5 sm:py-3 bg-red-500 text-white text-base sm:text-lg rounded-full hover:bg-red-600 transition"
            >
              Close Scanner
            </button>
          </div>
        )}

        {/* Scanned Popup */}
        {scannedData && (
          <div className="fixed inset-0 flex items-center justify-center z-50 p-4 bg-black bg-opacity-60">
            <div className="bg-white rounded-2xl p-6 sm:p-8 max-w-sm w-full text-center shadow-2xl">
              <div className="flex justify-center mb-3 sm:mb-4">
                <img src="/animation/cheer.gif" alt="Congrats" className="w-28 h-28 sm:w-40 sm:h-40 object-contain" />
              </div>
              <h1 className="text-xl sm:text-2xl font-bold text-gray-800 mb-2">{scannedData.displayName}</h1>
              <p className="text-gray-600 text-base sm:text-lg">You have earned</p>
              <p className="text-2xl sm:text-3xl font-bold text-green-600 mt-1">{scannedData.points} {scannedData.points === 1 ? 'point' : 'points'}</p>
              <p className="text-gray-700 font-bold text-sm sm:text-md mb-4 mt-2">{qrDescription}</p>

              <button
                onClick={handleClaimReward}
                className="mt-3 sm:mt-4 w-full px-6 sm:px-10 py-2.5 sm:py-3 bg-yellow-500 text-white text-base sm:text-lg font-semibold rounded-full hover:bg-yellow-600 transition"
              >
                Check if you won
              </button>

              <button
                onClick={closeScannedPopup}
                className="bg-green-600 text-white px-6 sm:px-10 py-2.5 sm:py-3 text-base sm:text-lg rounded-full font-semibold hover:bg-green-700 transition w-full mt-2"
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {/* Reward Notification Popup */}
        {rewardNotif && (
          <div className="fixed inset-0 flex items-center justify-center z-50 p-4 bg-black bg-opacity-70">
            <div className="bg-white rounded-2xl p-6 sm:p-8 max-w-sm w-full text-center shadow-2xl max-h-[90vh] overflow-y-auto">
              <div className="flex justify-center mb-3 sm:mb-4">
                {rewardNotif.isDefault ? (
                  <img src="/animation/confuse.gif" alt="Success" className="w-28 h-28 sm:w-40 sm:h-40 object-contain" />
                ) : rewardNotif.imgUrl ? (
                  <img src={rewardNotif.imgUrl} alt="Reward" className="w-28 h-28 sm:w-40 sm:h-40 object-contain rounded-lg" />
                ) : (
                  <img src="/animation/cheer.gif" alt="Reward" className="w-28 h-28 sm:w-40 sm:h-40 object-contain" />
                )}
              </div>
              <h1 className="text-xl sm:text-2xl font-bold text-gray-800 mb-2">
                {rewardNotif.isDefault ? "🎉 Points Claimed!" : "🎁 Congratulations!"}
              </h1>
              <p className="text-gray-700 font-semibold text-base sm:text-lg mt-2 whitespace-pre-line">{rewardNotif.message}</p>

              {/* Show Prize Code if available */}
              {!rewardNotif.isDefault && rewardNotif.prizeCode && (
                <div className="mt-3 sm:mt-4 p-3 sm:p-4 bg-yellow-50 border-2 border-yellow-400 rounded-lg">
                  <p className="text-xs sm:text-sm text-gray-600 mb-1">Your Prize Code:</p>
                  <p className="text-xl sm:text-2xl font-bold text-yellow-600 tracking-wider break-all">{rewardNotif.prizeCode}</p>
                  <p className="text-xs text-gray-500 mt-2">Explore remaining QR codes for grand prize!</p>
                </div>
              )}

              {/* External Links Section */}
              {(rewardNotif.socialMediaLink || rewardNotif.reviewLink) && (
                <div className="mt-3 sm:mt-4 space-y-2">
                  {/* Social Media Link Button */}
                  {rewardNotif.socialMediaLink && (
                    <a
                      href={rewardNotif.socialMediaLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-full px-4 sm:px-6 py-2.5 sm:py-3 bg-blue-600 text-white text-sm sm:text-base font-semibold rounded-full hover:bg-blue-700 transition text-center"
                    >
                      SocialMedia Link
                    </a>
                  )}


                  {/* Review Link Button */}
                  {rewardNotif.reviewLink && (
                    <a
                      href={rewardNotif.reviewLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center w-full px-4 sm:px-6 py-2.5 sm:py-3 bg-amber-600 text-white text-sm sm:text-base font-semibold rounded-full hover:bg-amber-700 transition"
                    >
                      <svg className="w-4 h-4 sm:w-5 sm:h-5 mr-2 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                      </svg>
                      Give us a Review
                    </a>
                  )}
                </div>
              )}

              <button
                onClick={handleCloseNotification}
                className="bg-green-600 text-white px-6 sm:px-10 py-2.5 sm:py-3 text-base sm:text-lg rounded-full font-semibold hover:bg-green-700 transition w-full mt-3 sm:mt-4"
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {/* Already Scanned Popup */}
        {alreadyScannedData && (
          <div className="fixed inset-0 flex items-center justify-center z-50 p-4 bg-black bg-opacity-60">
            <div className="bg-white rounded-2xl p-6 sm:p-8 max-w-sm w-full text-center shadow-2xl">
              <div className="flex justify-center mb-3 sm:mb-4">
                <img src="/animation/confuse.gif" alt="Alert" className="w-20 h-20 sm:w-24 sm:h-24 object-contain" />
              </div>
              <h1 className="text-xl sm:text-2xl font-bold text-gray-800 mb-2">Already Scanned</h1>
              <p className="text-gray-600 text-base sm:text-lg">You have already scanned <strong>{alreadyScannedData.qrName}</strong>!</p>
              <button
                onClick={() => setAlreadyScannedData(null)}
                className="mt-4 sm:mt-6 w-full px-6 sm:px-10 py-2.5 sm:py-3 bg-red-600 text-white text-base sm:text-lg rounded-full font-semibold hover:bg-red-700 transition"
              >
                Close
              </button>
            </div>
          </div>
        )}

        

      </div>
    </AuthGuard>
  );
}
