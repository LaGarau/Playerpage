"use client";

import LoginForm from "../../components/LoginForm";
import localFont from 'next/font/local';

const impact = localFont({
  src: '../../public/fonts/Impact 400.ttf',
  display: 'swap',
});

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-white flex flex-col items-center px-4 sm:px-8">
      
      {/* Logo */}
      <div className="flex items-center justify-center pt-8 pb-4 gap-4">
        <img
          className="w-full max-w-[300px] sm:max-w-[400px] h-auto"
          src="/images/letsgetstarted.png"
          alt="Logo"
        />
      </div>

      {/* Info text */}
      <div className="flex flex-col items-center gap-2 mb-10 text-black text-center">
        <p className={`${impact.className} text-xl sm:text-3xl`}>
          Explore Thamel
        </p>
        <p className={`${impact.className} text-xl sm:text-3xl`}>
          Scan Just 8 QR codes
        </p>
        <p className={`${impact.className} text-xl sm:text-3xl`}>
          Earn from 100+ prizes
        </p>
        <p className={`${impact.className} text-sm sm:text-2xl`}>
          (*Till prizes run out)
        </p>
      </div>

      {/* Login form */}
      <div className="w-full max-w-md">
        <LoginForm />
      </div>
    </div>
  );
}
