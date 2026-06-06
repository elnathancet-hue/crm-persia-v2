"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

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

// ---- In-app notification card ----

export function useDesktopNotification() {
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    setEnabled(readBooleanPreference(DESKTOP_PREF_KEY, true));
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
      toast.info(title, {
        description: body,
        duration: 5000,
        ...(onClick ? { action: { label: "Abrir", onClick } } : {}),
      });
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
