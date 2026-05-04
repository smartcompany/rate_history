import { redirect } from "next/navigation";

const IOS_APP_STORE =
  "https://apps.apple.com/us/app/usdt-signal/id6746846210";

export const metadata = {
  title: "USDT Signal — App Store",
};

/**
 * 직접 /applink 접근 시(프록시 없을 때) iOS 스토어로 폴백.
 * X·인앱 WebView 공유 미리보기는 `/applink/social` 사용.
 */
export default function AppLinkFallbackPage() {
  redirect(IOS_APP_STORE);
}
