"use client";

import Image from 'next/image';
import defaultAvatar from '../../public/images/avatar.png';
import { realtimeDb, auth } from '../../lib/firebase';
import { ref, onValue } from 'firebase/database';
import { onAuthStateChanged } from 'firebase/auth';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation'; // ← Added for redirect

export default function Leaderboard() {
  const [leaderboardData, setLeaderboardData] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authChecked, setAuthChecked] = useState(false); // ← New: track auth state check
  const router = useRouter(); // ← Added

  // Check authentication first
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (!user) {
        router.push('/login'); // Redirect to login if not authenticated
        return;
      }
      setCurrentUser(user);
      setAuthChecked(true); // Allow leaderboard to load only if logged in
    });
    return () => unsubscribe();
  }, [router]);

  // Track logged-in user
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
    });
    return () => unsubscribe();
  }, []);

  // Fetch leaderboard only after auth is confirmed
  useEffect(() => {
    if (!authChecked) return; // Wait until we know user is logged in

    const leaderboardRef = ref(realtimeDb, "playerleaderboards");

    const unsubscribe = onValue(leaderboardRef, (snapshot) => {
      const data = snapshot.val();

      if (!data) {
        setLeaderboardData([]);
        setLoading(false);
        return;
      }

      const players = Object.keys(data).map((uid) => ({
        id: uid,
        rank: Number(data[uid].rank),
        username: data[uid].player_name,
        time_taken: data[uid].formatted_time_span || "—",
        points: Number(data[uid].total_points) || 0,
        profile_image: data[uid].profile_image || null,
      }));

      // Sort by points → then fastest time
      const sorted = players.sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points;
        const parseTime = (t) => {
          if (!t || t === "—") return Infinity;
          const h = t.includes("h") ? parseInt(t.split("h")[0]) : 0;
          const m = t.includes("m") ? parseInt(t.split("m")[0].split(" ").pop() || "0") : 0;
          return h * 60 + m;
        };
        return parseTime(a.time_taken) - parseTime(b.time_taken);
      });

      setLeaderboardData(sorted);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [authChecked]);

  // Show loading until auth + data is ready
  if (!authChecked || loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-xl text-gray-600">Loading rankings...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-6 px-3 sm:px-6">
      <div className="max-w-6xl mx-auto">
       <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="text-center sm:text-left flex-1 sm:flex-none">
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Leaderboard</h1>
          <p className="text-gray-500 mt-2 font-bold text-sm sm:text-base">
            Ranked by Points • Ties broken by Fastest Time
          </p>
        </div>

        {/* Go Back Button - Visible only on sm+ */}
        <button
          onClick={() => router.back()}
          className="hidden sm:flex items-center gap-2 bg-gray-800 hover:bg-gray-900 text-white px-4 py-2 rounded-xl font-semibold transition cursor-pointer"
        >
          Go Back
        </button>
      </div>

        <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
          {/* Desktop Header */}
          <div className="hidden sm:grid grid-cols-12 gap-4 px-6 py-4 bg-gray-100 text-xs font-bold text-gray-600 uppercase tracking-wider">
            <div className="col-span-1">Rank</div>
            <div className="col-span-5">Username</div>
            <div className="col-span-3 text-center">Time Taken</div>
            <div className="col-span-3 text-right">Points Earned</div>
          </div>

          <div className="divide-y divide-gray-200">
            {leaderboardData.map((player) => {
              const isYou = currentUser?.uid === player.id;
              const avatarSrc = player.profile_image || defaultAvatar;

              return (
                <div
                  key={player.id}
                  className={`px-4 sm:px-6 py-5 transition-all grid grid-cols-12 sm:items-center gap-y-3 sm:gap-4 
                    ${isYou ? "bg-blue-50 border-l-4 border-blue-500" : "hover:bg-gray-50"}`}
                >
                  {/* Rank */}
                  <div className="col-span-12 sm:col-span-1 flex sm:block items-center gap-2 sm:gap-0">
                    {player.rank <= 3 ? (
                      <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-white shadow-md 
                          ${player.rank === 1 ? "bg-yellow-500" : player.rank === 2 ? "bg-gray-400" : "bg-orange-600"}`}
                      >
                        {player.rank}
                      </div>
                    ) : (
                      <span className="text-gray-700 font-bold text-base sm:text-lg">#{player.rank}</span>
                    )}
                  </div>

                  {/* Username + Avatar */}
                  <div className="col-span-12 sm:col-span-5 flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full overflow-hidden border-2 border-gray-300">
                      <Image
                        src={avatarSrc}
                        alt={player.username}
                        width={40}
                        height={40}
                        className="w-full h-full object-cover"
                        unoptimized
                      />
                    </div>
                    <div className="flex items-center gap-2 text-sm sm:text-base">
                      <span className="font-semibold text-gray-900">{player.username}</span>
                      {player.rank === 1 && <span>🏆</span>}
                      {isYou && <span className="text-blue-600 font-bold">(You)</span>}
                    </div>
                  </div>

                  {/* Time Taken */}
                  <div className="col-span-6 sm:col-span-3 text-gray-700 font-mono font-medium text-sm sm:text-base sm:text-center">
                    ⏱ {player.time_taken}
                  </div>

                  {/* Points */}
                  <div className="col-span-6 sm:col-span-3 text-right text-gray-900 font-bold text-base sm:text-lg">
                    ⭐ {player.points.toLocaleString()}
                  </div>
                </div>
              );
            })}
          </div>

        </div>
      </div>
    </div>
  );
}