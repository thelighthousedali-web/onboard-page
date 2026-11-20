// 사내 공인 IP 접속 제한 (Vercel Routing Middleware — 모든 요청 앞단에서 실행)
// 2026-10-23 보안 공지 대응: 사내 공인 IP 외에서는 페이지 자체를 403으로 차단.
// IP 추가/변경 시 ALLOWED_IPS만 수정 후 push하면 됨.
//
// 2026-11-20 기기 등록(HR 허브와 같은 방식): 등록된 기기는 서명된 쿠키(hq_trust)로 TRUST_DAYS 동안 회사 밖에서도 접속 허용.
//  ① 회사 밖: 차단 화면의 등록 폼에서 이메일+비밀번호+OTP 6자리 → hr-auth로 검증(OTP 설정된 관리자 계정만 가능)
//  ② 회사 안: 휴대폰으로 사내 IP에서 접속하면 자동 등록. 사내에서 다시 쓰면 기한 연장.
// 서명 키는 Vercel 환경변수 DEVICE_TRUST_SECRET(이 프로젝트에도 따로 등록) — 없으면 기기 등록 기능 전체가 꺼짐(IP 제한만 동작).
// 키를 바꾸면 등록된 기기 전체가 즉시 무효화됨(분실 등 긴급 시).

const ALLOWED_IPS = new Set([
  // PNM 타워
  '61.74.175.185',
  '61.74.175.186',
  // 스타팅 빌딩
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

const TRUST_COOKIE = 'hq_trust';
const TRUST_PATH = '/__trust';
const TRUST_DAYS = 90;
const RENEW_BELOW_DAYS = 80; // 남은 기한이 이보다 짧을 때만 재발급
const MOBILE_UA = /iPhone|Android/i; // 사내 자동 등록은 휴대폰만
const DAY_MS = 86400000;

// HR 허브와 같은 공개(anon) 키·함수 — hr-auth가 비밀번호·OTP를 서버에서 검증
const HR_AUTH_URL = 'https://lzsfdbspvypljsyviakh.supabase.co/functions/v1/hr-auth';
const SUPABASE_ANON = 'sb_publishable_pEMmU4vVPtn7EteLHpOByw_nJZiCpQc';

export const config = { matcher: '/:path*' };

function getSecret() {
  return (typeof process !== 'undefined' && process.env && process.env.DEVICE_TRUST_SECRET) || '';
}

function b64url(buf) {
  let s = '';
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sign(secret, exp) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('v1.' + exp)));
}

// 유효하면 만료시각(ms), 아니면 0
async function trustedUntil(request, secret) {
  const m = (request.headers.get('cookie') || '').match(/(?:^|;\s*)hq_trust=(\d+)\.([A-Za-z0-9_-]+)/);
  if (!m) return 0;
  const exp = Number(m[1]);
  if (!(exp > Date.now()) || exp > Date.now() + TRUST_DAYS * DAY_MS + DAY_MS) return 0;
  return (await sign(secret, exp)) === m[2] ? exp : 0;
}

async function trustCookie(secret) {
  const exp = Date.now() + TRUST_DAYS * DAY_MS;
  return `${TRUST_COOKIE}=${exp}.${await sign(secret, exp)}; Max-Age=${TRUST_DAYS * 86400}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

async function callHrAuth(payload) {
  const res = await fetch(HR_AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_ANON}` },
    body: JSON.stringify(payload),
  }).catch(() => null);
  const data = res ? await res.json().catch(() => ({})) : {};
  return { ok: !!res && res.ok, data };
}

// 비밀번호+OTP 검증 — 성공 시 null, 실패 시 화면에 보여줄 문구
async function verifyLoginWithOtp(email, password, code) {
  if (!email || !password || !/^\d{6}$/.test(code)) return '이메일, 비밀번호, OTP 6자리를 모두 입력해 주세요.';
  const login = await callHrAuth({ action: 'login', email, password });
  if (!login.ok) return login.data.error || '로그인에 실패했습니다.';
  if (!login.data.needsTotp) return '2차 인증(OTP)이 설정된 계정만 회사 밖에서 등록할 수 있습니다. 회사 Wi-Fi에서 접속해 주세요.';
  const otp = await callHrAuth({ action: 'totp_verify_login', pendingToken: login.data.pendingToken, code });
  if (!otp.ok) return otp.data.error || 'OTP 인증에 실패했습니다.';
  return null;
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function blockedPage(ip, canRegister, { error = '', email = '' } = {}) {
  const form = canRegister ? `
<div class="reg"><h2>이 기기 등록</h2>
<p class="sub">2차 인증(OTP)을 쓰는 관리자 계정은 여기서 등록하면<br>이 기기에서 ${TRUST_DAYS}일 동안 회사 밖에서도 이용할 수 있습니다.</p>
${error ? `<p class="err">${esc(error)}</p>` : ''}
<form method="post" action="${TRUST_PATH}">
<input name="email" type="email" placeholder="이메일" autocomplete="username" value="${esc(email)}" required>
<input name="password" type="password" placeholder="비밀번호" autocomplete="current-password" required>
<input name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" placeholder="OTP 6자리" autocomplete="one-time-code" required>
<button type="submit">등록하기</button></form>
<p class="sub">OTP가 없는 계정은 휴대폰을 회사 Wi-Fi에 연결해 한 번 접속하면 자동 등록됩니다.</p></div>` : '';

  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>접속 제한</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
font-family:'Malgun Gothic',sans-serif;background:#f6f6f6;color:#222}
.box{background:#fff;padding:36px 32px;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,.08);max-width:420px;margin:16px;text-align:center}
h1{font-size:20px;margin:0 0 12px}h2{font-size:16px;margin:0 0 8px}p{font-size:14px;line-height:1.6;color:#555;margin:0}
code{display:inline-block;margin-top:14px;padding:4px 10px;background:#f1f1f1;border-radius:6px;font-size:13px;color:#333}
.reg{margin-top:24px;padding-top:20px;border-top:1px solid #eee}.sub{font-size:13px;color:#777;margin-top:8px}
.err{font-size:13px;color:#d32f2f;margin-top:10px}
form{display:flex;flex-direction:column;gap:8px;margin-top:14px}
input{padding:11px 12px;border:1px solid #ddd;border-radius:8px;font-size:15px}
button{padding:12px;border:0;border-radius:8px;background:#FF5500;color:#fff;font-size:15px;font-weight:bold}</style>
</head><body><div class="box"><h1>사내 네트워크에서만 접속 가능합니다</h1>
<p>보안 정책에 따라 회사 공인 IP에서만 이용할 수 있습니다.<br>사내 Wi-Fi/유선망에 연결한 뒤 다시 시도해 주세요.</p>
<code>접속 IP: ${esc(ip || '확인 불가')}</code>${form}</div></body></html>`;
}

function htmlResponse(html, status) {
  return new Response(html, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export default async function middleware(request) {
  const { pathname } = new URL(request.url);
  if (PUBLIC_ASSETS.has(pathname)) return;

  // x-real-ip는 Vercel이 실제 접속 IP로 덮어써서 넣는 값(클라이언트가 위조 불가)
  const ip = (request.headers.get('x-real-ip')
    || (request.headers.get('x-forwarded-for') || '').split(',')[0]).trim().replace(/[^0-9a-fA-F:.]/g, '');
  const secret = getSecret();

  // ① 차단 화면의 등록 폼 제출
  if (pathname === TRUST_PATH && request.method === 'POST' && secret) {
    const form = await request.formData().catch(() => null);
    const email = String(form?.get('email') || '').trim();
    const error = await verifyLoginWithOtp(email, String(form?.get('password') || ''), String(form?.get('code') || '').trim());
    if (error) return htmlResponse(blockedPage(ip, true, { error, email }), 403);
    return new Response(null, { status: 303, headers: { location: '/', 'set-cookie': await trustCookie(secret), 'cache-control': 'no-store' } });
  }

  if (ALLOWED_IPS.has(ip)) {
    // ② 사내에서 접속한 휴대폰은 자동 등록(또는 기한 연장)
    if (secret && MOBILE_UA.test(request.headers.get('user-agent') || '')) {
      const until = await trustedUntil(request, secret);
      if (until - Date.now() < RENEW_BELOW_DAYS * DAY_MS) {
        return new Response(null, { headers: { 'x-middleware-next': '1', 'set-cookie': await trustCookie(secret) } });
      }
    }
    return;
  }

  if (secret && await trustedUntil(request, secret)) return;

  return htmlResponse(blockedPage(ip, !!secret), 403);
}
