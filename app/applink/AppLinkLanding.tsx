import type { Metadata } from "next";

/** 앱 인애서 「공유하기」용 `/applink` 전용(X용 `/applink/social` 과 코드 공유 안 함). */
const SITE_ORIGIN = "https://rate-history.vercel.app";

const IOS_APP_STORE_WEB =
  "https://apps.apple.com/us/app/usdt-signal/id6746846210";
const PLAY_STORE_WEB =
  "https://play.google.com/store/apps/details?id=com.smartCompany.usdtSignal";
const IOS_APP_STORE_ITMS =
  "itms-apps://apps.apple.com/us/app/usdt-signal/id6746846210";
const PLAY_STORE_MARKET =
  "market://details?id=com.smartCompany.usdtSignal";

export function createApplinkMetadata(canonicalPath: string): Metadata {
  const canonicalUrl = `${SITE_ORIGIN}${canonicalPath}`;
  return {
    title: "USDT Signal — Download",
    description:
      "Install USDT Signal from the App Store or Google Play. USDT / KRW and K-premium tools.",
    robots: { index: false, follow: false },
    openGraph: {
      title: "USDT Signal",
      description:
        "USDT / KRW, kimchi premium, and strategy simulation — install the app.",
      url: canonicalUrl,
      siteName: "USDT Signal",
      type: "website",
      images: [
        {
          url: `${SITE_ORIGIN}/og-share.png`,
          width: 1024,
          height: 1024,
          alt: "USDT Signal",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "USDT Signal",
      description:
        "USDT / KRW, kimchi premium, and strategy simulation — install the app.",
      images: [`${SITE_ORIGIN}/og-share.png`],
    },
  };
}

/**
 * X 등 인앱 브라우저: 자동 itms/market 이동을 피하고 버튼으로 스토어 이동.
 * 일반 모바일 브라우저: 짧은 지연 후 https 스토어로 폴백.
 */
const BOOT_SCRIPT = `
(function () {
  var ua = typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
  var inApp = /(Twitter|X\\/[\\d.]+|FBIOS|FBAN|FBAV|Line\\/|KakaoTalk|Kakao|Daum|KAKAOTALK|Whatsapp|Telegram|Snapchat|Slack|LinkedIn|FB_IAB|Instagram|Pinterest|musical_ly|ByteDance|Aweme|; wv\\))/i.test(ua);
  var isAndroid = /android/i.test(ua);
  var isIOS = /iphone|ipad|ipod/i.test(ua);
  var elIos = document.getElementById("applink-btn-ios");
  var elAnd = document.getElementById("applink-btn-android");
  if (isIOS && elIos) { elIos.setAttribute("href", ${JSON.stringify(IOS_APP_STORE_ITMS)}); }
  if (isAndroid && elAnd) { elAnd.setAttribute("href", ${JSON.stringify(PLAY_STORE_MARKET)}); }
  if (inApp) { return; }
  if (!isAndroid && !isIOS) { return; }
  var scheme = isAndroid ? ${JSON.stringify(PLAY_STORE_MARKET)} : ${JSON.stringify(IOS_APP_STORE_ITMS)};
  var web = isAndroid ? ${JSON.stringify(PLAY_STORE_WEB)} : ${JSON.stringify(IOS_APP_STORE_WEB)};
  var t = window.setTimeout(function () { window.location.replace(web); }, 2000);
  function cancel() {
    if (t !== null) { window.clearTimeout(t); t = null; }
  }
  document.addEventListener("visibilitychange", function () { if (document.hidden) { cancel(); } });
  window.addEventListener("pagehide", cancel);
  try { window.location.href = scheme; } catch (e) { cancel(); window.location.replace(web); }
})();
`.trim();

export default function AppLinkLanding() {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: BOOT_SCRIPT }} />
      <main
        style={{
          boxSizing: "border-box",
          display: "flex",
          minHeight: "100dvh",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "flex-start",
          gap: "0.5rem",
          background: "#0c0f14",
          color: "#f4f4f5",
          paddingTop: "max(1.5rem, env(safe-area-inset-top))",
          paddingLeft: "1.5rem",
          paddingRight: "1.5rem",
          paddingBottom: "max(5rem, env(safe-area-inset-bottom, 32px))",
          textAlign: "center",
          fontFamily:
            "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        }}
      >
        <p style={{ margin: 0, fontSize: "1rem", fontWeight: 600 }}>
          USDT Signal
        </p>
        <p
          style={{
            margin: 0,
            marginTop: "0.5rem",
            maxWidth: "22rem",
            fontSize: "0.75rem",
            lineHeight: 1.5,
            color: "#a1a1aa",
          }}
        >
          X·카카오 등 앱 안 브라우저는 아래 버튼을 눌러 스토어로 이동해 주세요.
        </p>
        <p
          style={{
            margin: 0,
            marginBottom: "1rem",
            fontSize: "11px",
            color: "#71717a",
          }}
        >
          일반 Safari·Chrome에서는 스토어가 자동으로 열릴 수 있습니다.
        </p>
        <div
          style={{
            display: "flex",
            width: "100%",
            maxWidth: "22rem",
            flexDirection: "column",
            gap: "0.75rem",
          }}
        >
          <a
            id="applink-btn-ios"
            href={IOS_APP_STORE_WEB}
            style={{
              display: "block",
              borderRadius: "0.75rem",
              background: "#fafafa",
              color: "#18181b",
              padding: "0.875rem 1.25rem",
              fontSize: "0.875rem",
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            App Store
          </a>
          <a
            id="applink-btn-android"
            href={PLAY_STORE_WEB}
            style={{
              display: "block",
              borderRadius: "0.75rem",
              border: "1px solid #52525b",
              background: "rgba(255,255,255,0.06)",
              color: "#fafafa",
              padding: "0.875rem 1.25rem",
              fontSize: "0.875rem",
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            Google Play
          </a>
        </div>
        <noscript>
          <p style={{ marginTop: "1rem" }}>
            <a href={IOS_APP_STORE_WEB} style={{ color: "#4ade80" }}>
              App Store로 이동
            </a>
          </p>
        </noscript>
      </main>
    </>
  );
}
