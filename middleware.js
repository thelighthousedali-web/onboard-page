// 사내 공인 IP 접속 제한 (Vercel Routing Middleware — 모든 요청 앞단에서 실행)
// 2026-10-23 보안 공지 대응: 사내 공인 IP 외에서는 페이지 자체를 403으로 차단.
// IP 추가/변경 시 ALLOWED_IPS만 수정 후 push하면 됨.

const ALLOWED_IPS = new Set([
  // PNM 타워
  '61.74.175.185',
  '61.74.175.186',
  // 스타 빌딩
  '222.107.106.178',
  '222.107.106.180',
  // 혜성 타워
  '220.118.85.114',
]);

// 메일 본문·푸시 알림에서 외부(메일 서버 이미지 프록시, 휴대폰)가 불러가는 로고/아이콘만 예외 — 민감정보 없음
const PUBLIC_ASSETS = new Set([
  '/logo-vertical.png',
  '/logo-wide.png',
  '/slogan.png',
  '/slogan-white.png',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
  '/favicon.ico',
]);

export const config = { matcher: '/:path*' };

export default function middleware(request) {
  const { pathname } = new URL(request.url);
  if (PUBLIC_ASSETS.has(pathname)) return;

  // x-real-ip는 Vercel이 실제 접속 IP로 덮어써서 넣는 값(클라이언트가 위조 불가)
  const ip = (request.headers.get('x-real-ip')
    || (request.headers.get('x-forwarded-for') || '').split(',')[0]).trim().replace(/[^0-9a-fA-F:.]/g, '');
  if (ALLOWED_IPS.has(ip)) return;

  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>접속 제한</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
font-family:'Malgun Gothic',sans-serif;background:#f6f6f6;color:#222}
.box{background:#fff;padding:36px 32px;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,.08);max-width:420px;margin:16px;text-align:center}
h1{font-size:20px;margin:0 0 12px}p{font-size:14px;line-height:1.6;color:#555;margin:0}
code{display:inline-block;margin-top:14px;padding:4px 10px;background:#f1f1f1;border-radius:6px;font-size:13px;color:#333}</style>
</head><body><div class="box"><h1>사내 네트워크에서만 접속 가능합니다</h1>
<p>보안 정책에 따라 회사 공인 IP에서만 이용할 수 있습니다.<br>사내 Wi-Fi/유선망에 연결한 뒤 다시 시도해 주세요.</p>
<code>접속 IP: ${ip || '확인 불가'}</code></div></body></html>`;

  return new Response(html, {
    status: 403,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}
