import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import {
  getFirestore,
  enableIndexedDbPersistence,
  clearIndexedDbPersistence,
  initializeFirestore,
} from "firebase/firestore";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyBA3jIanOQD9gD9JKXkfuH761ZXj69-ly8",
  authDomain: "ghumante-yuwa-demo.firebaseapp.com",
  databaseURL:
    "https://ghumante-yuwa-demo-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "ghumante-yuwa-demo",
  storageBucket: "ghumante-yuwa-demo.appspot.com", // ✅ fixed domain
  messagingSenderId: "611741769691",
  appId: "1:611741769691:web:d9b9f371518819fbb211fe",
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