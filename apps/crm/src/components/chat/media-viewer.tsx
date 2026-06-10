"use client";

import { useEffect } from "react";
import { Download, X } from "lucide-react";

export function MediaViewer({
  type,
  url,
  onClose,
}: {
  type: "image" | "video";
  url: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/95"
      onClick={onClose}
    >
      {/* Botões de ação no canto superior direito */}
      <div className="absolute right-0 top-0 z-10 flex items-center gap-2 p-3">
        <a
          href={url}
          download
          onClick={(e) => e.stopPropagation()}
          className="flex size-9 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
          title="Baixar"
        >
          <Download className="size-4" />
        </a>
        <button
          type="button"
          onClick={onClose}
          className="flex size-9 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
          title="Fechar (Esc)"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Mídia — stopPropagation pra não fechar ao clicar sobre ela */}
      <div
        className="flex max-h-[90vh] max-w-[90vw] items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        {type === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt=""
            className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain"
          />
        ) : (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video
            controls
            autoPlay
            className="max-h-[90vh] max-w-[90vw] rounded-lg"
          >
            <source src={url} />
          </video>
        )}
      </div>
    </div>
  );
}
