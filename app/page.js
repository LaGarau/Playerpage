"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { auth } from "../lib/firebase";


export default function Home() {
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const unsub = auth.onAuthStateChanged((user) => {
      if (user) {
        window.location.href = "/profile";
      } else {
        setChecking(false);
      }
    });
    return () => unsub();
  }, []);

  if (checking) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  return (
    <div className="min-h-screen flex flex-col items-center">
      <div className="flex items-center justify-center pt-8 pb-4 gap-4">
        
        <img className="w-[200px]" src="/images/Transparent Ghumante Logo.png" alt="Logo" />
      </div>
      <div className="flex flex-col items-center gap-0.5 pt-40 pb-4">
        <h2 className="text-sm text-black font-semibold tracking-wide">Created By</h2>
        <img className="w-[160px]" src="/images/blacklogo.png" alt="Initial Funding Sponsor" />
      </div>
      <div>
        <div className="w-full pt-10">
        <Link href="/login" className="w-full bg-red-600 hover:bg-red-700 text-white font-medium py-4 px-12 rounded-lg flex items-center justify-center gap-2 transition-colors duration-200">
          <span>Get Started</span>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            className="w-6 h-6"
          >
            <path
              fillRule="evenodd"
              d="M16.72 7.72a.75.75 0 0 1 1.06 0l3.75 3.75a.75.75 0 0 1 0 1.06l-3.75 3.75a.75.75 0 1 1-1.06-1.06l2.47-2.47H3a.75.75 0 0 1 0-1.5h16.19l-2.47-2.47a.75.75 0 0 1 0-1.06Z"
              clipRule="evenodd"
            />
          </svg>
        </Link>
      </div>
      </div>
    </div>
  );
}
