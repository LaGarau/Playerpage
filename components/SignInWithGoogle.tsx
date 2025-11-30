"use client";

import { GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { auth, realtimeDb } from "../lib/firebase";
import { ref, get, set } from "firebase/database";
import { toast } from "react-toastify";
import { useRouter } from "next/navigation";

export default function SignInWithGoogle() {
  const router = useRouter();

  const googleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      const user = result.user;
      if (!user) throw new Error("Google login failed");

      // Save user data to Realtime Database (consistent with RegisterForm)
      // Check if user already exists to avoid overwriting existing data
      const userRef = ref(realtimeDb, `Users/${user.uid}`);
      const existingUser = await get(userRef);
      
      if (!existingUser.exists()) {
        // Only create if user doesn't exist
        await set(userRef, {
          email: user.email || "",
          firstName: user.displayName?.split(" ")[0] || "Google User",
          lastName: user.displayName?.split(" ").slice(1).join(" ") || "",
          photo: user.photoURL || "",
          isGuest: false,
          createdAt: new Date().toISOString(),
          quantity: 0,
          points_earned: 0,
        });
      }

      toast.success("Signed in with Google!", { position: "top-center" });
      router.push("/map");
    } catch (err: any) {
      console.error("Google Login Error:", err);
      if (err.code === "auth/popup-closed-by-user") {
        toast.error("Sign-in popup was closed. Please try again.", { position: "top-center" });
      } else if (err.code === "auth/popup-blocked") {
        toast.error("Popup was blocked. Please allow popups and try again.", { position: "top-center" });
      } else {
        toast.error(err.message || "Failed to sign in with Google", { position: "top-center" });
      }
    }
  };

  return (
    <button
      type="button"
      onClick={googleLogin}
      className="w-full bg-white hover:bg-gray-50 text-gray-700 font-medium py-2 px-4 border border-gray-300 rounded-md flex items-center justify-center gap-2 transition-colors duration-200"
    >
      Continue with Google
    </button>
  );
}