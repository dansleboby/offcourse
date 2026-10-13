import type { Page } from "playwright";
import { hasValidFirebaseToken } from "../../shared/firebase.js";
import { isHighLevelLoginPage } from "../../shared/auth.js";

/**
 * HighLevel uses Firebase on some portals and a catv2 session cookie on others.
 * A cookie is checked through Playwright so HttpOnly cookies are supported.
 */
export async function hasValidHighLevelSession(page: Page): Promise<boolean> {
  if (isHighLevelLoginPage(page.url())) return false;

  if (await hasValidFirebaseToken(page)) return true;

  try {
    const currentUrl = page.url();
    const cookies = await page.context().cookies([currentUrl]);
    return cookies.some(
      (cookie) =>
        cookie.name === "catv2" &&
        cookie.value.length > 0 &&
        (cookie.expires === -1 || cookie.expires > Date.now() / 1000)
    );
  } catch {
    // The page may be navigating while the user logs in.
    return false;
  }
}
