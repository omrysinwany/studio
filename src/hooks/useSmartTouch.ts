
'use client';

import { useRef, useCallback } from 'react';

interface UseSmartTouchProps {
  onTap?: (event: React.TouchEvent | React.MouseEvent) => void;
  moveThreshold?: number; // Pixels to differentiate scroll from tap
  timeThreshold?: number; // Milliseconds to differentiate long press from tap
}

interface TouchState {
  startX: number;
  startY: number;
  startTime: number;
}

export function useSmartTouch({
  onTap,
  moveThreshold = 10, // Default: 10 pixels
  timeThreshold = 200, // Default: 200 milliseconds for a tap
}: UseSmartTouchProps = {}) { // Provide default for props object itself
  const touchStateRef = useRef<TouchState | null>(null);
  const tapPreventedByScroll = useRef(false);

  const onTouchStart = useCallback((event: React.TouchEvent) => {
    const touch = event.touches[0];
    touchStateRef.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      startTime: Date.now(),
    };
    tapPreventedByScroll.current = false; // Reset scroll prevention on new touch
  }, []);

  const onTouchMove = useCallback((event: React.TouchEvent) => {
    if (!touchStateRef.current) return;

    const touch = event.touches[0];
    const deltaX = Math.abs(touch.clientX - touchStateRef.current.startX);
    const deltaY = Math.abs(touch.clientY - touchStateRef.current.startY);

    if (deltaX > moveThreshold || deltaY > moveThreshold) {
      tapPreventedByScroll.current = true; // Mark that a scroll has occurred
      // Optionally, you could call event.preventDefault() here if you want to
      // explicitly stop the browser's default scroll behavior when a certain
      // condition is met, but be cautious as it can interfere with native scrolling.
    }
  }, [moveThreshold]);

  const onTouchEnd = useCallback((event: React.TouchEvent) => {
    if (touchStateRef.current && !tapPreventedByScroll.current) {
      const duration = Date.now() - touchStateRef.current.startTime;
      if (duration < timeThreshold) {
        if (onTap) {
          onTap(event);
        }
      }
    }
    touchStateRef.current = null;
    tapPreventedByScroll.current = false; // Reset for next interaction
  }, [timeThreshold, onTap]);

  // For mouse events, to provide similar behavior on desktop if needed
  const onMouseDown = useCallback((event: React.MouseEvent) => {
    touchStateRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      startTime: Date.now(),
    };
    tapPreventedByScroll.current = false;
  }, []);

  const onMouseMove = useCallback((event: React.MouseEvent) => {
    if (!touchStateRef.current || event.buttons !== 1) { // Only if mouse button is pressed
        touchStateRef.current = null; // Reset if mouse button released elsewhere
        return;
    }
    const deltaX = Math.abs(event.clientX - touchStateRef.current.startX);
    const deltaY = Math.abs(event.clientY - touchStateRef.current.startY);

    if (deltaX > moveThreshold || deltaY > moveThreshold) {
        tapPreventedByScroll.current = true;
    }
  }, [moveThreshold]);

  const onClick = useCallback((event: React.MouseEvent) => {
    // This onClick will only be effectively called if tapPreventedByScroll is false
    // and the primary mouse button was involved.
    if (touchStateRef.current && !tapPreventedByScroll.current) {
      const duration = Date.now() - touchStateRef.current.startTime;
      if (duration < timeThreshold) {
        if (onTap) {
          onTap(event);
        }
      }
    }
    touchStateRef.current = null;
    tapPreventedByScroll.current = false;
  }, [timeThreshold, onTap]);


  return {
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    onMouseDown, // Include mouse down for consistency, works with onClick
    onMouseMove, // Include mouse move to detect drag with mouse
    onClick,     // This will be the primary handler for taps/clicks
    // No need to return onMouseUp explicitly if onClick handles it correctly
  };
}
