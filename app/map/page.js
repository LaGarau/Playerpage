'use client';

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { onValue, ref, push, set, get } from "firebase/database";
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
  const scannerRef = useRef(null);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((user) => {
      setCurrentUser(user);

      // Run loader for all users who just logged in
      if (user && !sessionStorage.getItem('mapLoaderDone')) {
        setReady(false); // show loader

        // 5-second loader
        const timer = setTimeout(() => {
          setReady(true);
          sessionStorage.setItem('mapLoaderDone', 'true'); // mark loader done
        }, 5000);

        return () => clearTimeout(timer); // cleanup
      } else {
        setReady(true); // already ran, skip loader
      }

      // reset scanned QR ids
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

    const userId = currentUser.uid;
    const scannedRef = ref(realtimeDb, "scannedQRCodes");

    const unsubscribe = onValue(scannedRef, (snapshot) => {
      const data = snapshot.val();
      if (!data) {
        setScannedQRIds(new Set());
        return;
      }

      const userRecords = Object.values(data).filter(
        (item) => item.userId === userId
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
            setTimeout(() => setScannedData({ ...matched, displayName: qrName, points }), 100);
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
      await push(ref(realtimeDb, "scannedQRCodes"), { userId: user.uid, username, qrId: originalText, qrName, points, date, time });
      await push(ref(realtimeDb, "playerStatus"), { username, qrName });
      await updateUserProfile(user.uid, points);
      await updateLeaderboard(user.uid, username, points);
    } catch { alert("Failed to save scan. Please try again."); }
  };

  const updateUserProfile = async (userId, pointsToAdd) => {
    try {
      const userRef = ref(realtimeDb, `Users/${userId}`);
      const snapshot = await get(userRef);
      if (snapshot.exists()) {
        const userData = snapshot.val();
        await set(userRef, { ...userData, totalPoints: (userData.totalPoints || 0) + pointsToAdd, qrScanned: (userData.qrScanned || 0) + 1, lastUpdated: new Date().toISOString() });
      } else {
        await set(userRef, { totalPoints: pointsToAdd, qrScanned: 1, createdAt: new Date().toISOString(), lastUpdated: new Date().toISOString() });
      }
    } catch { }
  };

  const closeScannedPopup = () => setScannedData(null);

  if (!ready) return <LoaderTimer />;

  return (
    <AuthGuard>
      <div className="relative h-screen w-full overflow-hidden">
        <MapWithNoSSR qrList={qrList} scannedQRIds={scannedQRIds} />

        {/* QR Scanner Overlay */}
        {scanning && (
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              zIndex: 9999,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'rgba(0,0,0,0.9)',
              padding: '20px',
              boxSizing: 'border-box',
            }}
          >
            <div
              style={{
                position: 'relative',
                width: '80vw', // responsive square
                maxWidth: '350px',
                aspectRatio: '1 / 1', // ensures square ratio
                border: '4px solid #10B981',
                borderRadius: '12px',
                overflow: 'hidden',
                boxSizing: 'border-box',
              }}
            >
              <div
                id="qr-scanner"
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: '100%',
                  overflow: 'hidden',
                }}
              ></div>


            </div>

            <button
              onClick={stopScanner}
              style={{
                marginTop: '40px',
                padding: '12px 40px',
                backgroundColor: '#ef4444',
                color: 'white',
                border: 'none',
                borderRadius: '9999px',
                fontSize: '16px',
                fontWeight: '600',
                cursor: 'pointer',
                transition: 'background-color 0.3s',
              }}
              onMouseOver={(e) => (e.target.style.backgroundColor = '#dc2626')}
              onMouseOut={(e) => (e.target.style.backgroundColor = '#ef4444')}
            >
              Close Scanner
            </button>


          </div>
        )}


        {/* Scanned Popup */}
        {scannedData && (
          <div className="fixed inset-0 flex items-center justify-center z-50 p-4" style={{ background: 'rgba(0,0,0,0.6)' }}>
            <div className="bg-white rounded-2xl p-8 max-w-sm w-full text-center shadow-2xl">
              <div className="cheer flex justify-center"><img src="/animation/cheer.gif" alt="Congratulation"
                className="w-32 h-32 sm:w-40 sm:h-40 object-contain" /></div>
              <h1 className="text-2xl font-bold text-gray-800 mb-2">{scannedData.displayName}</h1>
              <div className="mb-6">
                <p className="text-gray-600 text-lg">You have earned</p>
                <p className="text-3xl font-bold text-green-600 mt-1">{scannedData.points} {scannedData.points === 1 ? 'point' : 'points'}</p>
                <p className="text-gray-700 font-bold text-md mb-4">{qrDescription}</p>
                <div className="flex flex-col items-center mt-4">
                  {/* Reward Link */}
                  {qrLink ? (
                    <a
                      href={qrLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 w-full inline-block px-10 py-3 text-white font-semibold rounded-full shadow-md transition text-center"
                      style={{
                        backgroundColor: "#FF6B35",
                      }}
                      onMouseEnter={e => (e.currentTarget.style.backgroundColor = "#f55b23")} 
                      onMouseLeave={e => (e.currentTarget.style.backgroundColor = "#FF6B35")}
                    >
                      Claim your reward
                    </a>

                  ) : (
                    <span className="mt-2 inline-block px-6 py-2 bg-gray-400 text-white font-semibold rounded-lg cursor-not-allowed opacity-70">
                      Claim your reward
                    </span>
                  )}

                </div>

              </div>
              <button onClick={closeScannedPopup} className="bg-green-600 text-white px-10 py-3 rounded-full font-semibold hover:bg-green-700 transition w-full">Continue</button>
            </div>
          </div>
        )}

        {/* Already Scanned Popup */}
        {alreadyScannedData && (
          <div className="fixed inset-0 flex items-center justify-center z-50 p-4" style={{ background: 'rgba(0,0,0,0.6)' }}>
            <div className="bg-white rounded-2xl p-8 max-w-sm w-full text-center shadow-2xl">
              <div className="confuse">
                <img src="/animation/confuse.gif" alt="Alert" style={{ width: '100px', margin: '0 auto' }} />
              </div>
              <h1 className="text-2xl font-bold text-gray-800 mb-2">Already Scanned</h1>
              <p className="text-gray-600 text-lg">You have already scanned <strong>{alreadyScannedData.qrName}</strong>!</p>
              <button
                onClick={() => setAlreadyScannedData(null)}
                className="bg-red-600 text-white px-10 py-3 rounded-full font-semibold hover:bg-red-700 transition w-full mt-6"
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

        <style jsx>{`
          @keyframes scan {
            0%, 100% { transform: translateY(-100px); }
            50% { transform: translateY(100px); }
          }
        `}</style>
      </div>
    </AuthGuard>
  );
}
