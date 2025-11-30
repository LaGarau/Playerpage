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

  // Fetch QR codes from Firebase
  useEffect(() => {
    const qrRef = ref(realtimeDb, "QR-Data");
    const unsubscribe = onValue(qrRef, snapshot => {
      const data = snapshot.val();
      const qrArray = data ? Object.keys(data).map(key => ({ id: key, ...data[key] })) : [];
      setQrList(qrArray);
    });
    return () => unsubscribe();
  }, []);

  // Fetch already scanned QR codes
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

  // Start QR Scanner
  const startScanner = async () => {
    setScanning(true);
    try {
      const { Html5Qrcode } = await import("html5-qrcode");
      const html5QrCode = new Html5Qrcode("qr-scanner");
      scannerRef.current = html5QrCode;

      const config = {
        fps: 10,
        qrbox: { width: 250, height: 250 },
        aspectRatio: 1,
        facingMode: "environment"
      };

      await html5QrCode.start(
        { facingMode: "environment" },
        config,
        async (decodedText) => {
          const matched = qrList.find(item => item.id === decodedText || item.name === decodedText);
          const qrInfo = matched || { id: decodedText, name: decodedText };
          setScannedData(qrInfo);
          await saveScannedQRCode(qrInfo.name || qrInfo.id, qrInfo.id);
          stopScanner();
        },
        (error) => {
          // Optional: log scan errors (normal during idle scanning)
          // console.warn("Scan error (normal):", error);
        }
      );
    } catch (err) {
      console.error("Failed to start scanner:", err);
      alert("Camera access denied or not available.");
      setScanning(false);
    }
  };

  // Stop Scanner Safely
  const stopScanner = async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
        scannerRef.current.clear();
      } catch (err) {
        console.warn("Error stopping scanner:", err);
      }
      scannerRef.current = null;
    }
    setScanning(false);
  };

  // Save Scanned QR (with duplicate protection)
  const saveScannedQRCode = async (qrName, qrId) => {
    try {
      const user = auth.currentUser;
      if (!user) return;

      const userId = user.uid;
      const userSnap = await get(ref(realtimeDb, `Users/${userId}`));
      const username = userSnap.val()?.username || user.displayName || "guest";

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
      const hours = now.getHours() % 12 || 12;
      const minutes = now.getMinutes().toString().padStart(2, "0");
      const time = `${hours}:${minutes} ${now.getHours() >= 12 ? "PM" : "AM"}`;

      const scansRef = ref(realtimeDb, "scannedQRCodes");
      const playerStatusRef = ref(realtimeDb, "playerStatus");

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

        {/* QR Scanner Overlay - Beautiful L-shaped corners */}
        {scanning && (
          <div className="scanner-overlay">
            <div className="overlay-bg"></div>

            <div className="scanner-container">
              <div className="scanner-box">
                {/* THIS IS REQUIRED: Camera feed goes here */}
                <div id="qr-scanner"></div>

                {/* L-shaped corners (on top of video) */}
                <div className="corner top-left"></div>
                <div className="corner top-right"></div>
                <div className="corner bottom-left"></div>
                <div className="corner bottom-right"></div>

                {/* Animated green scan line */}
                <div className="scan-line"></div>
              </div>


              <button onClick={stopScanner} className="scanner-close">
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

            {/* QR Scanner Button */}
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

        {/* Scanned Result Popup */}
        {scannedData && (
          <div className="fixed inset-0 flex items-center justify-center z-50 p-4"
          style={{background:'rgba(0,0,0,0.4)'}}>
            <div className="bg-white rounded-2xl p-8 max-w-sm w-full text-center">
              <h1 className="text-black font-bold mb-3">{scannedData.name}</h1>
              {scannedData.description && <p className="text-black mb-4">{scannedData.description}</p>}
              {scannedData.picture && <img src={scannedData.picture} alt={scannedData.name} className="w-full rounded-lg mb-6" />}
              <button
                onClick={closeScannedPopup}
                className="bg-black text-white px-8 py-3 rounded-full font-semibold hover:bg-gray-800 transition"
              >
                close
              </button>
            </div>
          </div>
        )}
      </div>


    </AuthGuard>
  );
}
