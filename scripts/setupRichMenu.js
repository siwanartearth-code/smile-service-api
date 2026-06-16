/**
 * SMILE SERVICE — LINE Rich Menu Setup Script
 * รัน: node scripts/setupRichMenu.js
 *
 * Layout 2×3:
 * ┌──────────────┬──────────────┬──────────────┐
 * │  🚗 จองรถ    │  📍 ติดตาม   │  📋 ประวัติ  │
 * ├──────────────┼──────────────┼──────────────┤
 * │  🚕 สมัครขับ │  💰 รายได้   │  📄 เอกสาร  │
 * └──────────────┴──────────────┴──────────────┘
 */

require('dotenv').config();
const axios = require('axios');
const fs    = require('fs');
const path  = require('path');

const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
// LIFF ID เดียว แยกหน้าด้วย ?page=
// LIFF IDs แต่ละหน้า
const LIFF = {
  booking:        '2010302940-r8fyRQ5T',
  tracking:       '2010302940-OkUFUmmC',
  history:        '2010302940-rA3rldc8',
  driverRegister: '2010302940-kydrDPqR',
  driverEarnings: '2010302940-zf0kBZhi',
  driverDashboard:'2010302940-SHDQOH1K',
};

function liffUrl(id) {
  return `https://liff.line.me/${id}`;
}

const LINE_API = axios.create({
  baseURL: 'https://api.line.me/v2/bot',
  headers: {
    Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`,
    'Content-Type': 'application/json',
  },
});

// ── Rich Menu Layout 2500×1686 แบ่ง 2 แถว 3 คอลัมน์ ──────────
const W = 2500, H = 1686;
const CW = Math.floor(W / 3);  // 833 px
const RH = Math.floor(H / 2);  // 843 px

const richMenuBody = {
  size: { width: W, height: H },
  selected: true,
  name: 'SMILE SERVICE Menu',
  chatBarText: '☰ เมนู SMILE SERVICE',
  areas: [
    // แถวบน: ลูกค้า
    { bounds: { x: 0,       y: 0,  width: CW, height: RH }, action: { type: 'uri', uri: liffUrl(LIFF.booking),        label: 'จองรถ'    } },
    { bounds: { x: CW,      y: 0,  width: CW, height: RH }, action: { type: 'uri', uri: liffUrl(LIFF.tracking),       label: 'ติดตามรถ' } },
    { bounds: { x: CW * 2,  y: 0,  width: CW, height: RH }, action: { type: 'uri', uri: liffUrl(LIFF.history),        label: 'ประวัติ'  } },
    // แถวล่าง: คนขับ
    { bounds: { x: 0,       y: RH, width: CW, height: RH }, action: { type: 'uri', uri: liffUrl(LIFF.driverRegister), label: 'สมัครขับ' } },
    { bounds: { x: CW,      y: RH, width: CW, height: RH }, action: { type: 'uri', uri: liffUrl(LIFF.driverEarnings), label: 'รายได้'   } },
    { bounds: { x: CW * 2,  y: RH, width: CW, height: RH }, action: { type: 'uri', uri: liffUrl(LIFF.driverDashboard),label: 'Dashboard'} },
  ],
};

// ── Generate SVG Image ────────────────────────────────────────
function generateMenuSVG() {
  const cells = [
    // แถวบน — สีเขียวเข้ม
    { emoji: '🚗', th: 'จองรถ',    en: 'Book a Ride',     col: 0, row: 0, bg: '#1a9e5f' },
    { emoji: '📍', th: 'ติดตามรถ', en: 'Track Driver',    col: 1, row: 0, bg: '#1a7aad' },
    { emoji: '📋', th: 'ประวัติ',  en: 'My Bookings',     col: 2, row: 0, bg: '#7a3fb5' },
    // แถวล่าง — สีส้ม/อบอุ่น
    { emoji: '🚕', th: 'สมัครขับ', en: 'Become a Driver', col: 0, row: 1, bg: '#c8651a' },
    { emoji: '💰', th: 'รายได้',   en: 'My Earnings',     col: 1, row: 1, bg: '#0d8c77' },
    { emoji: '📄', th: 'เอกสาร',   en: 'Documents',       col: 2, row: 1, bg: '#b03030' },
  ];

  const GAP = 4;
  const cellW = W / 3;
  const cellH = H / 2;

  const rects = cells.map(c => {
    const x  = c.col * cellW + GAP;
    const y  = c.row * cellH + GAP;
    const cw = cellW - GAP * 2;
    const ch = cellH - GAP * 2;
    const cx = x + cw / 2;
    const cy = y + ch / 2;
    return `
    <rect x="${x}" y="${y}" width="${cw}" height="${ch}" rx="30" fill="${c.bg}"/>
    <text x="${cx}" y="${cy - 90}" font-size="220" text-anchor="middle" dominant-baseline="middle">${c.emoji}</text>
    <text x="${cx}" y="${cy + 110}" font-size="115" font-weight="bold" fill="white" text-anchor="middle"
          font-family="'Helvetica Neue',Arial,sans-serif">${c.th}</text>
    <text x="${cx}" y="${cy + 240}" font-size="68" fill="rgba(255,255,255,0.65)" text-anchor="middle"
          font-family="'Helvetica Neue',Arial,sans-serif">${c.en}</text>`;
  }).join('');

  // เส้นแบ่ง
  const lines = `
    <line x1="0" y1="${cellH}" x2="${W}" y2="${cellH}" stroke="rgba(0,0,0,0.25)" stroke-width="8"/>
    <line x1="${cellW}"   y1="0" x2="${cellW}"   y2="${H}" stroke="rgba(0,0,0,0.25)" stroke-width="8"/>
    <line x1="${cellW*2}" y1="0" x2="${cellW*2}" y2="${H}" stroke="rgba(0,0,0,0.25)" stroke-width="8"/>`;

  // label แถว
  const labels = `
    <text x="20" y="${cellH - 20}" font-size="55" fill="rgba(255,255,255,0.4)"
          font-family="Arial,sans-serif">สำหรับลูกค้า ▶</text>
    <text x="20" y="${H - 20}" font-size="55" fill="rgba(255,255,255,0.4)"
          font-family="Arial,sans-serif">สำหรับคนขับ ▶</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#111827"/>
  ${rects}
  ${lines}
  ${labels}
</svg>`;
}

// ── Main ──────────────────────────────────────────────────────
async function main() {
  if (!CHANNEL_ACCESS_TOKEN) {
    console.error('❌ ไม่พบ LINE_CHANNEL_ACCESS_TOKEN ใน .env');
    process.exit(1);
  }
  console.log('🚀 เริ่มสร้าง Rich Menu...\n');

  // 1. ลบ menu เดิม
  try {
    const { data } = await LINE_API.get('/richmenu/list');
    for (const m of data.richmenus || []) {
      await LINE_API.delete(`/richmenu/${m.richMenuId}`);
      console.log(`🗑  ลบ menu เดิม: ${m.richMenuId}`);
    }
  } catch { /* ไม่มีเดิม */ }

  // 2. สร้าง menu ใหม่
  const { data: created } = await LINE_API.post('/richmenu', richMenuBody);
  const menuId = created.richMenuId;
  console.log(`✅ สร้าง Rich Menu ID: ${menuId}`);

  // 3. สร้างและ upload รูป
  const svgContent = generateMenuSVG();
  const svgPath = path.join(__dirname, 'richmenu.svg');
  fs.writeFileSync(svgPath, svgContent);
  console.log(`🖼  บันทึก SVG: ${svgPath}`);

  let uploaded = false;
  try {
    const sharp = require('sharp');
    const pngBuffer = await sharp(Buffer.from(svgContent)).png().toBuffer();
    const pngPath = path.join(__dirname, 'richmenu.png');
    fs.writeFileSync(pngPath, pngBuffer);

    const uploadAPI = axios.create({
      baseURL: 'https://api-data.line.me/v2/bot',
      headers: { Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`, 'Content-Type': 'image/png' },
    });
    await uploadAPI.post(`/richmenu/${menuId}/content`, pngBuffer);
    console.log('✅ อัปโหลดรูปสำเร็จ');
    uploaded = true;
  } catch (e) {
    console.log('⚠️  ไม่สามารถ upload รูปอัตโนมัติได้ — ทำเองใน LINE OA Manager:');
    console.log(`   1. ไปที่ https://manager.line.biz`);
    console.log(`   2. Rich Menu → ใช้ไฟล์ ${svgPath} (convert เป็น PNG ก่อน)`);
  }

  // 4. ตั้งเป็น default
  await LINE_API.post(`/user/all/richmenu/${menuId}`);
  console.log('✅ ตั้งเป็น Default Rich Menu สำเร็จ\n');

  console.log('🎉 Rich Menu พร้อมใช้งาน!');
  console.log('');
  console.log('URL แต่ละปุ่ม:');
  console.log(`  🚗 จองรถ    → ${liffUrl(LIFF.booking)}`);
  console.log(`  📍 ติดตามรถ → ${liffUrl(LIFF.tracking)}`);
  console.log(`  📋 ประวัติ  → ${liffUrl(LIFF.history)}`);
  console.log(`  🚕 สมัครขับ → ${liffUrl(LIFF.driverRegister)}`);
  console.log(`  💰 รายได้   → ${liffUrl(LIFF.driverEarnings)}`);
  console.log(`  🚘 Dashboard → ${liffUrl(LIFF.driverDashboard)}`);

  if (!uploaded) {
    console.log(`\n📌 Rich Menu ID: ${menuId}`);
    console.log('   อัปโหลดรูปเองได้ที่ LINE OA Manager > Rich Menu');
  }
}

main().catch(err => {
  console.error('❌ Error:', err.response?.data || err.message);
  process.exit(1);
});
