/**
 * SMILE SERVICE — LINE Rich Menu Setup Script
 * รัน: node scripts/setupRichMenu.js TOKEN_HERE
 *
 * ไม่ต้องติดตั้ง package เพิ่ม — ใช้ Node.js built-in https เท่านั้น
 *
 * Layout 2×3:
 * ┌──────────────┬──────────────┬──────────────┐
 * │  🚗 จองรถ    │  📍 ติดตาม   │  📋 ประวัติ  │
 * ├──────────────┼──────────────┼──────────────┤
 * │  🚕 สมัครขับ │  💰 รายได้   │  🚘 Dashboard│
 * └──────────────┴──────────────┴──────────────┘
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const TOKEN = process.argv[2] || process.env.LINE_CHANNEL_ACCESS_TOKEN;
if (!TOKEN) {
  console.error('Usage: node scripts/setupRichMenu.js <CHANNEL_ACCESS_TOKEN>');
  process.exit(1);
}

// ── LIFF IDs ─────────────────────────────────────────────────
const LIFF = {
  booking:        '2010302940-r8fyRQ5T',
  tracking:       '2010302940-OkUFUmmC',
  history:        '2010302940-rA3rldc8',
  driverRegister: '2010302940-kydrDPqR',
  driverEarnings: '2010302940-zf0kBZhi',
  driverDashboard:'2010302940-SHDQOH1K',
};
const liffUrl = id => `https://liff.line.me/${id}`;

// ── Rich Menu 2500×1686 แบ่ง 2×3 ─────────────────────────────
const W = 2500, H = 1686;
const CW = Math.floor(W / 3);
const RH = Math.floor(H / 2);

const richMenuBody = {
  size: { width: W, height: H },
  selected: true,
  name: 'SMILE SERVICE Menu',
  chatBarText: '☰ เมนู SMILE SERVICE',
  areas: [
    { bounds: { x: 0,      y: 0,  width: CW, height: RH }, action: { type: 'uri', uri: liffUrl(LIFF.booking),        label: 'จองรถ'    } },
    { bounds: { x: CW,     y: 0,  width: CW, height: RH }, action: { type: 'uri', uri: liffUrl(LIFF.tracking),       label: 'ติดตามรถ' } },
    { bounds: { x: CW * 2, y: 0,  width: CW, height: RH }, action: { type: 'uri', uri: liffUrl(LIFF.history),        label: 'ประวัติ'  } },
    { bounds: { x: 0,      y: RH, width: CW, height: RH }, action: { type: 'uri', uri: liffUrl(LIFF.driverRegister), label: 'สมัครขับ' } },
    { bounds: { x: CW,     y: RH, width: CW, height: RH }, action: { type: 'uri', uri: liffUrl(LIFF.driverEarnings), label: 'รายได้'   } },
    { bounds: { x: CW * 2, y: RH, width: CW, height: RH }, action: { type: 'uri', uri: liffUrl(LIFF.driverDashboard),label: 'Dashboard' } },
  ],
};

// ── Helpers ───────────────────────────────────────────────────
function lineRequest(method, path, body, isData = false) {
  return new Promise((resolve, reject) => {
    const isBuffer = Buffer.isBuffer(body);
    const host  = isData ? 'api-data.line.me' : 'api.line.me';
    const ctype = isBuffer ? 'image/png' : 'application/json';
    const payload = isBuffer ? body : (body ? Buffer.from(JSON.stringify(body)) : null);
    const opts = {
      hostname: host,
      path: `/v2/bot${path}`,
      method,
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': ctype,
        ...(payload ? { 'Content-Length': payload.length } : {}),
      },
    };
    const req = https.request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        if (res.statusCode >= 400) return reject(new Error(`${res.statusCode}: ${text}`));
        try { resolve(JSON.parse(text)); } catch { resolve(text); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ── Generate SVG menu image ───────────────────────────────────
function generateMenuSVG() {
  const cells = [
    { emoji: '🚗', th: 'จองรถ',    en: 'Book a Ride',     col: 0, row: 0, bg: '#1a9e5f' },
    { emoji: '📍', th: 'ติดตามรถ', en: 'Track Driver',    col: 1, row: 0, bg: '#1a7aad' },
    { emoji: '📋', th: 'ประวัติ',  en: 'My Bookings',     col: 2, row: 0, bg: '#7a3fb5' },
    { emoji: '🚕', th: 'สมัครขับ', en: 'Become a Driver', col: 0, row: 1, bg: '#c8651a' },
    { emoji: '💰', th: 'รายได้',   en: 'My Earnings',     col: 1, row: 1, bg: '#0d8c77' },
    { emoji: '🚘', th: 'Dashboard', en: 'Driver Hub',      col: 2, row: 1, bg: '#b03030' },
  ];
  const GAP = 4, cw = W / 3, ch = H / 2;
  const rects = cells.map(c => {
    const x = c.col * cw + GAP, y = c.row * ch + GAP;
    const w = cw - GAP * 2,    h = ch - GAP * 2;
    const cx = x + w / 2,      cy = y + h / 2;
    return `
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="30" fill="${c.bg}"/>
    <text x="${cx}" y="${cy-90}" font-size="200" text-anchor="middle" dominant-baseline="middle">${c.emoji}</text>
    <text x="${cx}" y="${cy+110}" font-size="115" font-weight="bold" fill="white" text-anchor="middle" font-family="Arial,sans-serif">${c.th}</text>
    <text x="${cx}" y="${cy+240}" font-size="68" fill="rgba(255,255,255,0.65)" text-anchor="middle" font-family="Arial,sans-serif">${c.en}</text>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#111827"/>
  ${rects}
  <line x1="0" y1="${ch}" x2="${W}" y2="${ch}" stroke="rgba(0,0,0,0.3)" stroke-width="8"/>
  <line x1="${cw}" y1="0" x2="${cw}" y2="${H}" stroke="rgba(0,0,0,0.3)" stroke-width="8"/>
  <line x1="${cw*2}" y1="0" x2="${cw*2}" y2="${H}" stroke="rgba(0,0,0,0.3)" stroke-width="8"/>
  <text x="16" y="${ch-16}" font-size="52" fill="rgba(255,255,255,0.35)" font-family="Arial,sans-serif">สำหรับลูกค้า</text>
  <text x="16" y="${H-16}" font-size="52" fill="rgba(255,255,255,0.35)" font-family="Arial,sans-serif">สำหรับคนขับ</text>
</svg>`;
}

// ── Main ──────────────────────────────────────────────────────
async function main() {
  console.log('🚀 กำลังสร้าง Rich Menu...\n');

  // 1. ลบ menu เดิม
  try {
    const list = await lineRequest('GET', '/richmenu/list');
    for (const m of list.richmenus || []) {
      await lineRequest('DELETE', `/richmenu/${m.richMenuId}`);
      console.log(`🗑  ลบ menu เดิม: ${m.richMenuId}`);
    }
  } catch { /* ไม่มีเดิม */ }

  // 2. สร้าง menu ใหม่
  const created = await lineRequest('POST', '/richmenu', richMenuBody);
  const menuId = created.richMenuId;
  console.log(`✅ สร้าง Rich Menu: ${menuId}`);

  // 3. บันทึก SVG (สำหรับ upload เองถ้าต้องการ)
  const svgPath = path.join(__dirname, 'richmenu.svg');
  fs.writeFileSync(svgPath, generateMenuSVG());
  console.log(`🖼  SVG image: ${svgPath}`);

  // 4. แปลง SVG เป็น PNG ด้วย sharp (optional)
  let uploaded = false;
  try {
    const sharp = require('sharp');
    const png = await sharp(Buffer.from(fs.readFileSync(svgPath))).png().toBuffer();
    await lineRequest('POST', `/richmenu/${menuId}/content`, png, true);
    console.log('✅ อัปโหลดรูปสำเร็จ');
    uploaded = true;
  } catch {
    console.log('ℹ️  ไม่มี sharp — อัปโหลดรูปเองใน LINE OA Manager (ดูขั้นตอนด้านล่าง)');
  }

  // 5. ตั้งเป็น default
  await lineRequest('POST', `/user/all/richmenu/${menuId}`);
  console.log('✅ ตั้งเป็น Default Rich Menu สำเร็จ\n');

  console.log('🎉 Rich Menu พร้อมใช้งาน!');
  if (!uploaded) {
    console.log('\n📌 อัปโหลดรูปเอง:');
    console.log('   1. ไปที่ https://manager.line.biz → Rich Menu');
    console.log(`   2. หา menu ชื่อ "SMILE SERVICE Menu" (ID: ${menuId})`);
    console.log('   3. อัปโหลดรูปที่ได้จาก scripts/richmenu.svg (แปลงเป็น PNG ก่อน)');
    console.log('   หรือใช้ Squoosh / Cloudconvert แปลง SVG → PNG ขนาด 2500×1686');
  }
  console.log('\nURL ปุ่มแต่ละปุ่ม:');
  console.log(`  🚗 จองรถ     → ${liffUrl(LIFF.booking)}`);
  console.log(`  📍 ติดตามรถ  → ${liffUrl(LIFF.tracking)}`);
  console.log(`  📋 ประวัติ   → ${liffUrl(LIFF.history)}`);
  console.log(`  🚕 สมัครขับ  → ${liffUrl(LIFF.driverRegister)}`);
  console.log(`  💰 รายได้    → ${liffUrl(LIFF.driverEarnings)}`);
  console.log(`  🚘 Dashboard → ${liffUrl(LIFF.driverDashboard)}`);
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
