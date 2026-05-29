import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const uploadMock = vi.fn();
const getPublicUrlMock = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    storage: {
      from: vi.fn(() => ({
        upload: uploadMock,
        getPublicUrl: getPublicUrlMock,
      })),
    },
  })),
}));

import {
  cacheLeadAvatarFromUrl,
  isCachedLeadAvatarUrl,
} from "@/lib/lead-avatar-cache";

describe("lead-avatar-cache", () => {
  beforeEach(() => {
    uploadMock.mockResolvedValue({ error: null });
    getPublicUrlMock.mockReturnValue({
      data: {
        publicUrl:
          "https://supabase.test/storage/v1/object/public/lead-avatars/org-1/lead-1.jpg",
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("baixa avatar remoto e re-hospeda no bucket lead-avatars", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        headers: new Headers({ "content-type": "image/jpeg" }),
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      })),
    );

    const url = await cacheLeadAvatarFromUrl({
      organizationId: "org-1",
      leadId: "lead-1",
      remoteUrl: "https://pps.whatsapp.net/avatar.jpg",
    });

    expect(url).toContain("/storage/v1/object/public/lead-avatars/");
    expect(uploadMock).toHaveBeenCalledWith(
      "org-1/lead-1.jpg",
      expect.any(ArrayBuffer),
      expect.objectContaining({
        contentType: "image/jpeg",
        upsert: true,
      }),
    );
  });

  it("nao rebaixa URL que ja esta no Storage", async () => {
    const cached =
      "https://supabase.test/storage/v1/object/public/lead-avatars/org-1/lead-1.jpg";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      cacheLeadAvatarFromUrl({
        organizationId: "org-1",
        leadId: "lead-1",
        remoteUrl: cached,
      }),
    ).resolves.toBe(cached);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(isCachedLeadAvatarUrl(cached)).toBe(true);
  });
});
