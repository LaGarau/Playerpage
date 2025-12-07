'use client';

import { useState, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { onValue, ref, push, get, update } from "firebase/database";
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
  const [alreadyScannedData, setAlreadyScannedData] = useState(null);
  const scannerRef = useRef(null);

  // Auth + loader
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

  // Load scanned IDs
  useEffect(() => {
    if (!currentUser) {
      setScannedQRIds(new Set());
      return;
    }

    const scannedRef = ref(realtimeDb, "scannedQRCodes");
    const unsubscribe = onValue(scannedRef, (snapshot) => {
      const data = snapshot.val();
      if (!data) return setScannedQRIds(new Set());

      const userRecords = Object.values(data).filter(
        (item) => item.userId === currentUser.uid
      );

      const ids = new Set();
      userRecords.forEach((record) => {
        const found = qrList.find((q) => {
          const clean = (q.name || "").replace(/[,_]\d+$/, "").trim();
          return clean === record.qrName;
        });
        if (found) ids.add(found.id);
      });
      setScannedQRIds(ids);
    });

    return () => unsubscribe();
  }, [currentUser, qrList]);

  // Add styles for scanner when scanning starts
  useEffect(() => {
    if (scanning) {
      const style = document.createElement('style');
      style.id = 'qr-scanner-styles';
      style.textContent = `
        #qr-scanner video {
          width: 100% !important;
          height: 100% !important;
          object-fit: cover !important;
          border-radius: 12px;
        }
        
        #qr-scanner canvas {
          display: none !important;
        }
        
        .scan-line {
          animation: scan 2s ease-in-out infinite;
        }
        
        @keyframes scan {
          0%, 100% { transform: translateY(-100%); opacity: 0; }
          50% { transform: translateY(100%); opacity: 1; }
        }
        
        .corner-glow {
          box-shadow: 0 0 20px rgba(34, 197, 94, 0.5);
        }
      `;
      document.head.appendChild(style);

      return () => {
        const existingStyle = document.getElementById('qr-scanner-styles');
        if (existingStyle) {
          document.head.removeChild(existingStyle);
        }
      };
    }
  }, [scanning]);

  // Scanner
  const startScanner = async () => {
    if (qrList.length === 0) {
      alert("Loading locations…");
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
        { fps: 10, qrbox: { width: 280, height: 280 } },
        async (decodedText) => {
          const match = decodedText.match(/^(.+?)[,_](\d+)$/);
          const qrName = match ? match[1].trim() : decodedText.trim();
          const points = match ? parseInt(match[2], 10) : 0;

          const matched = qrList.find((q) => {
            const clean = (q.name || "").replace(/[,_]\d+$/, "").trim().toLowerCase();
            return clean === qrName.toLowerCase();
          });

          if (!matched) {
            alert("QR not recognized!");
            return;
          }

          const alreadyScanned = scannedQRIds.has(matched.id);
          if (alreadyScanned) {
            await scanner.stop();
            setScanning(false);
            setAlreadyScannedData({ qrName });
            return;
          }

          // Stop scanner
          await scanner.stop();
          await scanner.clear();
          scannerRef.current = null;
          setScanning(false);

          // Get description
          const descSnap = await get(ref(realtimeDb, `QR-Data/${matched.id}/description`));
          const description = descSnap.exists() ? descSnap.val() : "Explore this spot!";

          // Save scan + update points
          await saveScanned(matched, decodedText, qrName, points);

          // Show success popup
          setScannedData({
            ...matched,
            displayName: qrName,
            points,
            description,
            socialMediaLink: matched.socialMediaLink || "#",
            reviewLink: matched.externalLink || "#",
          });

        },
        () => { }
      );
    } catch (err) {
      alert("Camera access denied");
      setScanning(false);
    }
  };

  const stopScanner = async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
        await scannerRef.current.clear();
      } catch { }
      scannerRef.current = null;
    }
    setScanning(false);
  };

  // Save scan + add points
  const saveScanned = async (qr, originalText, qrName, points) => {
    if (!auth.currentUser) return;

    const userSnap = await get(ref(realtimeDb, `Users/${auth.currentUser.uid}`));
    const username = userSnap.exists() ? userSnap.val().username || "guest" : "guest";

    const now = new Date();
    const date = now.toLocaleDateString('en-US');
    const time = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

    try {
      await push(ref(realtimeDb, "scannedQRCodes"), {
        userId: auth.currentUser.uid,
        username,
        qrId: originalText,
        qrName,
        points,
        date,
        time,
      });

      // Update total points in Users node
      const userRef = ref(realtimeDb, `Users/${auth.currentUser.uid}`);
      const snap = await get(userRef);
      if (snap.exists()) {
        const data = snap.val();
        await update(userRef, {
          totalPoints: (data.totalPoints || 0) + points,
          qrScanned: (data.qrScanned || 0) + 1,
          lastUpdated: new Date().toISOString(),
        });
      }
    } catch (err) {
      console.error("Save failed:", err);
    }
  };

  if (!ready) return <LoaderTimer />;

  return (
    <AuthGuard>
      <div className="relative h-screen w-full overflow-hidden">
        <MapWithNoSSR
          qrList={qrList}
          scannedQRIds={scannedQRIds}
          scanning={scanning}
          scannedData={scannedData}
          startScanner={startScanner}
        />

        {/* Scanner overlay */}
        {scanning && (
          <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black bg-opacity-95 p-4">
            <h2 className="text-white text-xl sm:text-2xl font-semibold mb-6">
              Position QR code within frame
            </h2>

            {/* Scanner Box */}
            <div className="relative w-full max-w-[350px] aspect-square">
              {/* Scanner container with proper sizing */}
              <div 
                id="qr-scanner" 
                className="absolute inset-0 w-full h-full rounded-xl overflow-hidden bg-gray-900"
              />

              {/* Animated scanning line */}
              <div className="absolute inset-0 overflow-hidden rounded-xl pointer-events-none">
                <div className="scan-line absolute inset-x-0 h-1 bg-gradient-to-r from-transparent via-green-400 to-transparent"></div>
              </div>

              {/* Corner overlays with glow effect */}
              <div className="absolute top-0 left-0 w-12 h-12 border-t-4 border-l-4 border-green-400 rounded-tl-xl corner-glow"></div>
              <div className="absolute top-0 right-0 w-12 h-12 border-t-4 border-r-4 border-green-400 rounded-tr-xl corner-glow"></div>
              <div className="absolute bottom-0 left-0 w-12 h-12 border-b-4 border-l-4 border-green-400 rounded-bl-xl corner-glow"></div>
              <div className="absolute bottom-0 right-0 w-12 h-12 border-b-4 border-r-4 border-green-400 rounded-br-xl corner-glow"></div>

              {/* Grid overlay for better alignment */}
              <div className="absolute inset-0 pointer-events-none">
                <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 opacity-20">
                  {[...Array(9)].map((_, i) => (
                    <div key={i} className="border border-white"></div>
                  ))}
                </div>
              </div>
            </div>

            {/* Instructions */}
            <p className="text-gray-300 text-sm mt-4 text-center max-w-xs">
              Align the QR code within the frame. It will scan automatically.
            </p>

            {/* Close Button */}
            <button
              onClick={stopScanner}
              className="mt-8 px-10 py-3 bg-red-500 text-white text-lg font-semibold rounded-full hover:bg-red-600 transition-all transform hover:scale-105 shadow-lg"
            >
              Close Scanner
            </button>
          </div>
        )}

        {/* SUCCESS POPUP (with links) */}
        {scannedData && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
            <div className="bg-white rounded-3xl p-8 max-w-lg w-full text-center shadow-2xl">
              <img src="/animation/cheer.gif" alt="Success" className="w-40 h-40 mx-auto mb-4" />

              <h1 className="text-3xl font-bold text-gray-800 mb-3">{scannedData.displayName}</h1>

              <p className="text-5xl font-extrabold text-green-600 mb-2">+{scannedData.points} points</p>

              <p className="text-red-600 font-bold text-lg mb-6">
                Scan all QR codes to unlock your prize!
              </p>

              <div className="space-y-4">
                {scannedData.socialMediaLink && (
                  <a
                    href={scannedData.socialMediaLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block w-full py-4 bg-gradient-to-r from-purple-600 to-pink-600 text-white font-bold text-lg rounded-2xl shadow-lg"
                  >
                    Follow Us on Social Media
                  </a>
                )}

                {scannedData.reviewLink && (
                  <a
                    href={scannedData.reviewLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block w-full py-4 bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-bold text-lg rounded-2xl shadow-lg"
                  >
                    Give us a Review
                  </a>
                )}
              </div>

              <button
                onClick={() => setScannedData(null)}
                className="mt-8 w-full py-4 bg-green-600 text-white text-xl font-bold rounded-2xl"
              >
                Continue Exploring
              </button>
            </div>
          </div>
        )}

        {/* Already scanned */}
        {alreadyScannedData && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
            <div className="bg-white rounded-2xl p-8 max-w-sm w-full text-center shadow-2xl">
              <img src="/animation/confuse.gif" alt="Already scanned" className="w-28 h-28 mx-auto mb-4" />
              <h2 className="text-2xl font-bold mb-3">Already Scanned!</h2>
              <p className="text-gray-600 mb-6">
                You've already discovered <strong>{alreadyScannedData.qrName}</strong>
              </p>
              <button
                onClick={() => setAlreadyScannedData(null)}
                className="w-full py-3 bg-red-600 text-white font-bold rounded-xl"
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
