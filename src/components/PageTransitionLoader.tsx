"use client";

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import NProgress from "nprogress";
import "nprogress/nprogress.css"; // Standard NProgress CSS
import { Loader2 } from "lucide-react"; // For the centered spinner

// Custom styles for NProgress bar and hiding its default spinner
const nProgressStyles = `
  #nprogress .bar {
    background: #007bff !important; /* Brighter blue for better visibility */
    position: fixed;
    z-index: 10310 !important; /* Ensure it's on top of everything, including modals if any */
    top: 0;
    left: 0;
    width: 100%;
    height: 5px !important; /* Thicker bar */
  }
  #nprogress .peg {
    display: block;
    position: absolute;
    right: 0px;
    width: 100px;
    height: 100%;
    box-shadow: 0 0 10px #007bff, 0 0 5px #007bff !important; /* Matching glow */
    opacity: 1.0;
    transform: rotate(3deg) translate(0px, -4px);
  }
  #nprogress .spinner { 
    display: none !important; /* Hide NProgress's own spinner */
  }
`;

// Inject custom NProgress styles into the head once
if (typeof window !== "undefined") {
  const styleId = "nprogress-custom-styles-v3"; // Use a unique ID to ensure update if old styles exist
  if (!document.getElementById(styleId)) {
    const styleSheet = document.createElement("style");
    styleSheet.id = styleId;
    styleSheet.innerText = nProgressStyles;
    document.head.appendChild(styleSheet);
  }
  NProgress.configure({ showSpinner: false }); // Configure NProgress to not show its default spinner
}

export function PageTransitionLoader() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    // When the component mounts for a new route, or dependencies change (route change),
    // NProgress.done() is called to ensure any previous NProgress state is cleared.
    // setIsLoading(false) hides our custom loader.
    NProgress.done();
    setIsLoading(false);

    // The cleanup function (return) is called when the component unmounts
    // or before the effect re-runs for the next route.
    // This is where we start NProgress and show our custom loader for the upcoming navigation.
    return () => {
      NProgress.start();
      setIsLoading(true);
    };
  }, [pathname, searchParams]); // Effect dependencies: triggers on route change

  if (!isLoading) {
    return null; // Render nothing if not loading
  }

  // Render the full-screen overlay with a centered spinner
  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        backgroundColor: "rgba(0, 0, 0, 0.5)", // Dark semi-transparent overlay
        zIndex: 10300, // Below NProgress bar (10310) but above other page content
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        backdropFilter: "blur(3px)", // Blur effect for content behind the overlay
      }}
      aria-live="assertive" // For accessibility: informs screen readers that content changes are important
      role="alert" // For accessibility: indicates an alert or progress
    >
      <Loader2 className="h-16 w-16 animate-spin text-white" />{" "}
      {/* Large white spinner */}
      <span className="sr-only">Loading page...</span>{" "}
      {/* For screen readers */}
    </div>
  );
}
