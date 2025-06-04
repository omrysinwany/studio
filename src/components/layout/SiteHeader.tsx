"use client";

import React from "react";
import Navigation from "./Navigation"; // Assuming Navigation.tsx is in the same directory

export default function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-14 max-w-screen-2xl items-center">
        <Navigation />
      </div>
    </header>
  );
}
