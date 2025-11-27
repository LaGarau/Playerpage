"use client";

import React, { useEffect, useState } from "react";
import { auth, realtimeDb } from "../../lib/firebase";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { ref, get } from "firebase/database";
import { useRouter } from "next/navigation";

type UserDetails = {
  email?: string;
  firstName?: string;
  lastName?: string;
  photo?: string;
};

// Helper functions outside component to avoid Turbopack issues
const fetchProfile = async (uid: string, setUserDetails: any, setError: any, setOffline: any, setLoading: any) => {
  try {
    const userRef = ref(realtimeDb, `Users/${uid}`);
    const snapshot = await get(userRef);
    if (snapshot.exists()) {
      setUserDetails(snapshot.val());
      setError(null);
    } else {
      setError("User profile not found.");
    }
  } catch (e: any) {
    console.error(e);
    setError("You are offline — reconnect to view your profile.");
    setOffline(true);
  } finally {
    setLoading(false);
  }
};

const fetchTotals = async (uid: string, setTotalPoints: any, setTotalScanned: any) => {
  try {
    const scansRef = ref(realtimeDb, "scannedQRCodes");
    const snapshot = await get(scansRef);
    if (snapshot.exists()) {
      const allScans = snapshot.val();
      const uniqueQRs = new Map<string, number>();

      Object.values(allScans).forEach((scan: any) => {
        if (scan.userId === uid && !uniqueQRs.has(scan.qrName)) {
          uniqueQRs.set(scan.qrName, scan.points || 0);
        }
      });

      const points = Array.from(uniqueQRs.values()).reduce((a, b) => a + b, 0);

      setTotalPoints(points);
      setTotalScanned(uniqueQRs.size);
    } else {
      setTotalPoints(0);
      setTotalScanned(0);
    }
  } catch (err) {
    console.error("Failed to fetch totals:", err);
  }
};

export default function ProfilePage() {
  const [userDetails, setUserDetails] = useState<UserDetails | null>(null);
  const [totalPoints, setTotalPoints] = useState(0);
  const [totalScanned, setTotalScanned] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(!navigator.onLine);
  const router = useRouter();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (!user) {
        setError("Please log in to view your profile.");
        setLoading(false);
        return;
      }
      fetchProfile(user.uid, setUserDetails, setError, setOffline, setLoading);
      fetchTotals(user.uid, setTotalPoints, setTotalScanned);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const onOnline = () => {
      setOffline(false);
      setError(null);
      const user = auth.currentUser;
      if (user) {
        fetchProfile(user.uid, setUserDetails, setError, setOffline, setLoading);
        fetchTotals(user.uid, setTotalPoints, setTotalScanned);
      }
    };
    const onOffline = () => {
      setOffline(true);
      setError("You are offline — reconnect to view your profile.");
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  const handleRetry = async () => {
    const user = auth.currentUser;
    if (user) {
      setLoading(true);
      await fetchProfile(user.uid, setUserDetails, setError, setOffline, setLoading);
      await fetchTotals(user.uid, setTotalPoints, setTotalScanned);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    router.push("/login");
  };

  const handleClose = () => {
    router.push("/map");
  };

  if (loading)
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-black via-gray-900 to-gray-800 text-white">
        Loading...
      </div>
    );

  if (offline || error)
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-black via-gray-900 to-gray-800 text-white p-6">
        <h2 className="text-2xl font-bold mb-4 text-center">Connection Issue</h2>
        <p className="text-center mb-4">{error}</p>
        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={handleRetry}
            className="px-4 py-2 bg-white text-black rounded-lg font-semibold hover:bg-gray-200 transition"
          >
            Retry
          </button>
          <button
            onClick={() => router.push("/login")}
            className="px-4 py-2 border border-white rounded-lg hover:bg-white hover:text-black transition"
          >
            Go to Login
          </button>
          <button
            onClick={() => location.reload()}
            className="px-4 py-2 border border-white rounded-lg hover:bg-white hover:text-black transition"
          >
            Hard Reload
          </button>
        </div>
      </div>
    );

  return (
    <div className="min-h-screen bg-gradient-to-br from-white via-white-900 to-white-800 text-white flex flex-col items-center p-4 sm:p-10">
      <h1 className="text-2xl sm:text-3xl font-bold mb-6 text-center">Your Profile</h1>

      <div className="bg-gray-900/80 backdrop-blur-md rounded-2xl p-4 sm:p-8 w-full max-w-md shadow-xl flex flex-col items-center border border-gray-700">
        {/* Profile Picture */}
        <div className="relative mb-4">
          <img
            src={userDetails?.photo || "/images/maskot.png"}
            alt="Profile"
            className="w-24 h-24 sm:w-32 sm:h-32 rounded-full object-cover border-4 border-gradient-to-br from-purple-500 to-pink-500 p-1"
          />
          <div className="absolute bottom-0 right-0 bg-green-500 w-4 h-4 sm:w-5 sm:h-5 rounded-full border-2 border-gray-900"></div>
        </div>

        {/* Name & Email */}
        <h2 className="text-xl sm:text-2xl font-semibold mb-1 text-center">
          {userDetails?.firstName} {userDetails?.lastName}
        </h2>
        <p className="text-gray-300 mb-4 sm:mb-6 text-center text-sm sm:text-base">{userDetails?.email}</p>

        {/* Totals Card */}
        <div className="flex flex-col sm:flex-row justify-around w-full mb-6 gap-2 sm:gap-4">
          <div className="bg-gray-800 rounded-lg p-3 sm:p-4 flex flex-col items-center w-full sm:w-1/2 hover:bg-purple-900 transition">
            <span className="text-gray-300 text-sm sm:text-base">Total Points</span>
            <span className="text-xl sm:text-2xl font-bold">{totalPoints}</span>
          </div>
          <div className="bg-gray-800 rounded-lg p-3 sm:p-4 flex flex-col items-center w-full sm:w-1/2 hover:bg-pink-900 transition">
            <span className="text-gray-300 text-sm sm:text-base">QR Scanned</span>
            <span className="text-xl sm:text-2xl font-bold">{totalScanned}</span>
          </div>
        </div>

        {/* Buttons */}
        <div className="flex flex-col sm:flex-row gap-3 w-full justify-center sm:justify-end">
          <button
            onClick={handleLogout}
            className="bg-red-600 hover:bg-red-700 text-white px-5 py-2 rounded-xl font-semibold shadow-md transition w-full sm:w-auto"
          >
            Logout
          </button>
          <button
            onClick={handleClose}
            className="bg-gray-300 text-black px-5 py-2 rounded-xl font-semibold shadow-md hover:bg-gray-500 hover:text-white transition w-full sm:w-auto"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
