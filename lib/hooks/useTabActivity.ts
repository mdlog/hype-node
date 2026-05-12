"use client";

// Lightweight wrapper around `document.visibilityState`. Components subscribe
// once and re-render when the tab toggles between visible and hidden — used
// by `useAutoRefetch` to pause polling in background tabs and to fire an
// immediate refetch when the user comes back, but exposed standalone so
// other surfaces (presence dots, "live" badges) can opt in too.
//
// SSR safe: returns `{ hidden: false }` until the post-mount effect attaches
// the listener and reads the real value, so the server output stays stable.

import { useEffect, useState } from "react";

export function useTabActivity(): { hidden: boolean } {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const read = () => setHidden(document.visibilityState === "hidden");
    read();
    document.addEventListener("visibilitychange", read);
    return () => {
      document.removeEventListener("visibilitychange", read);
    };
  }, []);

  return { hidden };
}
