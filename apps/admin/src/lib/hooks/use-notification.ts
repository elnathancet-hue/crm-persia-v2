"use client";

import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";

// Notification sound (base64 short beep)
const NOTIFICATION_SOUND_URL = "data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdWeCcXByd3d0cnBvb3BxcXJycnJycnJycnJxcXFxcXBwcG9vb29ubm5ubm1tbWxsbGtrawA=";
export const CHAT_SOUND_MUTED_KEY = "admin:chat:sound-muted";
const TOAST_MUTED_KEY = "crm:toast:muted";

export function useNotificationSound() {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    audioRef.current = new Audio(NOTIFICATION_SOUND_URL);
    audioRef.current.volume = 0.5;
  }, []);

  const play = useCallback(() => {
    try {
      if (localStorage.getItem(CHAT_SOUND_MUTED_KEY) === "true") return;
      if (audioRef.current) {
        audioRef.current.currentTime = 0;
        audioRef.current.play().catch(() => {});
      }
    } catch {}
  }, []);

  return play;
}

export function useDesktopNotification() {
  const notify = useCallback((title: string, body?: string) => {
    try {
      if (localStorage.getItem(TOAST_MUTED_KEY) === "1") return;
      toast.info(title, { description: body, duration: 5000 });
    } catch {}
  }, []);

  return notify;
}
