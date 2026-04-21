"use client";

import { useCallback, useEffect, useRef } from "react";

// Notification sound (base64 short beep)
const NOTIFICATION_SOUND_URL = "data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdWeCcXByd3d0cnBvb3BxcXJycnJycnJycnJxcXFxcXBwcG9vb29ubm5ubm1tbWxsbGtrawA=";

export function useNotificationSound() {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    audioRef.current = new Audio(NOTIFICATION_SOUND_URL);
    audioRef.current.volume = 0.5;
  }, []);

  const play = useCallback(() => {
    try {
      if (audioRef.current) {
        audioRef.current.currentTime = 0;
        audioRef.current.play().catch(() => {});
      }
    } catch {}
  }, []);

  return play;
}

export function useDesktopNotification() {
  const permissionRef = useRef<NotificationPermission>("default");

  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      permissionRef.current = Notification.permission;
      if (Notification.permission === "default") {
        Notification.requestPermission().then((p) => {
          permissionRef.current = p;
        });
      }
    }
  }, []);

  const notify = useCallback((title: string, body?: string) => {
    try {
      if (typeof window === "undefined" || !("Notification" in window)) return;
      if (document.hasFocus()) return; // Don't notify if tab is focused
      if (permissionRef.current === "granted") {
        new Notification(title, {
          body,
          icon: "/favicon.ico",
          tag: "admin-chat",
        });
      }
    } catch {}
  }, []);

  return notify;
}
