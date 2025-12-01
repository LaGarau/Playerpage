// app/map/page.js
'use client';

import { useState, useEffect, useRef } from "react";  // ← useRef was missing!
import Link from "next/link";
import dynamic from "next/dynamic";
import { onValue, ref } from "firebase/database";
import { auth, realtimeDb } from "../../lib/firebase";
import AuthGuard from "../../components/authGuard";

// Dynamic import – no SSR
const MapWithNoSSR = dynamic(() => import("../../components/MapContainerComponent"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-screen flex items-center justify-center bg-gray-100">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-4 border-red-600 mx-auto mb-4"></div>
        <p className="text-gray-700 font-medium">Loading map...</p>
      </div>
    </div>
  ),
});

export default function Home() {
  const [qrList, setQrList] = useState([]);
  const [scannedQRIds, setScannedQRIds] = useState(new Set());
  const [scanning, setScanning] = useState(false);
  const [scannedData, setScannedData] = useState(null);
  const scannerRef = useRef(null);  // ← Now properly imported

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
    const user = auth.currentUser;
    if (!user) return;

    const username = user.displayName || "guest";
    const statusRef = ref(realtimeDb, "playerStatus");

    const unsubscribe = onValue(statusRef, (snapshot) => {
      const data = snapshot.val();
      if (!data) {
        setScannedQRIds(new Set());
        return;
      }

      const userRecords = Object.values(data).filter(
        (item) => item.username === username
      );

      const scanned = new Set(
        userRecords
          .map((r) => {
            const cleanName = r.qrName.replace(/[,_]\d+$/, "").trim();
            return qrList.find((q) => {
              const qClean = (q.name || "").replace(/[,_]\d+$/, "").trim();
              return qClean === cleanName;
            })?.id;
          })
          .filter(Boolean)
      );

      setScannedQRIds(scanned);
    });

    return () => unsubscribe();
  }, [qrList]);

  // QR Scanner
  const startScanner = async () => {
    setScanning(true);
    try {
      const { Html5Qrcode } = await import("html5-qrcode");
      const scanner = new Html5Qrcode("qr-reader");
      scannerRef.current = scanner;

      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 280, height: 280 } },
        async (decodedText) => {
          const matched = qrList.find(
            (q) => q.id === decodedText || q.name === decodedText
          );
          if (matched) {
            setScannedData(matched);
            await saveScanned(matched);
          }
          stopScanner();
        },
        () => {}
      );
    } catch (err) {
      alert("Camera not available");
      setScanning(false);
    }
  };

  const stopScanner = async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
        scannerRef.current.clear();
      } catch {}
      scannerRef.current = null;
    }
    setScanning(false);
  };

  const saveScanned = async (qr) => {
    const user = auth.currentUser;
    if (!user) return;

    const username = user.displayName || "guest";
    const cleanName = (qr.name || "").replace(/[,_]\d+$/, "").trim();

    const { push, ref } = await import("firebase/database");
    await push(ref(realtimeDb, "playerStatus"), {
      username,
      qrName: cleanName,
      scannedAt: new Date().toISOString(),
    });
  };

  return (
    <AuthGuard>
      <div className="relative h-screen w-full overflow-hidden">
        <MapWithNoSSR qrList={qrList} scannedQRIds={scannedQRIds} />

        {/* Scanner Overlay */}
        {scanning && (
          <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/80">
            <div className="relative w-80 h-80 bg-black rounded-2xl overflow-hidden">
              <div id="qr-reader" className="w-full h-full" />
              <div className="absolute inset-0 pointer-events-none">
                <div className="absolute top-0 left-0 w-16 h-16 border-t-8 border-l-8 border-white rounded-tl-3xl" />
                <div className="absolute top-0 right-0 w-16 h-16 border-t-8 border-r-8 border-white rounded-tr-3xl" />
                <div className="absolute bottom-0 left-0 w-16 h-16 border-b-8 border-l-8 border-white rounded-bl-3xl" />
                <div className="absolute bottom-0 right-0 w-16 h-16 border-b-8 border-r-8 border-white rounded-br-3xl" />
              </div>
            </div>
            <button
              onClick={stopScanner}
              className="mt-8 px-8 py-3 bg-white text-black rounded-full font-bold text-lg"
            >
              Close Scanner
            </button>
          </div>
        )}

        {/* Scanned Popup */}
        {scannedData && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div className="bg-white rounded-2xl p-8 max-w-sm w-full text-center">
              <h1 className="text-3xl font-bold mb-3">{scannedData.name}</h1>
              {scannedData.description && <p className="text-gray-700 mb-4">{scannedData.description}</p>}
              {scannedData.picture ? (
                <img src={scannedData.picture} alt={scannedData.name} className="w-full rounded-lg mb-6" />
              ) : (
                <div className="bg-gray-200 border-2 border-dashed rounded-xl w-full h-48 mb-6" />
              )}
              <button
                onClick={() => setScannedData(null)}
                className="bg-black text-white px-8 py-3 rounded-full font-bold"
              >
                Close
              </button>
            </div>
          </div>
        )}

        {/* Bottom Bar */}
        {!scanning && !scannedData && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 flex gap-12 bg-white px-6 py-4 rounded-full shadow-2xl z-40">
            <Link href="/leaderboard" className="p-3 rounded-full hover:bg-gray-100 transition">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </Link>

            <button
              onClick={startScanner}
              className="w-16 h-16 bg-red-600 rounded-full flex items-center justify-center shadow-lg hover:bg-red-700 transition"
            >
              <svg className="w-9 h-9 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m6-8h2M7 7h10M5 5h14" />
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" strokeWidth="2" />
              </svg>
            </button>

            <Link href="/profile" className="p-3 rounded-full hover:bg-gray-100 transition">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </Link>
          </div>
        )}
      </div>
    </AuthGuard>
  );
}