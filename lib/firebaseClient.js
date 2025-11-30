"use client";

import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import {
  enableIndexedDbPersistence,
  clearIndexedDbPersistence,
  initializeFirestore,
} from "firebase/firestore";
import { getDatabase } from "firebase/database";

// Validate environment variables
const requiredEnvVars = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// Check for missing environment variables
const missingVars = Object.entries(requiredEnvVars)
  .filter(([key, value]) => !value)
  .map(([key]) => `NEXT_PUBLIC_FIREBASE_${key.toUpperCase()}`);

if (missingVars.length > 0) {
  throw new Error(
    `Missing required Firebase environment variables: ${missingVars.join(", ")}\n` +
    `Please check your .env.local file or environment configuration.`
  );
}

const firebaseConfig = {
  apiKey: requiredEnvVars.apiKey,
  authDomain: requiredEnvVars.authDomain,
  databaseURL: requiredEnvVars.databaseURL,
  projectId: requiredEnvVars.projectId,
  storageBucket: requiredEnvVars.storageBucket,
  messagingSenderId: requiredEnvVars.messagingSenderId,
  appId: requiredEnvVars.appId,
};

// Ensure single app instance
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// Initialize Firebase services
export const auth = getAuth(app);
export const realtimeDb = getDatabase(app);

// ✅ Use initializeFirestore for more stable persistence
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true, // helps with some browsers and proxies
});

// ✅ Enable offline persistence safely
if (typeof window !== "undefined") {
  enableIndexedDbPersistence(db).catch(async (err) => {
    if (err.code === "failed-precondition") {
      console.warn("Firestore persistence failed — multiple tabs open.");
    } else if (err.code === "unimplemented") {
      console.warn("Persistence not supported by this browser.");
    } else {
      console.error("Error enabling persistence:", err);
      // Fallback: clear corrupted cache once
      try {
        await clearIndexedDbPersistence(db);
        console.log("Cleared corrupt Firestore cache.");
      } catch (e) {
        console.warn("Could not clear persistence cache:", e);
      }
    }
  });
}
