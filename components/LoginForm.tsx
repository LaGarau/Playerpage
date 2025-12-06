"use client";

import React, { useState } from "react";
import { signInWithEmailAndPassword, signInAnonymously } from "firebase/auth";
import { auth, db } from "../lib/firebase";
import { setDoc, doc } from "firebase/firestore";
import { toast } from "react-toastify";
import { useRouter } from "next/navigation";
import Link from "next/link";
import SignInWithGoogle from "./SignInWithGoogle";

export default function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false); // loading state
  const router = useRouter();

  // --- Guest Login ---
  // const handleGuestLogin = async () => {
  //   try {
  //     const result = await signInAnonymously(auth);
  //     const user = result.user;
  //     if (!user) throw new Error("Failed to create guest user");

  //     // Create/update guest profile in Firestore
  //     await setDoc(
  //       doc(db, "Users", user.uid),
  //       {
  //         email: `guest-${user.uid}@temp.com`,
  //         firstName: "Guest",
  //         lastName: "User",
  //         isGuest: true,
  //         createdAt: new Date().toISOString(),
  //       },
  //       { merge: true }
  //     );

  //     toast.success("Signed in as Guest!", { position: "top-center" });
  //     router.push("/map");
  //   } catch (err: any) {
  //     console.error("Guest Login Error:", err);
  //     toast.error(err.message || "Failed to sign in as Guest", { position: "top-center" });
  //   }
  // };

  // --- Email/Password Login ---
  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();

    if (loading) return; // Prevent duplicate submissions/clicks
    setLoading(true);

    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;
      if (!user) throw new Error("Login failed");

      toast.success("User logged in successfully!", { position: "top-center" });
      router.push("/map");
    } catch (err: any) {
      console.error("Email Login Error:", err);

      // Use a toastId derived from Firebase error code (if available) to avoid duplicate toasts
      const toastId = err?.code || "firebase-auth-error";

      toast.error(err?.message || "Login failed", {
        position: "top-center",
        toastId,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleEmailLogin} >
      {/* Email Input */}
      <div className="mb-3">
        <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
        <input
          type="email"
          autoComplete="username"
          placeholder="Enter your email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full text-black px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          required
          disabled={loading} // optional: disable while loading
        />
      </div>

      {/* Password Input */}
      <div className="mb-3">
        <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
        <input
          type="password"
          autoComplete="current-password"
          placeholder="Enter your password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full text-black px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          required
          disabled={loading}
        />
      </div>

      {/* Login Button */}
      <button
        type="submit"
        className={`w-full bg-black text-white py-2 px-4 rounded-md mb-4 ${loading ? "opacity-70 cursor-wait" : ""}`}
        disabled={loading}
      >
        {loading ? "Logging in..." : "Login"}
      </button>

      {/* <div className="text-center my-3">--Or--</div> */}

      {/* Google Sign-In */}
      {/* <SignInWithGoogle /> */}

      {/* <div className="w-full mt-4">
       
        <button
          type="button"
          onClick={handleGuestLogin}
          className="w-full bg-gray-200 hover:bg-gray-300 text-gray-800 py-2 px-4 rounded-md"
        >
          Try as Guest
        </button>
      </div> */}

      <div className="text-center my-3">--Or--</div>

      {/* Register Link */}
      <Link
        href="/register"
        className="w-full bg-red-600 hover:bg-red-700 text-white py-3 px-6 rounded-lg flex items-center justify-center gap-2 transition-colors duration-200"
      >
        Register Here
      </Link>
    </form>
  );
}

