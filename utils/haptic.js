// utils/haptic.js
export const triggerHaptic = (ms = 50) => {
  if (typeof window !== "undefined" && navigator.vibrate) {
    navigator.vibrate(ms);
  }
};
