/**
 * Contact form → LINE OA (Messaging API push message).
 * Cloudflare Pages Function: served at POST /api/contact (replaces api/contact.php).
 *
 * POST fields: name, phone, brand, year, needs[], detail, website (honeypot)
 * Responds with JSON when the request sends "Accept: application/json" (the site's JS does),
 * otherwise with a small HTML page (form submitted without JavaScript).
 *
 * Settings (Cloudflare dashboard → Pages project → Settings → Variables and Secrets;
 * locally in .dev.vars, which must never be committed):
 *   LINE_CHANNEL_ACCESS_TOKEN  secret — "Channel access token (long-lived)" from LINE Developers
 *   LINE_TO                    userId (U…) or groupId (C…) that receives the notification
 *   LINE_MOCK                  "1" forces mock mode even when a token is set
 *   ALLOWED_ORIGINS            optional, comma separated; defaults to the list below
 * Optional KV binding:
 *   CONTACT_RL                 KV namespace for per-IP rate limiting (skipped when not bound)
 *
 * Messages are always sent to LINE_TO. Missing token / LINE_TO → error 500 (nothing is faked).
 * MOCK mode (LINE_MOCK="1" only): nothing is sent to LINE; the message is written to the
 * Function log instead (`wrangler pages dev` console, or `wrangler pages deployment tail`).
 */

const LINE_PUSH_URL = 'https://api.line.me/v2/bot/message/push';
const DEFAULT_ORIGINS = [
  'https://anpperformance.com',
  'https://www.anpperformance.com',
  'http://localhost',
  'http://localhost:8788'
];
const RATE_LIMIT = { max: 5, windowSeconds: 600 };

const BRANDS = ['Audi', 'Volkswagen', 'Mercedes-Benz', 'BMW', 'Lamborghini', 'Nissan GT-R', 'อื่นๆ'];
const YEARS = ['2024–2026', '2019–2023', '2014–2018', 'ก่อน 2014'];
const NEEDS = ['Stage / Performance', 'ECU Tune', 'TCU Tune', 'Diagnostic', 'Service', 'Performance Parts', 'อื่นๆ'];
const THAI_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

function respond(request, status, data) {
  const headers = {
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store'
  };
  if (status === 405) headers.Allow = 'POST';

  if ((request.headers.get('Accept') || '').includes('application/json')) {
    headers['Content-Type'] = 'application/json; charset=utf-8';
    return new Response(JSON.stringify(data), { status, headers });
  }

  // no-JS fallback page
  headers['Content-Type'] = 'text/html; charset=utf-8';
  const ok = !!data.ok;
  const title = ok ? 'ได้รับข้อมูลแล้ว ขอบคุณครับ' : 'ส่งข้อมูลไม่สำเร็จ';
  const text = ok ? 'ทีมงาน ANP Performance จะติดต่อกลับโดยเร็วที่สุด'
    : escapeHtml(data.message || 'กรุณาลองใหม่ หรือโทร 061-442-2242');
  const html = '<!doctype html><html lang="th"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + `<meta name="robots" content="noindex"><title>${title}</title>`
    + '<body style="font-family:system-ui,sans-serif;background:#0b0b0d;color:#f4f3f1;display:grid;place-items:center;min-height:100vh;margin:0;text-align:center">'
    + `<div><h1>${title}</h1><p>${text}</p><p><a style="color:#ff2a20" href="/#contact">← กลับหน้าเว็บไซต์</a></p></div></body></html>`;
  return new Response(html, { status, headers });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** trim, drop control characters, cap length */
function clean(value, max) {
  if (typeof value !== 'string') return '';
  value = value.replace(/[^\P{C}\n]/gu, '');
  value = value.replace(/[ \t]+/g, ' ').trim();
  return Array.from(value).slice(0, max).join('');
}

/** "14 ต.ค. 2569 16:05 น." in Bangkok time (UTC+7, no DST) */
function thaiNow() {
  const d = new Date(Date.now() + 7 * 3600 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCDate()} ${THAI_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear() + 543} `
    + `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} น.`;
}

/** label on the left, value on the right (receipt style row) */
function flexRow(label, value, extra = {}) {
  return {
    type: 'box',
    layout: 'horizontal',
    spacing: 'md',
    contents: [
      { type: 'text', text: label, size: 'sm', color: '#555555', flex: 0 },
      { type: 'text', text: value || '-', size: 'sm', color: '#111111', align: 'end', wrap: true, ...extra }
    ]
  };
}

/** Flex bubble for a new lead, laid out like the receipt sample in flex.json */
function leadBubble({ name, phoneFmt, digits, brand, year, needs, detail, when }) {
  const rows = [
    flexRow('เบอร์โทร', phoneFmt, { action: { type: 'uri', label: 'โทร', uri: 'tel:' + digits } }),
    flexRow('ยี่ห้อรถ', brand),
    flexRow('ปีรถ', year),
    flexRow('บริการ', needs.join(', '))
  ];
  if (detail) {
    rows.push(
      { type: 'separator', margin: 'xxl' },
      { type: 'text', text: 'รายละเอียด', size: 'sm', color: '#555555', margin: 'xxl' },
      { type: 'text', text: detail, size: 'sm', color: '#111111', wrap: true }
    );
  }

  return {
    type: 'bubble',
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        { type: 'text', text: 'NEW LEAD', weight: 'bold', color: '#E10600', size: 'sm' },
        { type: 'text', text: name, weight: 'bold', size: 'xxl', margin: 'md', wrap: true },
        { type: 'text', text: 'ลูกค้าใหม่จากฟอร์มเว็บไซต์ ANP Performance', size: 'xs', color: '#aaaaaa', wrap: true },
        { type: 'separator', margin: 'xxl' },
        { type: 'box', layout: 'vertical', margin: 'xxl', spacing: 'sm', contents: rows },
        { type: 'separator', margin: 'xxl' },
        {
          type: 'box',
          layout: 'horizontal',
          margin: 'md',
          contents: [
            { type: 'text', text: 'เวลาที่ส่ง', size: 'xs', color: '#aaaaaa', flex: 0 },
            { type: 'text', text: when, size: 'xs', color: '#aaaaaa', align: 'end' }
          ]
        }
      ]
    },
    styles: { footer: { separator: true } }
  };
}

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** true when this IP is over the limit; KV is eventually consistent, so this is a soft limit */
async function rateLimited(env, ip) {
  if (!env.CONTACT_RL) return false;
  const key = 'rl:' + (await sha256(ip + '|anp'));
  const now = Math.floor(Date.now() / 1000);
  const hits = (JSON.parse((await env.CONTACT_RL.get(key)) || '[]'))
    .filter((t) => t > now - RATE_LIMIT.windowSeconds);
  if (hits.length >= RATE_LIMIT.max) return true;
  hits.push(now);
  await env.CONTACT_RL.put(key, JSON.stringify(hits), { expirationTtl: RATE_LIMIT.windowSeconds + 60 });
  return false;
}

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') {
    return respond(request, 405, { ok: false, error: 'method_not_allowed' });
  }

  const origin = (request.headers.get('Origin') || '').replace(/\/$/, '');
  const allowed = env.ALLOWED_ORIGINS
    ? env.ALLOWED_ORIGINS.split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean)
    : DEFAULT_ORIGINS;
  // the site's own origin (e.g. a *.pages.dev preview) is always allowed
  if (origin && origin !== new URL(request.url).origin && !allowed.includes(origin)) {
    return respond(request, 403, { ok: false, error: 'forbidden_origin' });
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    return respond(request, 400, { ok: false, error: 'bad_request' });
  }

  // honeypot filled → pretend success, send nothing
  if (form.get('website')) {
    return respond(request, 200, { ok: true });
  }

  // ---------- rate limit (per IP, optional KV) ----------
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  try {
    if (await rateLimited(env, ip)) {
      return respond(request, 429, {
        ok: false, error: 'rate_limited',
        message: 'ส่งข้อมูลบ่อยเกินไป กรุณารอสักครู่ หรือโทร 061-442-2242'
      });
    }
  } catch (err) {
    console.error('[anp contact] rate limit skipped:', err);
  }

  // ---------- validate ----------
  const name = clean(form.get('name'), 80);
  const phone = clean(form.get('phone'), 20);
  let brand = clean(form.get('brand'), 40);
  let year = clean(form.get('year'), 20);
  const detail = clean(form.get('detail'), 1000);
  const picked = form.getAll('needs[]').concat(form.getAll('needs')).map((n) => clean(n, 40));
  const needs = NEEDS.filter((n) => picked.includes(n));

  const errors = {};
  if (Array.from(name).length < 2) errors.name = 'กรุณากรอกชื่อ';
  let digits = phone.replace(/\D/g, '');
  if (digits.startsWith('66')) digits = '0' + digits.slice(2);
  if (!/^0\d{8,9}$/.test(digits)) errors.phone = 'กรุณากรอกเบอร์โทรศัพท์ให้ถูกต้อง';
  if (brand && !BRANDS.includes(brand)) brand = '';
  if (year && !YEARS.includes(year)) year = '';
  if (Object.keys(errors).length) {
    return respond(request, 422, {
      ok: false, error: 'validation', fields: errors, message: Object.values(errors).join(' / ')
    });
  }

  const phoneFmt = digits.length === 10
    ? `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`
    : digits;

  // ---------- build LINE message ----------
  const to = (env.LINE_TO || '').trim();
  const payload = {
    to,
    messages: [{
      type: 'flex',
      altText: `ลูกค้าใหม่จากเว็บไซต์: ${name} โทร ${phoneFmt}`.slice(0, 400),
      contents: leadBubble({ name, phoneFmt, digits, brand, year, needs, detail, when: thaiNow() })
    }]
  };

  // ---------- send (or mock) ----------
  const token = (env.LINE_CHANNEL_ACCESS_TOKEN || '').trim();
  if (env.LINE_MOCK === '1') {
    console.log('[anp contact] MOCK — not sent to LINE:', JSON.stringify(payload));
    return respond(request, 200, { ok: true, mock: true });
  }
  // never report success for a lead that went nowhere
  if (!token || !to) {
    console.error('[anp contact] not sent: LINE_CHANNEL_ACCESS_TOKEN or LINE_TO is not set');
    return respond(request, 500, {
      ok: false, error: 'not_configured',
      message: 'ระบบส่งข้อมูลขัดข้อง กรุณาโทร 061-442-2242 หรือแอดไลน์ร้าน'
    });
  }

  let status = 0;
  let body = '';
  try {
    const res = await fetch(LINE_PUSH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token,
        'X-Line-Retry-Key': crypto.randomUUID() // makes a retried request idempotent
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000)
    });
    status = res.status;
    body = await res.text();
  } catch (err) {
    body = String(err);
  }

  if (status !== 200) {
    // 400 bad "to" · 401 bad token · 429 monthly quota / rate limit
    console.error('[anp contact] LINE push failed', JSON.stringify({ status, response: body }));
    return respond(request, 502, {
      ok: false, error: 'line_failed',
      message: 'ระบบส่งข้อมูลขัดข้อง กรุณาโทร 061-442-2242 หรือแอดไลน์ร้าน'
    });
  }

  return respond(request, 200, { ok: true });
}
