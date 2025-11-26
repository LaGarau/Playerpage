'use client';
import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { onValue, ref, push, get } from "firebase/database";
import { auth, realtimeDb } from "../../lib/firebase";
import "./map.css";
import AuthGuard from "../../components/authGuard";
import { FaQrcode } from "react-icons/fa";
import dynamic from "next/dynamic";

// Dynamic import to avoid SSR issues
const MapWithNoSSR = dynamic(() => import("../../components/MapContainerComponent"), { ssr: false });

export default function Home() {
  const [qrList, setQrList] = useState([]);
  const [scannedQRIds, setScannedQRIds] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [scannedData, setScannedData] = useState(null);
  const scannerRef = useRef(null);

  // -----------------------------
  // 1️⃣ Fetch QR codes from Firebase
  // -----------------------------
  useEffect(() => {
    const qrRef = ref(realtimeDb, "QR-Data");
    const unsubscribe = onValue(qrRef, snapshot => {
      const data = snapshot.val();
      const qrArray = data ? Object.keys(data).map(key => ({ id: key, ...data[key] })) : [];
      setQrList(qrArray);
    });
    return () => unsubscribe();
  }, []);

  // -----------------------------
  // 2️⃣ Fetch scanned QR codes
  // -----------------------------
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

  // -----------------------------
  // 3️⃣ Scanner logic
  // -----------------------------
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

  // -----------------------------
  // 4️⃣ Save scanned QR
  // -----------------------------
  const saveScannedQRCode = async (qrName, qrId) => {
    try {
      const user = auth.currentUser;
      if (!user) return;

      const scansRef = ref(realtimeDb, "scannedQRCodes");
      const playerStatusRef = ref(realtimeDb, "playerStatus");

      const snapshot = await get(scansRef);
      const existing = snapshot.val();

      const alreadyScanned = existing && Object.values(existing).some(
        scan => scan.qrId === qrId && scan.userId === user.uid
      );
      if (alreadyScanned) return;

      // Get username
      const getUsername = async uid => {
        return new Promise(resolve => {
          const userRef = ref(realtimeDb, `Users/${uid}`);
          onValue(userRef, snap => resolve(snap.val()?.username || "guest"), { onlyOnce: true });
        });
      };
      const username = await getUsername(user.uid);

      // Points parsing
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
      const date = `${now.getMonth()+1}/${now.getDate()}/${now.getFullYear()}`;
      let hours = now.getHours();
      const minutes = now.getMinutes().toString().padStart(2,"0");
      const ampm = hours >= 12 ? "PM" : "AM";
      hours = hours % 12 || 12;
      const time = `${hours}:${minutes} ${ampm}`;

      await push(scansRef, { qrName: displayQrName, qrId, userId: user.uid, username, date, time, points });
      await push(playerStatusRef, { username, qrName: displayQrName });
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
          <div className="center-btn flex items-center gap-3">
            <Link href="/leaderboard" className="bg-yellow-600 text-white px-4 py-2 rounded shadow hover:bg-yellow-500 transition">Leaderboard</Link>
            <div onClick={startScanner} className="scanner-btn">
              <FaQrcode size={40} color="#fff" />
            </div>
            <Link href="/profile" className="bg-black text-white px-4 py-2 rounded shadow hover:bg-white hover:text-black transition">Profile</Link>
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
