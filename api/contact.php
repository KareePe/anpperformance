<?php
/**
 * Contact form → LINE OA (Messaging API push message).
 *
 * POST fields: name, phone, brand, year, needs[], detail, website (honeypot)
 * Responds with JSON when the request sends "Accept: application/json" (the site's JS does),
 * otherwise with a small HTML page (form submitted without JavaScript).
 *
 * MOCK mode (no token yet): messages are appended to storage/line-mock.log, nothing is sent.
 */
declare(strict_types=1);

$config = require __DIR__ . '/config.php';
date_default_timezone_set($config['timezone'] ?? 'Asia/Bangkok');

const STORAGE = __DIR__ . '/storage';
const LINE_PUSH_URL = 'https://api.line.me/v2/bot/message/push';

$wantsJson = str_contains($_SERVER['HTTP_ACCEPT'] ?? '', 'application/json');

function respond(int $status, array $data): never
{
    global $wantsJson;
    http_response_code($status);
    header('X-Content-Type-Options: nosniff');
    header('Cache-Control: no-store');

    if ($wantsJson) {
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode($data, JSON_UNESCAPED_UNICODE);
        exit;
    }

    // no-JS fallback page
    header('Content-Type: text/html; charset=utf-8');
    $ok = $data['ok'] ?? false;
    $title = $ok ? 'ได้รับข้อมูลแล้ว ขอบคุณครับ' : 'ส่งข้อมูลไม่สำเร็จ';
    $text = $ok ? 'ทีมงาน ANP Performance จะติดต่อกลับโดยเร็วที่สุด'
                : htmlspecialchars($data['message'] ?? 'กรุณาลองใหม่ หรือโทร 061-442-2242', ENT_QUOTES);
    echo "<!doctype html><html lang=\"th\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
       . "<meta name=\"robots\" content=\"noindex\"><title>{$title}</title>"
       . "<body style=\"font-family:system-ui,sans-serif;background:#0b0b0d;color:#f4f3f1;display:grid;place-items:center;min-height:100vh;margin:0;text-align:center\">"
       . "<div><h1>{$title}</h1><p>{$text}</p><p><a style=\"color:#ff2a20\" href=\"../index.html#contact\">← กลับหน้าเว็บไซต์</a></p></div></body></html>";
    exit;
}

/** append one JSON line to storage/$file; false if the folder isn't writable */
function log_line(string $file, array $row): bool
{
    if (!is_dir(STORAGE)) {
        @mkdir(STORAGE, 0775, true);
    }
    $ok = @file_put_contents(STORAGE . '/' . $file, json_encode($row, JSON_UNESCAPED_UNICODE) . "\n", FILE_APPEND | LOCK_EX);
    if ($ok === false) {
        error_log('[anp contact] cannot write ' . STORAGE . '/' . $file . ' — make api/storage writable by the web server');
        return false;
    }
    return true;
}

/** trim, drop control characters, cap length */
function clean(mixed $value, int $max): string
{
    if (!is_string($value)) {
        return '';
    }
    $value = preg_replace('/[^\P{C}\n]/u', '', $value) ?? '';
    $value = trim(preg_replace('/[ \t]+/u', ' ', $value) ?? '');
    return mb_substr($value, 0, $max);
}

// ---------- request checks ----------
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    header('Allow: POST');
    respond(405, ['ok' => false, 'error' => 'method_not_allowed']);
}

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$allowed = $config['allowed_origins'] ?? [];
if ($origin !== '' && $allowed && !in_array(rtrim($origin, '/'), $allowed, true)) {
    respond(403, ['ok' => false, 'error' => 'forbidden_origin']);
}

// honeypot filled → pretend success, send nothing
if (!empty($_POST['website'])) {
    respond(200, ['ok' => true]);
}

// ---------- rate limit (per IP, file based) ----------
$ipKey = hash('sha256', ($_SERVER['REMOTE_ADDR'] ?? 'unknown') . '|anp');
$limit = $config['rate_limit'] ?? ['max' => 5, 'window_seconds' => 600];
$rlFile = STORAGE . '/ratelimit.json';
if (!is_dir(STORAGE)) {
    @mkdir(STORAGE, 0775, true);
}
$fh = @fopen($rlFile, 'c+');
if (!$fh) {
    error_log('[anp contact] rate limit disabled: cannot write ' . $rlFile);
}
if ($fh && flock($fh, LOCK_EX)) {
    $hits = json_decode(stream_get_contents($fh) ?: '{}', true) ?: [];
    $now = time();
    foreach ($hits as $k => $times) {
        $hits[$k] = array_values(array_filter($times, fn($t) => $t > $now - $limit['window_seconds']));
        if (!$hits[$k]) {
            unset($hits[$k]);
        }
    }
    $tooMany = count($hits[$ipKey] ?? []) >= $limit['max'];
    if (!$tooMany) {
        $hits[$ipKey][] = $now;
    }
    ftruncate($fh, 0);
    rewind($fh);
    fwrite($fh, json_encode($hits));
    flock($fh, LOCK_UN);
    fclose($fh);
    if ($tooMany) {
        respond(429, ['ok' => false, 'error' => 'rate_limited',
            'message' => 'ส่งข้อมูลบ่อยเกินไป กรุณารอสักครู่ หรือโทร 061-442-2242']);
    }
}

// ---------- validate ----------
$brands = ['Audi', 'Volkswagen', 'Mercedes-Benz', 'BMW', 'Nissan GT-R', 'อื่นๆ'];
$years  = ['2024–2026', '2019–2023', '2014–2018', 'ก่อน 2014'];
$needsAllowed = ['Stage / Performance', 'ECU Tune', 'TCU Tune', 'Diagnostic', 'Service', 'Performance Parts', 'อื่นๆ'];

$name   = clean($_POST['name'] ?? '', 80);
$phone  = clean($_POST['phone'] ?? '', 20);
$brand  = clean($_POST['brand'] ?? '', 40);
$year   = clean($_POST['year'] ?? '', 20);
$detail = clean($_POST['detail'] ?? '', 1000);
$needs  = array_values(array_intersect($needsAllowed, array_map(fn($n) => clean($n, 40), (array) ($_POST['needs'] ?? []))));

$errors = [];
if (mb_strlen($name) < 2) {
    $errors['name'] = 'กรุณากรอกชื่อ';
}
$digits = preg_replace('/\D/', '', $phone) ?? '';
if (str_starts_with($digits, '66')) {
    $digits = '0' . substr($digits, 2);
}
if (!preg_match('/^0\d{8,9}$/', $digits)) {
    $errors['phone'] = 'กรุณากรอกเบอร์โทรศัพท์ให้ถูกต้อง';
}
if ($brand !== '' && !in_array($brand, $brands, true)) {
    $brand = '';
}
if ($year !== '' && !in_array($year, $years, true)) {
    $year = '';
}
if ($errors) {
    respond(422, ['ok' => false, 'error' => 'validation', 'fields' => $errors, 'message' => implode(' / ', $errors)]);
}

$phoneFmt = strlen($digits) === 10
    ? substr($digits, 0, 3) . '-' . substr($digits, 3, 3) . '-' . substr($digits, 6)
    : $digits;

// ---------- build LINE message ----------
$thaiMonths = ['', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
$when = date('j') . ' ' . $thaiMonths[(int) date('n')] . ' ' . (date('Y') + 543) . ' ' . date('H:i') . ' น.';

$car = trim(implode(' · ', array_filter([$brand, $year])));
$lines = [
    '🚗 ลูกค้าใหม่จากเว็บไซต์',
    '━━━━━━━━━━━━',
    "👤 ชื่อ: {$name}",
    "📞 โทร: {$phoneFmt}",
    '🚙 รถ: ' . ($car !== '' ? $car : '-'),
    '🔧 บริการ: ' . ($needs ? implode(', ', $needs) : '-'),
];
if ($detail !== '') {
    $lines[] = "📝 รายละเอียด: {$detail}";
}
$lines[] = '━━━━━━━━━━━━';
$lines[] = "🕒 {$when}";
$text = mb_substr(implode("\n", $lines), 0, 4900); // LINE text limit is 5,000 chars

$payload = [
    'to' => $config['to'] ?? '',
    'messages' => [['type' => 'text', 'text' => $text]],
];

// ---------- send (or mock) ----------
$token = trim((string) ($config['channel_access_token'] ?? ''));
$isMock = !empty($config['mock']) || $token === '' || trim((string) ($config['to'] ?? '')) === '';

if ($isMock) {
    // never report success if the lead wasn't actually saved anywhere
    if (!log_line('line-mock.log', ['time' => date('c'), 'mock' => true, 'payload' => $payload])) {
        respond(500, ['ok' => false, 'error' => 'storage_not_writable',
            'message' => 'ระบบบันทึกข้อมูลขัดข้อง กรุณาโทร 061-442-2242 หรือแอดไลน์ร้าน']);
    }
    respond(200, ['ok' => true, 'mock' => true]);
}

$retryKey = sprintf('%04x%04x-%04x-4%03x-%04x-%04x%04x%04x',
    random_int(0, 0xffff), random_int(0, 0xffff), random_int(0, 0xffff), random_int(0, 0x0fff),
    random_int(0x8000, 0xbfff), random_int(0, 0xffff), random_int(0, 0xffff), random_int(0, 0xffff));

$ch = curl_init(LINE_PUSH_URL);
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 10,
    CURLOPT_HTTPHEADER => [
        'Content-Type: application/json',
        'Authorization: Bearer ' . $token,
        'X-Line-Retry-Key: ' . $retryKey, // makes a retried request idempotent
    ],
    CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE),
]);
$body = curl_exec($ch);
$status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
$curlErr = curl_error($ch);
curl_close($ch);

if ($status !== 200) {
    // 400 bad "to" · 401 bad token · 429 monthly quota / rate limit
    log_line('error.log', ['time' => date('c'), 'status' => $status, 'curl' => $curlErr, 'response' => $body]);
    respond(502, ['ok' => false, 'error' => 'line_failed',
        'message' => 'ระบบส่งข้อมูลขัดข้อง กรุณาโทร 061-442-2242 หรือแอดไลน์ร้าน']);
}

respond(200, ['ok' => true]);
