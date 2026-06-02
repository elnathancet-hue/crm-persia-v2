// media-upload.ts — upload e validação de mídia para campanhas.
//
// Regras do roadmap:
//   - Upload vai para Supabase Storage antes de salvar o step
//   - Validação de mime type e tamanho máximo por tipo
//   - Retorna { media_url, media_type, media_filename, media_mime_type, media_size }

import type { StepMediaType } from "@persia/shared/crm";

export interface MediaUploadInput {
  file: File;
  orgId: string;
  campaignId: string;
}

export interface MediaUploadResult {
  media_url: string;
  media_type: StepMediaType;
  media_filename: string;
  media_mime_type: string;
  media_size: number;
}

export interface MediaValidationError {
  error: string;
}

// Limites em bytes
const MAX_SIZE: Record<StepMediaType, number> = {
  none: 0,
  image: 8 * 1024 * 1024,       // 8 MB
  video: 32 * 1024 * 1024,      // 32 MB
  audio: 16 * 1024 * 1024,      // 16 MB
  document: 32 * 1024 * 1024,   // 32 MB
};

const MIME_TO_TYPE: Record<string, StepMediaType> = {
  "image/jpeg": "image",
  "image/jpg": "image",
  "image/png": "image",
  "image/gif": "image",
  "image/webp": "image",
  "video/mp4": "video",
  "video/mpeg": "video",
  "video/quicktime": "video",
  "audio/mpeg": "audio",
  "audio/mp3": "audio",
  "audio/ogg": "audio",
  "audio/wav": "audio",
  "audio/webm": "audio",
  "audio/aac": "audio",
  "application/pdf": "document",
  "application/msword": "document",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "document",
  "application/vnd.ms-excel": "document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "document",
  "application/vnd.ms-powerpoint": "document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "document",
};

export function detectMediaType(mime: string): StepMediaType {
  return MIME_TO_TYPE[mime.toLowerCase()] ?? "document";
}

export function validateMediaFile(file: File): MediaValidationError | null {
  const mediaType = detectMediaType(file.type);
  const maxBytes = MAX_SIZE[mediaType];

  if (mediaType === "none") {
    return { error: `Tipo de arquivo não suportado: ${file.type}` };
  }

  if (file.size > maxBytes) {
    const maxMb = maxBytes / 1024 / 1024;
    return { error: `Arquivo muito grande. Máximo para ${mediaType}: ${maxMb} MB` };
  }

  if (file.size === 0) {
    return { error: "Arquivo vazio" };
  }

  return null;
}

/**
 * Faz upload do arquivo para Supabase Storage e retorna os metadados.
 * Bucket: campaign-media (público, mas com path isolado por org/campaign).
 */
export async function uploadCampaignMedia(
  supabase: {
    storage: {
      from: (bucket: string) => {
        upload: (path: string, file: File, opts?: { contentType?: string }) => Promise<{ data: { path: string } | null; error: { message: string } | null }>;
        getPublicUrl: (path: string) => { data: { publicUrl: string } };
      };
    };
  },
  input: MediaUploadInput,
): Promise<MediaUploadResult | MediaValidationError> {
  const { file, orgId, campaignId } = input;

  const validationError = validateMediaFile(file);
  if (validationError) return validationError;

  const mediaType = detectMediaType(file.type);
  const ext = file.name.split(".").pop() ?? "";
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${orgId}/${campaignId}/${Date.now()}_${safeName}`;

  const { data, error } = await supabase.storage
    .from("campaign-media")
    .upload(path, file, { contentType: file.type });

  if (error || !data) {
    return { error: `Falha no upload: ${error?.message ?? "erro desconhecido"}` };
  }

  const { data: urlData } = supabase.storage
    .from("campaign-media")
    .getPublicUrl(data.path);

  return {
    media_url: urlData.publicUrl,
    media_type: mediaType,
    media_filename: safeName,
    media_mime_type: file.type,
    media_size: file.size,
  };
}
