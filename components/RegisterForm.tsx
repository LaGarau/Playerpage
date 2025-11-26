"use client";

import React, { useState } from "react";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { auth, realtimeDb } from "../lib/firebase";
import { ref, set } from "firebase/database";
import { toast } from "react-toastify";
import Link from "next/link";

export default function RegisterForm() {
  const [uname, setUname] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [fname, setFname] = useState("");
  const [lname, setLname] = useState("");

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    console.log("Attempting to register user:", email);

    try {
      // Create user
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      console.log("✅ Firebase Auth success, user UID:", user.uid);

      // Push to Realtime Database
      const userRef = ref(realtimeDb, `Users/${user.uid}`);
      await set(userRef, {
        username: uname,
        email: user.email,
        phone: user.phoneNumber,
        firstName: fname,
        lastName: lname,
        photo: "",
        isGuest: false,
        createdAt: new Date().toISOString(),
        quantity: 0,
        points_earned: 0,
      });

      console.log("✅ Realtime Database write successful for:", user.uid);

      toast.success("User Registered Successfully!", { position: "top-center" });
      window.location.href = "/map";
    } catch (error: any) {
      console.error(" Realtime Database write failed:", error);
      toast.error(error.message, { position: "bottom-center" });
    }
  }

  return (
    <form onSubmit={handleRegister}>
      <div className="mb-4">
        <label className="block text-sm font-bold text-gray-700 mb-2">Username</label>
        <input
          type="text"
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent mb-4"
          placeholder="Enter your username"
          onChange={(e) => setUname(e.target.value)}
          required
        />
      </div>

      <div className="mb-4">
        <label className="block text-sm font-bold text-gray-700 mb-2">First name</label>
        <input
          type="text"
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent mb-4"
          placeholder="Enter your first name"
          onChange={(e) => setFname(e.target.value)}
          required
        />
      </div>

      <div className="mb-3">
        <label className="block text-sm font-bold text-gray-700 mb-2">Last name</label>
        <input
          type="text"
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent mb-4"
          placeholder="Enter your last name"
          onChange={(e) => setLname(e.target.value)}
        />
      </div>

      <div className="mb-3">
        <label className="block text-sm font-bold text-gray-700 mb-2">Phone Number</label>
        <input
          type="string"
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent mb-4"
          placeholder="Enter your phone number"
          onChange={(e) => setPhone(e.target.value)}
          required
        />
      </div>

      <div className="mb-3">
        <label className="block text-sm font-bold text-gray-700 mb-2">Email address</label>
        <input
          type="email"
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent mb-4"
          placeholder="Enter your email"
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>

      <div className="mb-3">
        <label className="block text-sm font-bold text-gray-700 mb-2">Password</label>
        <input
          type="password"
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent mb-4"
          placeholder="Enter your password"
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>

      <div className="w-full items-center">
        <button
          type="submit"
          className="w-full bg-red-600 hover:bg-red-700 text-white font-medium py-3 px-6 rounded-lg flex items-center justify-center gap-2 transition-colors duration-200"
        >
          <span>Register Here</span>
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
        </button>
      </div>

      <p className="forgot-password text-right">
        Already registered? <Link href="/login">Login</Link>
      </p>
    </form>
  );
}