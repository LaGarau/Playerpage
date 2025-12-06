"use client";

import { GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { auth, db } from "../lib/firebase";
import { setDoc, doc } from "firebase/firestore";
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

      await setDoc(
        doc(db, "Users", user.uid),
        {
          email: user.email,
          firstName: user.displayName || "Google User",
          photo: user.photoURL || "",
          isGuest: false,
          createdAt: new Date().toISOString(),
        },
        { merge: true }
      );

      toast.success("Signed in with Google!", { position: "top-center" });
      router.push("/map");
    } catch (err: any) {
      console.error("Google Login Error:", err);
      toast.error(err.message || "Failed to sign in with Google", { position: "top-center" });
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