"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ---- Sound Notification ----

let audioInstance: HTMLAudioElement | null = null;
const SOUND_PREF_KEY = "persia:chat:sound-enabled";
const DESKTOP_PREF_KEY = "persia:chat:desktop-notifications-enabled";

function readBooleanPreference(key: string, fallback: boolean): boolean {
  if (typeof window === "undefined") return fallback;
  const value = window.localStorage.getItem(key);
  if (value === null) return fallback;
  return value === "true";
}

function getAudio(): HTMLAudioElement {
  if (!audioInstance) {
    audioInstance = new Audio("/sounds/notification.wav");
    audioInstance.volume = 0.5;
  }
  return audioInstance;
}

export function useNotificationSound() {
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    setEnabled(readBooleanPreference(SOUND_PREF_KEY, true));
  }, []);

  const setSoundEnabled = useCallback((next: boolean) => {
    setEnabled(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(SOUND_PREF_KEY, String(next));
    }
  }, []);

  const play = useCallback(() => {
    if (!enabled) return;
    try {
      const audio = getAudio();
      audio.currentTime = 0;
      audio.play().catch(() => {});
    } catch {
      // Audio not available
    }
  }, [enabled]);

  return { play, enabled, setEnabled: setSoundEnabled };
}

// ---- Desktop Notification ----

export function useDesktopNotification() {
  const permissionRef = useRef<NotificationPermission>("default");
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    setEnabled(readBooleanPreference(DESKTOP_PREF_KEY, true));
    if (typeof window === "undefined" || !("Notification" in window)) return;
    permissionRef.current = Notification.permission;

    if (Notification.permission === "default") {
      Notification.requestPermission().then((perm) => {
        permissionRef.current = perm;
      });
    }
  }, []);

  const setDesktopEnabled = useCallback((next: boolean) => {
    setEnabled(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(DESKTOP_PREF_KEY, String(next));
    }
  }, []);

  const notify = useCallback(
    (title: string, body: string, onClick?: () => void) => {
      if (!enabled) return;
      if (typeof window === "undefined" || !("Notification" in window)) return;
      if (permissionRef.current !== "granted") return;

      // Only show if tab is NOT focused
      if (document.hasFocus()) return;

      const notification = new Notification(title, {
        body,
        icon: "/favicon.ico",
        tag: "crm-persia-msg", // Replaces previous notification
      });

      if (onClick) {
        notification.onclick = () => {
          window.focus();
          onClick();
          notification.close();
        };
      }

      // Auto close after 5s
      setTimeout(() => notification.close(), 5000);
    },
    [enabled]
  );

  return { notify, enabled, setEnabled: setDesktopEnabled };
}

// ---- Tab Title Badge ----

let originalTitle = "";

export function useTabTitleBadge() {
  useEffect(() => {
    if (typeof document !== "undefined") {
      originalTitle = document.title.replace(/^\(\d+\)\s*/, "");
    }
  }, []);

  const setUnreadCount = useCallback((count: number) => {
    if (typeof document === "undefined") return;
    if (!originalTitle) originalTitle = "CRM Persia";

    document.title = count > 0 ? `(${count}) ${originalTitle}` : originalTitle;
  }, []);

  return { setUnreadCount };
}
