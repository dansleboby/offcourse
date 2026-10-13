import type { Page } from "playwright";
import { parseHLSPlaylist } from "../../downloader/shared/index.js";
import {
  detectVimeoEmbed,
  detectLoomEmbed,
  detectYouTubeEmbed,
  detectHlsVideo,
} from "../../shared/videoDetection.js";
import { PostDetailsResponseSchema, VideoLicenseResponseSchema, safeParse } from "./schemas.js";
import {
  getFirebaseAccessTokenFromPage,
  waitForFirebaseAccessTokenFromPage,
} from "../../shared/firebase.js";

// Alias for backwards compatibility and internal use
const parseHLSMasterPlaylist = parseHLSPlaylist;

export interface HighLevelVideoInfo {
  type: "hls" | "vimeo" | "loom" | "youtube" | "custom";
  url: string;
  masterPlaylistUrl?: string;
  qualities?: {
    label: string;
    url: string;
    width?: number;
    height?: number;
  }[];
  duration?: number;
  thumbnailUrl?: string;
  token?: string;
}

export interface HighLevelPostContent {
  id: string;
  title: string;
  description: string | null;
  htmlContent: string | null;
  video: HighLevelVideoInfo | null;
  attachments: {
    id: string;
    name: string;
    url: string;
    type: string;
    size?: number;
  }[];
  categoryId: string;
  productId: string;
}

/** Navigates to a post and waits for the auth state needed by its API requests. */
export async function navigateToHighLevelPost(page: Page, postUrl: string): Promise<void> {
  await page.goto(postUrl, { timeout: 30000 });
  await page.waitForLoadState("domcontentloaded");
  await waitForFirebaseAccessTokenFromPage(page);
}

// Browser/API automation - requires Playwright

/**
 * Extracts the Firebase auth token from the page.
 */
export const getAuthToken = getFirebaseAccessTokenFromPage;

/**
 * Extracts video info from a HighLevel post page using shared detection utilities.
 */
export async function extractVideoFromPage(page: Page): Promise<HighLevelVideoInfo | null> {
  // Check for HLS video
  const hlsUrl = await detectHlsVideo(page);
  if (hlsUrl) {
    return { type: "hls", url: hlsUrl, masterPlaylistUrl: hlsUrl };
  }

  // Check for Vimeo embed
  const vimeoUrl = await detectVimeoEmbed(page);
  if (vimeoUrl) {
    return { type: "vimeo", url: vimeoUrl };
  }

  // Check for Loom embed
  const loomUrl = await detectLoomEmbed(page);
  if (loomUrl) {
    return { type: "loom", url: loomUrl };
  }

  // Check for YouTube embed
  const youtubeUrl = await detectYouTubeEmbed(page);
  if (youtubeUrl) {
    return { type: "youtube", url: youtubeUrl };
  }

  return null;
}

/**
 * Fetches post details from the API.
 */
export async function fetchPostDetails(
  page: Page,
  locationId: string,
  postId: string
): Promise<{
  title: string;
  description: string | null;
  video: {
    assetId: string;
    url: string;
  } | null;
  materials: {
    id: string;
    name: string;
    url: string;
    type: string;
  }[];
} | null> {
  const authToken = await getAuthToken(page);
  if (!authToken) {
    console.warn("Could not fetch HighLevel post details: No auth token");
    return null;
  }

  let data: unknown;
  try {
    const response = await page.request.get(
      `https://services.leadconnectorhq.com/membership/locations/${locationId}/posts/${postId}?source=courses`,
      { headers: { Authorization: `Bearer ${authToken}` } }
    );
    if (!response.ok()) {
      console.warn(`Could not fetch HighLevel post details: HTTP ${response.status()}`);
      return null;
    }
    data = await response.json();
  } catch (error) {
    console.warn(`Could not fetch HighLevel post details: ${String(error)}`);
    return null;
  }

  // Validate response with Zod schema
  const parsed = safeParse(PostDetailsResponseSchema, data, "fetchPostDetails");
  if (!parsed) {
    return null;
  }

  // The API returns data directly (not nested under .post)
  // Check both for backwards compatibility
  const post = parsed.post ?? parsed;

  let video: { assetId: string; url: string } | null = null;

  // Check for video directly on post
  // Video can have: id, assetId, assetsLicenseId, or direct url
  if (post.video) {
    const videoAssetId = post.video.assetsLicenseId ?? post.video.assetId ?? post.video.id;
    if (videoAssetId || post.video.url) {
      video = {
        assetId: videoAssetId ?? "",
        url: post.video.url ?? "",
      };
    }
  }

  // Check posterImage for video asset (older format)
  if (!video && post.posterImage?.assetId) {
    video = {
      assetId: post.posterImage.assetId,
      url: post.posterImage.url ?? "",
    };
  }

  // Check for video in contentBlock
  if (!video && post.contentBlock) {
    for (const block of post.contentBlock) {
      if (block.type === "video") {
        const blockAssetId = block.assetsLicenseId ?? block.assetId ?? block.id;
        if (blockAssetId || block.url) {
          video = {
            assetId: blockAssetId ?? "",
            url: block.url ?? "",
          };
          break;
        }
      }
    }
  }

  const materials: {
    id: string;
    name: string;
    url: string;
    type: string;
  }[] = [];

  // Materials can be under 'materials' or 'post_materials'
  const materialsList = post.materials ?? post.post_materials ?? [];
  for (const material of materialsList) {
    materials.push({
      id: material.id ?? crypto.randomUUID(),
      name: material.name ?? "Attachment",
      url: material.url ?? "",
      type: material.type ?? "file",
    });
  }

  return {
    title: post.title ?? "",
    description: post.description ?? null,
    video,
    materials,
  };
}

/**
 * Fetches the DRM license (HLS token) for a video asset.
 */
export async function fetchVideoLicense(
  page: Page,
  assetId: string
): Promise<{ url: string; token: string } | null> {
  // Get auth token first
  const authToken = await getAuthToken(page);
  if (!authToken) {
    return null;
  }

  try {
    // Use page.request to make the API call (bypasses CORS)
    const response = await page.request.get(
      `https://backend.leadconnectorhq.com/assets-drm/assets-license/${assetId}`,
      {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      }
    );

    if (!response.ok()) {
      return null;
    }

    const data: unknown = await response.json();

    // Validate response with Zod schema
    const parsed = safeParse(VideoLicenseResponseSchema, data, "fetchVideoLicense");
    if (!parsed) {
      return null;
    }

    return {
      url: parsed.url,
      token: parsed.token,
    };
  } catch (error) {
    console.error("Failed to fetch video license:", error);
    return null;
  }
}

/**
 * Extracts complete post content including video and attachments.
 */
export async function extractHighLevelPostContent(
  page: Page,
  postUrl: string,
  locationId: string,
  productId: string,
  postId: string,
  categoryId: string
): Promise<HighLevelPostContent | null> {
  // Capture the modern middleware response while navigating: the API is called
  // from the SPA, with its own cookie-based credentials and request headers.
  // Never print captured responses, which can contain account metadata.
  let capturedPost: unknown = null;
  const audioUrls = new Set<string>();
  const captureAudio = (request: import("playwright").Request): void => {
    const url = request.url();
    if (/^https:\/\/cdn\.courses\.apisystem\.tech\/memberships\/[^/]+\/audios\/[^?#]+\.mp3(?:[?#]|$)/i.test(url)) {
      audioUrls.add(url);
    }
  };
  page.on("request", captureAudio);
  const pending = new Set<Promise<void>>();
  const capturePost = (response: import("playwright").Response): void => {
    const url = response.url();
    if (
      !response.ok() ||
      !url.includes("leadconnectorhq.com/clientportal-middleware/") ||
      !url.includes("/posts/") ||
      !url.includes(postId)
    ) return;
    const task = (async () => {
      try { capturedPost = await response.json(); } catch { /* non-JSON response */ }
    })();
    pending.add(task);
    void task.finally(() => pending.delete(task));
  };
  page.on("response", capturePost);
  try {
    await navigateToHighLevelPost(page, postUrl);
    // Some cookie-authenticated portals use /products/... instead of /courses/products/...
    // Only retry when the expected lesson isn't rendered or returned by the middleware.
    if (!capturedPost && !page.url().includes("/posts/")) {
      const alternative = new URL(postUrl);
      alternative.pathname = alternative.pathname.replace("/courses/products/", "/products/");
      if (alternative.href !== postUrl) await page.goto(alternative.href, { timeout: 30000 });
    }
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
  } finally {
    page.off("response", capturePost);
    page.off("request", captureAudio);
    await Promise.allSettled([...pending]);
  }

  // Some players defer the MP3 request until playback; inspect their source
  // attributes and already loaded resource URLs as well as network requests.
  const domAudioUrls = await page.evaluate(() => {
    const found = new Set<string>();
    const add = (value: string | null | undefined): void => {
      if (!value) return;
      try {
        const url = new URL(value, document.baseURI).href;
        if (/^https:\/\/cdn\.courses\.apisystem\.tech\/memberships\/[^/]+\/audios\/[^?#]+\.mp3(?:[?#]|$)/i.test(url)) {
          found.add(url);
        }
      } catch { /* ignore malformed URLs */ }
    };
    for (const el of document.querySelectorAll("audio, audio source, [src], [data-src], a[href]")) {
      add(el.getAttribute("src"));
      add(el.getAttribute("data-src"));
      add(el.getAttribute("href"));
    }
    for (const entry of performance.getEntriesByType("resource")) add(entry.name);
    return [...found];
  });
  domAudioUrls.forEach((url) => audioUrls.add(url));
  const audioAttachments = (): HighLevelPostContent["attachments"] =>
    [...audioUrls].map((url, index) => ({
      id: `audio-${index}`,
      name: `lesson-audio-${index + 1}.mp3`,
      url, type: "audio/mpeg",
    }));

  // The legacy API is only available on Firebase-backed portals.
  const postDetails = await fetchPostDetails(page, locationId, postId);

  if (!postDetails && capturedPost) {
    // Middleware data may be a bare post or wrapped in { post: ... }.
    const payload = capturedPost as Record<string, unknown>;
    const source = payload && typeof payload.post === "object" && payload.post !== null
      ? payload.post as Record<string, unknown>
      : payload;
    if (source && typeof source.title === "string") {
      const description = typeof source.description === "string" ? source.description : null;
      const videoInfo = source.video && typeof source.video === "object"
        ? source.video as Record<string, unknown> : null;
      const mediaUrl = typeof videoInfo?.url === "string" ? videoInfo.url : null;
      const video: HighLevelVideoInfo | null = mediaUrl
        ? { type: mediaUrl.includes(".m3u8") ? "hls" : "custom", url: mediaUrl }
        : await extractVideoFromPage(page);
      return {
        id: postId, title: source.title, description, htmlContent: description,
        video, attachments: audioAttachments(), categoryId, productId,
      };
    }
  }

  if (!postDetails) {
    // Cookie-authenticated clientportal portals do not expose a Firebase token.
    // Extract only content actually rendered on the accessible lesson page.
    await page.locator("body").waitFor({ state: "attached", timeout: 10000 });
    const rendered = await page.evaluate(() => {
      const text = (selector: string): string =>
        document.querySelector(selector)?.textContent?.trim() ?? "";
      const contentElement = document.querySelector(
        ".post-content, .lesson-content, [class*='post-description'], article"
      );
      return {
        title: text(".post-title, .lesson-title, h1, h2"),
        html: contentElement?.innerHTML ?? null,
        description: text(".post-description, .lesson-description") || null,
      };
    });
    const video = await extractVideoFromPage(page);
    if (!rendered.title && !rendered.html && !rendered.description && !video && audioUrls.size === 0) {
      console.error("Could not extract lesson content from API or rendered page");
      return null;
    }
    return {
      id: postId,
      title: rendered.title || postId,
      description: rendered.description,
      htmlContent: rendered.html,
      video,
      attachments: audioAttachments(),
      categoryId,
      productId,
    };
  }

  let video: HighLevelVideoInfo | null = null;

  // Check if we have video data
  if (postDetails.video) {
    // Option 1: Direct MP4 URL (preferred - no DRM)
    if (postDetails.video.url?.endsWith(".mp4")) {
      video = {
        type: "custom", // Direct download, not HLS
        url: postDetails.video.url,
      };
    }
    // Option 2: Get HLS license URL via assetId
    else if (postDetails.video.assetId) {
      const license = await fetchVideoLicense(page, postDetails.video.assetId);

      if (license?.url) {
        video = {
          type: "hls",
          url: license.url,
          masterPlaylistUrl: license.url,
          token: license.token,
        };
      }
    }
  }

  // Fallback: try to extract video from page DOM
  video ??= await extractVideoFromPage(page);

  // Extract HTML content
  const htmlContent = await page.evaluate(() => {
    const contentEl = document.querySelector(
      "[class*='post-content'], [class*='PostContent'], [class*='lesson-content'], article"
    );
    return contentEl?.innerHTML ?? null;
  });

  // Extract text description
  const description = await page.evaluate(() => {
    const descEl = document.querySelector(
      "[class*='description'], [class*='Description'], p:first-of-type"
    );
    return descEl?.textContent?.trim() ?? null;
  });

  return {
    id: postId,
    title: postDetails.title,
    description: description ?? postDetails.description,
    htmlContent,
    video,
    attachments: postDetails.materials.map((m) => ({
      id: m.id,
      name: m.name,
      url: m.url,
      type: m.type,
    })),
    categoryId,
    productId,
  };
}

// Re-export for backwards compatibility
export { parseHLSMasterPlaylist };
