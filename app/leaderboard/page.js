"use client";

import localFont from 'next/font/local';
import { realtimeDb, auth } from '../../lib/firebase';
import { ref, onValue } from 'firebase/database';
import { onAuthStateChanged } from 'firebase/auth';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

const droid1997 = localFont({
  src: '../../public/fonts/Droid1997.otf',
  display: 'swap',
});


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

      // Assign ranks dynamically based on sorted position
      const rankedPlayers = sorted.map((player, index) => ({
        ...player,
        rank: index + 1
      }));

      setLeaderboardData(rankedPlayers);
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
    <div className="h-screen bg-white flex flex-col overflow-hidden">
      <div className="flex-shrink-0 px-4 pt-6 pb-4">
        <div className="max-w-md mx-auto">
          {/* Header with Close Button */}
          <div className="relative">
            <button
              onClick={() => router.back()}
              className="absolute right-0 top-0 text-black text-5xl font-light leading-none hover:opacity-70 transition"
            >
              ×
            </button>
            
            <div className="text-left pr-12">
              <h1 className={`${droid1997.className} text-7xl text-gray-900 tracking-widest mb-3`}>
                LEADERBOARD
              </h1>
              <p className="text-gray-600 text-sm font-medium">
                Ranked by Points | Ties broken by fastest time
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Scrollable Content Area */}
      <div className="flex-1 overflow-y-auto px-4 pb-6">
        <div className="max-w-md mx-auto">
          {/* Main White Card */}
          <div className="bg-white rounded-3xl shadow-md overflow-hidden px-5 py-6">
            
            {/* All Players including Current User */}
            {leaderboardData.map((player, index) => {
              const isCurrentUser = player.id === currentUser?.uid;
              
              return (
                <div key={player.id}>
                  <div className={`flex items-center gap-4 py-3 -mx-5 px-5 rounded-2xl ${isCurrentUser ? 'bg-blue-100 border-2 border-blue-300' : ''}`}>
                    {/* Rank/Medal */}
                    <div className="w-12 flex-shrink-0 flex items-center justify-center">
                      {player.rank === 1 && <span className="text-3xl">🥇</span>}
                      {player.rank === 2 && <span className="text-3xl">🥈</span>}
                      {player.rank === 3 && <span className="text-3xl">🥉</span>}
                      {player.rank > 3 && (
                        <span className="text-xl font-bold text-gray-800">
                          {player.rank}
                        </span>
                      )}
                    </div>

                    {/* Username */}
                    <div className="flex-1 min-w-0">
                      <p className="text-lg font-semibold text-black truncate">
                        {player.username}
                        {isCurrentUser && (
                          <span className="text-gray-500 font-normal ml-1">(You)</span>
                        )}
                      </p>
                    </div>

                    {/* Points and Time */}
                    <div className="text-right flex-shrink-0">
                      <p className={`${droid1997.className} text-4xl text-black tracking-wide leading-none mb-0.5`}>
                        {player.points}
                      </p>
                      <p className="text-xs text-gray-500">
                        {player.time_taken}
                      </p>
                    </div>
                  </div>

                  {/* Divider - don't show after last item */}
                  {index < leaderboardData.length - 1 && (
                    <div className="border-b border-gray-200"></div>
                  )}
                </div>
              );
            })}

          </div>
        </div>
      </div>
    </div>
  );
}
