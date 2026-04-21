"use client";

import { useCallback, useEffect, useRef } from "react";

// ---- Sound Notification ----

let audioInstance: HTMLAudioElement | null = null;

function getAudio(): HTMLAudioElement {
  if (!audioInstance) {
    audioInstance = new Audio("/sounds/notification.wav");
    audioInstance.volume = 0.5;
  }
  return audioInstance;
}

export function useNotificationSound() {
  const play = useCallback(() => {
    try {
      const audio = getAudio();
      audio.currentTime = 0;
      audio.play().catch(() => {});
    } catch {
      // Audio not available
    }
  }, []);

  return { play };
}

// ---- Desktop Notification ----

export function useDesktopNotification() {
  const permissionRef = useRef<NotificationPermission>("default");

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    permissionRef.current = Notification.permission;

    if (Notification.permission === "default") {
      Notification.requestPermission().then((perm) => {
        permissionRef.current = perm;
      });
    }
  }, []);

  const notify = useCallback(
    (title: string, body: string, onClick?: () => void) => {
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
    []
  );

  return { notify };
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
