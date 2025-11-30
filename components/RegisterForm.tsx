"use client";

import React, { useState } from "react";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { auth, realtimeDb } from "../lib/firebase";
import { ref, get, update } from "firebase/database";
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

    const trimmedUname = uname.trim();
    const trimmedFname = fname.trim();
    const trimmedLname = lname.trim();
    const trimmedPhone = phone.trim();
    const trimmedEmail = email.trim();
    const nameRegex = /^[A-Za-z]+$/;
    const phoneRegex = /^(98|97)\d{8}$/;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    // Validation
    if (!trimmedUname) {
      toast.error("Username is required.", { position: "top-center" });
      return;
    }

    if (!trimmedFname) {
      toast.error("First name is required.", { position: "top-center" });
      return;
    }

    if (!nameRegex.test(trimmedFname)) {
      toast.error("First name should contain letters only.", { position: "top-center" });
      return;
    }

    if (trimmedLname && !nameRegex.test(trimmedLname)) {
      toast.error("Last name should contain letters only.", { position: "top-center" });
      return;
    }

    if (!trimmedPhone) {
      toast.error("Phone number is required.", { position: "top-center" });
      return;
    }

    if (!phoneRegex.test(trimmedPhone)) {
      toast.error("Phone must start with 98 or 97 and be 10 digits.", {
        position: "top-center",
      });
      return;
    }

    if (!trimmedEmail) {
      toast.error("Email is required.", { position: "top-center" });
      return;
    }

    if (!emailRegex.test(trimmedEmail)) {
      toast.error("Please enter a valid email address.", { position: "top-center" });
      return;
    }

    if (!password) {
      toast.error("Password is required.", { position: "top-center" });
      return;
    }

    if (password.length < 6) {
      toast.error("Password must be at least 6 characters long.", { position: "top-center" });
      return;
    }

    try {
      // 🔍 Check if phone already exists via dedicated index node
      const phoneSnapshot = await get(ref(realtimeDb, `PhoneIndex/${trimmedPhone}`));
      if (phoneSnapshot.exists()) {
        throw new Error("Phone number already registered!");
      }

      // Create user in Firebase Auth
      const userCredential = await createUserWithEmailAndPassword(auth, trimmedEmail, password);
      const user = userCredential.user;

      // Save user + phone index atomically
      // Note: If this fails, the auth user will exist but no profile data will be saved
      // In production, consider adding a Cloud Function to handle cleanup
      const updates = {
        [`Users/${user.uid}`]: {
          username: trimmedUname,
          email: trimmedEmail,
          phone: trimmedPhone,
          firstName: trimmedFname,
          lastName: trimmedLname || "",
          photo: "",
          isGuest: false,
          createdAt: new Date().toISOString(),
          quantity: 0,
          points_earned: 0,
        },
        [`PhoneIndex/${trimmedPhone}`]: user.uid,
      };
      await update(ref(realtimeDb), updates);

      toast.success("User Registered Successfully!", { position: "top-center" });
      window.location.href = "/map";

    } catch (error: any) {
      console.error("❌ Registration failed:", error);
      // Handle Firebase errors and custom errors
      if (error.code === "auth/email-already-in-use") {
        toast.error("This email is already registered!", { position: "top-center" });
      } else if (error.code === "auth/invalid-email") {
        toast.error("Invalid email address!", { position: "top-center" });
      } else if (error.code === "auth/weak-password") {
        toast.error("Password should be at least 6 characters!", { position: "top-center" });
      } else if (error.code === "auth/network-request-failed") {
        toast.error("Network error. Please check your connection and try again.", { position: "top-center" });
      } else if (error.message === "Phone number already registered!") {
        toast.error("Phone number already registered!", { position: "top-center" });
      } else {
        // Custom or other errors
        toast.error(error.message || "Something went wrong! Please try again.", { position: "top-center" });
      }
    }
  }

  return (
    <form className="text-black" onSubmit={handleRegister}>
      <div className="mb-4">
        <label className="block text-sm font-bold text-black mb-2">Username</label>
        <input
          type="text"
          className="w-full px-3 py-2 border text-black border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent mb-4"
          placeholder="Enter your username"
          onChange={(e) => setUname(e.target.value)}
          required
        />
      </div>

      <div className="mb-4">
        <label className="block text-sm font-bold text-black mb-2">First name</label>
        <input
          type="text"
          className="w-full px-3 py-2 border text-black border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent mb-4"
          placeholder="Enter your first name"
          onChange={(e) => setFname(e.target.value)}
          required
        />
      </div>

      <div className="mb-3">
        <label className="block text-sm font-bold text-black mb-2">Last name</label>
        <input
          type="text"
          className="w-full px-3 py-2 border text-black border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent mb-4"
          placeholder="Enter your last name"
          onChange={(e) => setLname(e.target.value)}
        />
      </div>

      <div className="mb-3">
        <label className="block text-sm font-bold text-black mb-2">Phone Number</label>
        <input
          type="text"
          className="w-full px-3 py-2 border text-black border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent mb-4"
          placeholder="Enter your phone number"
          maxLength={10}
          inputMode="numeric"
          onChange={(e) => {
            const value = e.target.value.replace(/[^0-9]/g, "");
            setPhone(value);
          }}
          required
        />
      </div>

      <div className="mb-3">
        <label className="block text-sm font-bold text-black mb-2">Email address</label>
        <input
          type="email"
          className="w-full px-3 py-2 border text-black border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent mb-4"
          placeholder="Enter your email"
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>

      <div className="mb-3">
        <label className="block text-sm font-bold text-black mb-2">Password</label>
        <input
          type="password"
          className="w-full px-3 py-2 border text-black border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent mb-4"
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
        </button>
      </div>

      <p className="forgot-password text-right">
        Already registered? <Link href="/login">Login</Link>
      </p>
    </form>
  );
}
