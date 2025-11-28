'use client';
import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { onValue, ref, push, get } from "firebase/database";
import { auth, realtimeDb } from "../../lib/firebase";
import "./map.css";
import AuthGuard from "../../components/authGuard";
import dynamic from "next/dynamic";

// Dynamic import to avoid SSR issues
const MapWithNoSSR = dynamic(() => import("../../components/MapContainerComponent"), { ssr: false });

export default function Home() {
  const [qrList, setQrList] = useState([]);
  const [scannedQRIds, setScannedQRIds] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [scannedData, setScannedData] = useState(null);
  const scannerRef = useRef(null);

  // 1 Fetch QR codes from Firebase
  useEffect(() => {
    const qrRef = ref(realtimeDb, "QR-Data");
    const unsubscribe = onValue(qrRef, snapshot => {
      const data = snapshot.val();
      const qrArray = data ? Object.keys(data).map(key => ({ id: key, ...data[key] })) : [];
      setQrList(qrArray);
    });
    return () => unsubscribe();
  }, []);


  // 2️Fetch scanned QR codes
  useEffect(() => {
    const user = auth.currentUser;
    if (!user) return;

    const statusRef = ref(realtimeDb, "playerStatus");
    const unsubscribe = onValue(statusRef, snapshot => {
      const data = snapshot.val();
      if (!data) {
        setScannedQRIds([]);
        return;
      }

      const username = user.displayName || "guest";
      const records = Object.values(data).filter(item => item.username === username);

      const scannedIds = records.map(r => {
        const matched = qrList.find(q => q.name === r.qrName);
        return matched ? matched.id : null;
      }).filter(Boolean);

      setScannedQRIds(scannedIds);
    });

    return () => unsubscribe();
  }, [qrList]);

  // Scanner logic............
  const startScanner = async () => {
    setScanning(true);
    try {
      const { Html5Qrcode } = await import("html5-qrcode");
      const html5QrCode = new Html5Qrcode("qr-scanner");
      scannerRef.current = html5QrCode;

      await html5QrCode.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 300, height: 300 } },
        async decodedText => {
          const matched = qrList.find(item => item.id === decodedText || item.name === decodedText);
          const qrInfo = matched || { id: decodedText, name: decodedText };
          setScannedData(qrInfo);
          await saveScannedQRCode(qrInfo.name || qrInfo.id, qrInfo.id);
          stopScanner();
        },
        err => console.warn("QR Scan Error:", err)
      );
    } catch (err) {
      console.error("Scanner failed:", err);
      setScanning(false);
    }
  };

  const stopScanner = async () => {
    if (scannerRef.current) {
      await scannerRef.current.stop();
      scannerRef.current.clear();
      scannerRef.current = null;
    }
    setScanning(false);
  };

  
  // Save scanned QR — DUPLICATE-PROOF + SAME STRUCTURE

  const saveScannedQRCode = async (qrName, qrId) => {
    try {
      const user = auth.currentUser;
      if (!user) return;

      const userId = user.uid;

      // Get real username
      const userSnap = await get(ref(realtimeDb, `Users/${userId}`));
      const username = userSnap.val()?.username || user.displayName || "guest";

      // Parse points & clean name (same as before)
      let points = 0;
      let displayQrName = qrName;
      if (qrName.includes("_")) {
        const parts = qrName.split("_");
        points = parseInt(parts.at(-1)) || 0;
        displayQrName = parts.slice(0, -1).join("_");
      } else if (qrName.includes(",")) {
        const parts = qrName.split(",");
        points = parseInt(parts.at(-1)) || 0;
        displayQrName = parts.slice(0, -1).join(",");
      }

      const now = new Date();
      const date = `${now.getMonth() + 1}/${now.getDate()}/${now.getFullYear()}`;
      let hours = now.getHours();
      const minutes = now.getMinutes().toString().padStart(2, "0");
      const ampm = hours >= 12 ? "PM" : "AM";
      hours = hours % 12 || 12;
      const time = `${hours}:${minutes} ${ampm}`;

      const scansRef = ref(realtimeDb, "scannedQRCodes");
      const playerStatusRef = ref(realtimeDb, "playerStatus");

      // CHECK #1: Prevent duplicate in scannedQRCodes
      const scansSnapshot = await get(scansRef);
      const existingScans = scansSnapshot.val() || {};

      const alreadyScanned = Object.values(existingScans).some(scan =>
        scan.userId === userId && scan.qrId === qrId
      );

      if (!alreadyScanned) {
        await push(scansRef, {
          qrName: displayQrName,
          qrId,
          userId,
          username,
          date,
          time,
          points,
          scannedAt: now.toISOString()
        });
      }

      // CHECK #2: Prevent duplicate in playerStatus
      const statusSnapshot = await get(playerStatusRef);
      const existingStatus = statusSnapshot.val() || {};

      const alreadyInStatus = Object.values(existingStatus).some(status =>
        status.username === username && status.qrName === displayQrName
      );

      if (!alreadyInStatus) {
        await push(playerStatusRef, {
          username,
          qrName: displayQrName,
          scannedAt: now.toISOString()
        });
      }

    } catch (err) {
      console.error("Error saving scanned QR:", err);
    }
  };

  const closeScannedPopup = () => setScannedData(null);

  return (
    <AuthGuard>
      <div className="map-container">
        <MapWithNoSSR mapData={qrList} scannedQRIds={scannedQRIds} />

        {scanning && (
          <div className="scanner-overlay">
            <button onClick={stopScanner} className="scanner-close">Close</button>
            <div id="qr-scanner" className="scanner-box" />
          </div>
        )}

        {!scanning && !scannedData && (
          <div className="fixed bottom-4 left-1/2 transform -translate-x-1/2 flex justify-between items-center w-[60%] max-w-md bg-white p-3 rounded-full shadow-lg z-50">

            {/* Leaderboard / Menu */}
            <Link href="/leaderboard" className="cursor-pointer group flex justify-center items-center w-12 h-12 rounded-full transition-colors duration-300 hover:bg-black">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="2"
                fill="none"
                strokeLinecap="round"
                className="text-black group-hover:text-white transition-colors duration-300"
              >
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </Link>

            {/* QR Scanner Button */}
            <div
              onClick={startScanner}
              className="flex justify-center items-center w-16 h-16 bg-red-600 rounded-full shadow-lg cursor-pointer"
            >
              <svg
                width="32"
                height="32"
                viewBox="0 0 24 24"
                stroke="white"
                strokeWidth="2"
                fill="none"
                strokeLinecap="round"
              >
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

            {/* Profile / Home */}
            <Link href="/profile" className="cursor-pointer group flex justify-center items-center w-12 h-12 rounded-full transition-colors duration-300 hover:bg-black">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="2"
                fill="none"
                strokeLinecap="round"
                className="text-black group-hover:text-white transition-colors duration-300"
              >
                <path d="M3 10L12 3L21 10" />
                <path d="M5 10V21H19V10" />
              </svg>
            </Link>

          </div>
        )}

        {scannedData && (
          <div className="result-overlay">
            <div className="result-text">
              <h1>{scannedData.name}</h1>
              {scannedData.description && <p>{scannedData.description}</p>}
              {scannedData.picture && <img src={scannedData.picture} alt={scannedData.name} className="result-image" />}
              <button onClick={closeScannedPopup} className="view-map-btn">View on Map</button>
            </div>
          </div>
        )}
      </div>
    </AuthGuard>
  );
}
