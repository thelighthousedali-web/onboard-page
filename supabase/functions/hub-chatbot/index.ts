import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// 온보딩 허브 우측하단 챗봇 — 복지/제도/정책 질문에 아래 KNOWLEDGE_BASE 스냅샷을 근거로 답변.
// 한 파일로 유지하는 이유: CLI 배포가 막혀 Supabase 대시보드 에디터(Edge Functions → hub-chatbot → Code)에
// 통째로 붙여넣어 재배포하는 경로를 쓰기 때문(2026-09-11 최초 배포도 이 방식).
// Google Gemini API 무료 티어 사용(2026-09-11, 사용자가 "일단 무료로 시작, 나중에 Anthropic으로 전환" 결정).
// GEMINI_API_KEY는 Supabase 시크릿으로 등록(사용자 개인 구글계정 AI Studio 키). 모델 폴백 체인은 GEMINI_MODELS 참고.
// ⚠️ 나중에 Anthropic(Claude API)로 바꿀 때: SYSTEM_PROMPT/KNOWLEDGE_BASE/로그 저장 로직은 그대로 재사용하고
// "Gemini contents 포맷" 절만 Anthropic Messages API 포맷(messages:[{role,content}], system 필드 분리)으로 교체하면 됨
// (x-api-key/anthropic-version 헤더, model: claude-haiku-4-5, 응답은 data.content[].text)

// 챗봇이 답변 근거로 쓰는 정적 지식베이스 스냅샷.
// 온보딩 허브(index.html)의 실제 렌더링 콘텐츠(회사소개/복지/제도/규정/시스템 안내 18개 페이지)를
// 2026-09-11 로그인 실측(정규직 계정)으로 캡처해 정리한 것 — CMS(page_content) 오버라이드나
// index.html의 render*() 함수가 바뀌면 이 스냅샷도 손으로 갱신해야 함
// (hr-hub의 HG_DEFAULT_HTML 스냅샷과 동일한 관행, [[project-hr-hub]] 참고).
// [공통]/[정규직 전용] 표시는 PAGE_META의 regular 플래그를 그대로 반영.

const KNOWLEDGE_BASE = `
# 헥토큐앤엠 온보딩 허브 지식베이스

## 헥토큐앤엠 소개 [공통]
2018년 설립된 소프트웨어 테스트 전문기업. QA·모니터링·품질 향상을 지속 추구.
핵심가치: 맞춤형 품질보증 / 24시간 365일 모니터링 / 테스트 자동화.
AAA급 게임 QA 경험 실무진 보유(리니지2레볼루션, B&S레볼루션, 검은사막 등), QA 자격증 보유 비율 85%.

## 헥토 그룹 소개 [공통]
비전: 삶의 무한한 가능성을 실현하는 글로벌 라이프테크 컴퍼니.
미션: 우리의 솔루션과 서비스를 통해 모든 사람들이 일상 속 긍정적 변화를 만들어갈 수 있다고 믿습니다.

## 복지제도 안내 [공통 — 단, 항목별 [정규직 전용] 표시 확인]
- 4대 보험(국민연금·건강보험·고용보험·산재보험), 웰컴키트 지급, 연차 유급휴가(워크쓰루 전자결재로 신청), 퇴직연금 DC형(우리은행)
- 조식·중식·석식 제공 (Hecto 앱 '채움'에서 이용시간·메뉴 확인)
- [정규직 전용] 사내 카페(틔움포인트): 월 22,000P 자동충전(매월 1일) · 복지포인트 2만원 차감, Hecto 앱 '틔움'에서 확인, 판매수익금은 기부
- [계약직] 무제한 간식 제공: 사내 구비된 음료·스낵 자유롭게 이용 가능 (계약직은 틔움포인트 대신 이 혜택)
- 사내 도서관: 태광타워 11층, Hecto 앱 '배움'에서 대여(1인 1권/기본 2주/연장가능)
- [정규직 전용] 소통비: 소속부서 팀워크 강화 목적, 1일 재직 기준 인당 50,000원
- [정규직 전용] 사우회 운영: 임직원 경조사 지원
- 경조금·경조휴가·경조물품: 휴가는 발생일 포함 역일 기준, 분할사용 불가(결혼 경조휴가는 예식일로부터 1년 내 사용 가능), 신청기한은 경조 발생일 기준 익월 말일까지(미신청 시 지급 안 됨)
  | 구분 | 대상 | 휴가 | 경조금 | 선물 |
  |---|---|---|---|---|
  | 결혼(본인) | 본인 | 7일(휴일포함) | 50만원 | 화환 |
  | 자녀 결혼 | 자녀 | 1일 | 30만원 | 화환 |
  | (배우자)형제자매 결혼 | - | - | 10만원 | - |
  | 칠순·팔순((배우자)부모) | - | - | 20만원 | 꽃바구니 |
  | 임신(본인·배우자) | - | - | - | 드시모네4500(자기부담금면제) |
  | 출산(본인) | 본인 | 90일(다태아120일) | 20만원 | 과일바구니+유산균6개월 |
  | 출산(배우자) | 배우자 | 20일 | 20만원 | 과일바구니+유산균6개월 |
  | 사망(본인) | 본인 | - | 500만원 | 조화/상조용품 |
  | 사망(배우자·자녀) | - | 5일 | 100만원 | 조화/상조용품 |
  | 사망((배우자)부모) | - | 5일 | 50만원 | 조화/상조용품 |
  | 사망((배우자)조부모·형제자매) | - | 3일 | 20만원 | 조화/상조용품 |
- 생일 상품권 10만원(매년 생일 기준), 명절선물(설날·추석, 부모님10만+개인10만=회당20만, 복지몰 신청)
- 교통비 지원: 오후 10시 이후 야근 시 카카오T 비즈니스 택시
- 주차비: 팀장 자가 주차비 지원 / 휴양시설: 전국 리조트 회원가 예약 / 의료복지: 병원·건강검진 지원(Hecto 앱 '제휴/복지')
- 건강보조식품: 오투부스터·드시모네4500 월 1개, 정액 2만원 구입(차액 회사지원)
- 제휴 할인: 쏘카 카쉐어링, 드시모네몰 직원가(정가 50%)
- 건강검진 반차 제공, 다양한 교육 지원(직무역량 강화 등)
- [정규직 전용] 직원 추천 제도: 추천채용 성공 시 포상금 50만원
- [정규직 전용] 멘토링 제도: 신규 입사자 적응 지원

## 현금성 포인트 [정규직 전용]
| 포인트 | 금액 | 조건 |
|---|---|---|
| 뚜벅포인트 | 최대 연 240만원 | 걸음수 기준 월 최대 20만원, Hecto 앱 'Home' 자동집계(매월1일 동기화 필수) |
| 뚜벅투게더 | 최대 연 40만원 | 5인이상 그룹사 임직원 사진, 분기5회이상=10만/3~4회=5만/2회이하=없음 |
| 웰니스포인트 | 연 60만원 | 청담이든의원 웰니스클리닉, 예약후 방문시 자동차감, 가족사용 가능(최초 가족관계증명서) |
| 생일 상품권 | 연 10만원 | 매년 생일 기준 |
| 명절선물 | 연 40만원 | 설·추석 각 1회, 부모님10만+개인10만=회당20만 |
| 근속 포인트 | 최대 연 50만원 | 입사일 기준 1년당 5만원 증가(최대10년) |
| 평가 포인트 | S등급 100만원 | 전년도 개인평가 S등급 시 |
연간 최대 합계: 약 390만원(뚜벅+뚜벅투게더+웰니스+생일+명절선물 기준)

## 사내 대출제도 [정규직 전용]
대상: 1년 이상 근속자. 무이자, 최대 60개월 분할상환, 퇴사 시 일시상환.
- 주택 매입 한도 5,000만원 / 전·월세 보증금 한도 3,000만원 / 긴급자금 한도 1,000만원
문의: 경영지원팀 이은주 팀장

## 장기 근속 포상 [정규직 전용]
| 근속 | 현금포상 | 특별휴가 | 해외여행 |
|---|---|---|---|
| 5년 | 500만원(세전) | - | - |
| 10년 | 1,000만원(세전) | 14일 연속휴가 | 최대1,000만원 지원 |
| 20년 | 3,000만원(세전) | 14일 연속휴가 | 최대1,000만원 지원 |
계약직 근무기간은 근속연수에 미포함. 휴가 1회 분할사용 가능(1년 이내).
사우회 포상: 3년근속 10만원 / 8년근속 20만원 (강남규 팀장 제출)

## 모성보호 제도 [공통] (2026년 기준)
- 출산전후휴가: 90일(미숙아100일/다태아120일), 출산후 45일 이상 배정 필수, 통상임금 100%(고용보험 지원)
- 배우자 출산휴가: 20일 유급, 출산일로부터 120일 이내, 3회 분할가능
- 육아휴직: 만8세 이하/초2 이하 자녀, 기본1년(부모 각 3개월이상 사용 시 최대1년6개월/3회분할)
- 육아기 근로시간단축: 만12세 이하/초6 이하 자녀, 주15~35시간, 기본1년(미사용기간 2배가산 시 최대3년)
- 임신기 근로시간단축: 임신12주이내 또는 32주이후, 1일2시간 단축, 급여삭감 없음
- 난임치료휴가: 연6일 이내(최초2일 유급), 비밀유지 의무
- 유산·사산휴가: 11주이내5일/12~15주10일/16~21주30일/22~27주60일/28주이상90일
문의: 경영지원팀 김강현 책임

## 상조서비스 [공통]
헥토그룹 장례서비스(프리드라이프) 약 300만원 상당. 대상: 본인·배우자상, 부모상·자녀상·형제자매상·(외)조부모상(배우자기준 포함).
장례전문인력(의전지도사3일/입관보조1명/의전관리사4명), 의전차량, 꽃제단, 고인용품, 상복대여, 빈소용품 등 일체 지원.
문의: 프리드라이프 고객센터 1588-3740 · 경영지원팀

## 휴가 사용 규정 [정규직 전용]
시간단위 휴가(2/4/8시간) 사용 가능, 1일 1회 원칙(조합사용 불가), 법정 연차에만 적용(경조/포상/대체휴가 제외).
승인은 사용 3일전까지 원칙, 미승인 시 지각처리. 개인용무(병원/은행 등)는 시간단위 휴가로 신청.

## 식대 & 주차비 [정규직 전용]
- 식대: 1식 13,000원. 외근 시 점심(11~13시)/저녁(17~19시) 포함 근무 시 지급, 휴일근무도 동일 기준.
  영수증 1장만 처리 가능(한 식당 기준), 저녁은 19시까지 근무 시 청구 가능.
  구내식당 이용 불가 시 팀장/실장/경영지원팀 소명 후 청구 가능.
- 주차비: 주차 미지원자 대상, 휴일근무 시에만 지원(사전 승인 필요). 유류비·교통비는 미지급.

## 협업비 & 직무비 [정규직 전용] (2025-05-07 업데이트)
- 협업비: 외부가이드·헥토그룹사 등 부서간 협업 목적
- 소통비: 조직장의 소속부서 관리·팀빌딩 목적, 1일 재직기준 인당 50,000원 배정
- 협업비/소통비는 동일예산 중복사용 불가. 개인친목/업무무관/예산소진용(회식·선물세트·상품권) 사용 금지.

## 출장 경비 기준 [정규직 전용] (국내출장, 2024-11 업데이트)
제주 제외 지역 항공편 이용 금지(제주는 Economy). 일비는 1박이상만 지급(당일출장 미지급).
| 구분 | 숙박비(1박실비) | 일비(1일) | 식비(1식실비) | 철도 | 버스 |
|---|---|---|---|---|---|
| 임원 | 15만원한도(휴일20만) | 5만원 | 15,000원한도 | KTX특실 | 우등 |
| 수석(팀장)이하 | 7만원한도(휴일9만) | 3만원 | 13,000원한도 | KTX일반실 | - |

## 사내 Wi-Fi [공통]
- PNM타워 4층: Q_Qffice 2.4G/5G, Automation 2.4G/5G — 비밀번호 qoffice1! / automation1!
- 스타팅빌딩 3층: qoffice_stt, qoffice_stt_5G — qoffice1!
- 혜성빌딩 4층: HectoQ&M 2.4G/5G — qoffice1!

## 워크쓰루(WorkThru) 안내 [공통]
차세대 통합 업무 포털 — 전자결재/인사정보시스템(WHR)/네이버웍스/뚜벅틔움포인트 연동.
접속: gw.hecto.co.kr, 사용자 메일주소로 로그인, 초기 비밀번호는 생년월일 6자리(최초 PC 접속 시 변경 필수).

## 전자결재 작성 가이드 [공통]
품의서 작성 순서: ①워크쓰루 좌측 전자결재→기안문작성 ②카테고리(공통/인사/총무/재무/정보보안/물류) 선택 후 양식 클릭
③제목·내용·참조자 작성 ④좌측 조직도에서 결재자(팀장) 선택→Add→적용 ⑤결재요청(상신) 클릭.
주의: 참조자에 부서를 추가하면 결재완료 알림이 안 감 — 개인을 추가해야 메일알림 발송됨.
품의서 작성 전 업무유형별 위임전결 기준안(사내 그룹웨어 게시글)을 먼저 확인할 것.

## 연차 신청 가이드 [공통]
①워크쓰루 전자결재→기안문작성 ②인사카테고리→휴가&경조금 신청서 ③휴가구분(연차/경조휴가/공가/기타휴가/포상휴가), 휴가코드(연차/반차/반반차), 휴가일 선택 ④결재자(팀장) 선택→적용 ⑤결재요청.

## 복지물품 신청 가이드 [공통]
건강보조식품(오투부스터/드시모네4500) 정액 2만원, 1인 월 1개만 구매 가능.
①워크쓰루→인사정보시스템(WHRM 비밀번호=주민등록번호 뒤7자리) ②셀프서비스→복리후생→복지물품신청 ③상품선택(드시모네/오투부스터) ④신청완료.

## 증명서 신청 가이드 [공통]
재직증명서 등. ①인사정보시스템 접속(WHRM 비밀번호=주민등록번호 뒤7자리) ②셀프서비스→증명서관리→증명서신청발급
③증명서종류(재직증명서) 선택, 주민등록번호 포함여부 선택 ④신청건 더블클릭→출력. 신청 즉시 발급 가능.

## 입사 첫날 안내 [공통]
필수 앱: The Hecto App(전화번호 인증, 안되면 장성욱 책임 문의), 네이버웍스(ID=아이디+@hecto.co.kr, PW=생년월일6자리, 로그인 안되면 김강현 책임 문의).
첫날 행정절차(경영지원팀 안내): 인사담당자 티타임 → 회사소개 → 카페포인트 바코드 생성 → 얼굴등록(사무실출입용).
`.trim();

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? '';
// 무료 티어는 모델별로 한도가 따로 잡힘(2026-09-11 실측: gemini-3.6-flash 분당 5회) —
// 1순위가 429(한도초과)/404(단종)/5xx면 다음 모델로 자동 폴백해서 무료로도 동시 사용을 버팀.
// gemini-2.5-flash는 "no longer available to new users"(404)라 제외. GEMINI_MODELS 시크릿(쉼표구분)으로 재배포 없이 교체 가능.
const GEMINI_MODELS = (Deno.env.get('GEMINI_MODELS') || 'gemini-3.6-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-flash-lite-latest')
  .split(',').map((s) => s.trim()).filter(Boolean);
const MAX_HISTORY_TURNS = 6; // 컨텍스트 비용/무료한도 절감 — 최근 6턴만 유지

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

const SYSTEM_PROMPT = `당신은 헥토큐앤엠 임직원을 위한 온보딩 허브의 사내 도우미 챗봇입니다.
아래 <지식베이스> 안의 내용만 근거로 답변하세요. 지식베이스에 없는 내용은 절대 추측하거나 지어내지 말고,
"해당 내용은 제가 가진 안내 자료에는 없어요. 정확한 내용은 경영지원팀에 문의해주세요"처럼 안내하세요.
- 질문자가 계약직이면 "[정규직 전용]" 항목은 대상이 아님을 알려주세요. 정규직에게는 "[계약직]" 항목을 안내하지 마세요.
- 금액·기한·절차 등 숫자는 지식베이스에 있는 그대로 정확히 인용하세요.
- 계약직이 정규직 전용 혜택을 물으면, 계약직에게 대신 제공되는 혜택이 있으면 함께 안내하세요(예: 틔움포인트 대신 무제한 간식).
- 답변에 "지식베이스", "[정규직 전용]", "[계약직]", "[공통]" 같은 내부 표기는 쓰지 말고 자연스러운 문장으로 쓰세요.
- 답변은 한국어로, 2~5문장 정도로 간결하게. 필요하면 목록으로 정리하세요.
- 사내 시스템(워크쓰루 등) 로그인 정보나 개인정보(주민번호 등)를 요구하는 절차는 안내하되, 사용자의 실제 개인정보를 입력받으려 하지 마세요.

<지식베이스>
${KNOWLEDGE_BASE}
</지식베이스>`;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  if (!GEMINI_API_KEY) return json({ error: '챗봇이 아직 설정 중입니다. 잠시 후 다시 시도해주세요.' }, 503);

  // deno-lint-ignore no-explicit-any
  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'invalid json' }, 400); }

  const message = String(body?.message ?? '').trim();
  if (!message) return json({ error: 'message is required' }, 400);
  if (message.length > 1000) return json({ error: '질문이 너무 깁니다 (최대 1000자)' }, 400);

  const history = Array.isArray(body?.history) ? body.history.slice(-MAX_HISTORY_TURNS) : [];
  const user = body?.user || {};
  const userContext = user?.name
    ? `[질문자: ${user.name}, 구분: ${user.employeeType === 'regular' ? '정규직' : '계약직'}]\n`
    : '';

  // Gemini contents 포맷: role은 user/model, assistant → model로 매핑
  const contents = [
    ...history
      .filter((h: any) => h && typeof h.text === 'string' && (h.role === 'user' || h.role === 'assistant'))
      .map((h: any) => ({ role: h.role === 'assistant' ? 'model' : 'user', parts: [{ text: h.text }] })),
    { role: 'user', parts: [{ text: userContext + message }] },
  ];

  // thinkingLevel 'minimal': Gemini 3.x는 기본적으로 "생각" 토큰을 수백 개 써서 출력한도를 먹고 답이 잘림(MAX_TOKENS) +
  // 응답도 5~14초로 느려짐 — 사내 FAQ엔 추론이 거의 필요 없어 minimal로 1~2초 응답. (thinkingBudget:0은 3.x에서 400 에러)
  const requestBody = JSON.stringify({
    system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents,
    generationConfig: { maxOutputTokens: 1024, temperature: 0.3, thinkingConfig: { thinkingLevel: 'minimal' } },
  });

  let reply = '';
  let usedModel = '';
  let sawRateLimit = false;
  for (const model of GEMINI_MODELS) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: requestBody,
      });
      if (!res.ok) {
        console.error('gemini error', model, res.status, (await res.text()).slice(0, 300));
        if (res.status === 429) sawRateLimit = true;
        continue; // 한도초과/단종/일시장애 → 다음 모델
      }
      const data = await res.json();
      const parts = data?.candidates?.[0]?.content?.parts ?? [];
      reply = parts.map((p: any) => p?.text ?? '').join('').trim();
      usedModel = model;
      break;
    } catch (e) {
      console.error('gemini fetch failed', model, e);
    }
  }

  if (!usedModel) {
    if (sawRateLimit) return json({ error: '지금 문의가 몰려 있어요. 1분 정도 뒤에 다시 시도해주세요.' }, 429);
    return json({ error: '챗봇 응답 생성에 실패했습니다. 잠시 후 다시 시도해주세요.' }, 502);
  }
  if (!reply) {
    // 안전필터 등으로 빈 응답이 오는 경우(finishReason: SAFETY 등)
    reply = '죄송합니다, 이 질문에는 답변을 생성하지 못했습니다. 다르게 질문해보시거나 경영지원팀에 문의해주세요.';
  }

  // 대화 로그 best-effort 저장(관리자 품질개선용) — 테이블 없거나 실패해도 응답에는 영향 없음
  try {
    const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    await sb.from('chat_logs').insert({
      user_email: user?.email ?? null,
      user_name: user?.name ?? null,
      employee_type: user?.employeeType ?? null,
      message,
      reply,
      model: usedModel,
    });
  } catch (_e) { /* 로그 실패는 무시 */ }

  return json({ reply });
});
