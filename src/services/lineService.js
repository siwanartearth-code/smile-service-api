const line = require('@line/bot-sdk');

const client = new line.messagingApi.MessagingApiClient({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
});

// ── Rich Menu ─────────────────────────────────────────────────────────────────

async function createCustomerRichMenu() {
  const richMenu = {
    size: { width: 2500, height: 843 },
    selected: true,
    name: 'Customer Menu',
    chatBarText: 'เมนู',
    areas: [
      {
        bounds: { x: 0, y: 0, width: 833, height: 843 },
        action: { type: 'uri', uri: `https://liff.line.me/${process.env.LIFF_ID_BOOKING}`, label: 'จองรถ' },
      },
      {
        bounds: { x: 833, y: 0, width: 834, height: 843 },
        action: { type: 'message', text: 'ดูประวัติการจอง', label: 'ประวัติ' },
      },
      {
        bounds: { x: 1667, y: 0, width: 833, height: 843 },
        action: { type: 'message', text: 'บัญชีของฉัน', label: 'บัญชี' },
      },
    ],
  };
  const res = await client.createRichMenu(richMenu);
  return res.richMenuId;
}

async function createDriverRichMenu() {
  const richMenu = {
    size: { width: 2500, height: 843 },
    selected: true,
    name: 'Driver Menu',
    chatBarText: 'เมนูคนขับ',
    areas: [
      {
        bounds: { x: 0, y: 0, width: 833, height: 843 },
        action: { type: 'uri', uri: `https://liff.line.me/${process.env.LIFF_ID_DRIVER_DASHBOARD}`, label: 'งานของฉัน' },
      },
      {
        bounds: { x: 833, y: 0, width: 834, height: 843 },
        action: { type: 'uri', uri: `https://liff.line.me/${process.env.LIFF_ID_DRIVER_AVAILABILITY}`, label: 'ตารางเวลา' },
      },
      {
        bounds: { x: 1667, y: 0, width: 833, height: 843 },
        action: { type: 'message', text: 'รายได้ของฉัน', label: 'รายได้' },
      },
    ],
  };
  const res = await client.createRichMenu(richMenu);
  return res.richMenuId;
}

// ── Flex Messages ─────────────────────────────────────────────────────────────

/**
 * ส่ง Booking Confirmation ให้ลูกค้า
 */
async function sendBookingConfirmation(lineUserId, booking) {
  const msg = {
    type: 'flex',
    altText: `✅ ยืนยันการจอง #${booking.booking_number}`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#1D9E75',
        paddingAll: '16px',
        contents: [
          { type: 'text', text: '✅ ยืนยันการจองแล้ว', color: '#ffffff', size: 'lg', weight: 'bold' },
          { type: 'text', text: `#${booking.booking_number}`, color: '#d1fae5', size: 'sm', margin: 'xs' },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          infoRow('👤 ผู้โดยสาร', booking.passenger_name),
          infoRow('📍 รับที่', booking.pickup_address),
          infoRow('🏥 ส่งที่', booking.dropoff_address),
          infoRow('🕐 เวลา', formatThaiDate(booking.scheduled_at)),
          infoRow('🚗 ประเภทรถ', translateCarType(booking.car_type)),
          { type: 'separator', margin: 'md' },
          infoRow('💰 ราคาประมาณ', booking.estimated_price ? `฿${booking.estimated_price}` : '—'),
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: '#1D9E75',
            action: {
              type: 'uri',
              label: '📍 ติดตามรถ',
              uri: `https://liff.line.me/${process.env.LIFF_ID_TRACKING}?booking=${booking.id}`,
            },
          },
          {
            type: 'button',
            style: 'secondary',
            action: { type: 'message', label: '❌ ยกเลิก', text: `ยกเลิกการจอง ${booking.booking_number}` },
          },
        ],
      },
    },
  };
  return client.pushMessage({ to: lineUserId, messages: [msg] });
}

/**
 * แจ้งคนขับที่ "สะดวกรับ" (online + ตรงตาราง)
 * header สีส้ม — งานปกติ
 */
async function sendNewJobToDriver(driverLineUserId, booking) {
  const carEmoji   = carTypeEmoji(booking.car_type);
  const carLabel   = translateCarType(booking.car_type);
  const isSpecial  = booking.car_type === 'wheelchair_van';
  const headerBg   = isSpecial ? '#7C3AED' : '#F97316';   // ม่วงถ้าวีลแชร์, ส้มปกติ
  const specialTag = isSpecial
    ? [{ type: 'box', layout: 'horizontal', backgroundColor: '#EDE9FE', cornerRadius: '4px', paddingAll: '4px', margin: 'xs',
         contents: [{ type: 'text', text: '♿ ต้องการรถวีลแชร์', color: '#7C3AED', size: 'xs', weight: 'bold' }] }]
    : [];

  const noteContent = booking.passenger_note
    ? [infoRow('📝 ความต้องการ', booking.passenger_note)]
    : [];

  const driverEarnings = booking.driver_earnings
    ? Math.round(booking.driver_earnings)
    : estimateDriverEarnings(booking.estimated_distance, booking.car_type);

  const msg = {
    type: 'flex',
    altText: `🔔 มีงานใหม่! ${booking.pickup_address} → ${booking.dropoff_address}`,
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: headerBg,
        paddingAll: '16px',
        contents: [
          {
            type: 'box', layout: 'horizontal', contents: [
              { type: 'text', text: `${carEmoji} งานใหม่!`, color: '#ffffff', size: 'xl', weight: 'bold', flex: 1 },
              { type: 'text', text: carLabel, color: 'rgba(255,255,255,0.85)', size: 'sm', align: 'end', flex: 0 },
            ],
          },
          { type: 'text', text: `#${booking.booking_number}`, color: 'rgba(255,255,255,0.7)', size: 'xs', margin: 'xs' },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        paddingAll: '16px',
        contents: [
          // Earnings highlight box
          {
            type: 'box',
            layout: 'horizontal',
            backgroundColor: '#F0FDF4',
            borderColor: '#BBF7D0',
            borderWidth: '1px',
            cornerRadius: '8px',
            paddingAll: '12px',
            margin: 'none',
            contents: [
              {
                type: 'box', layout: 'vertical', flex: 1, contents: [
                  { type: 'text', text: '💰 รายได้โดยประมาณ', color: '#166534', size: 'xs' },
                  { type: 'text', text: `฿${driverEarnings.toLocaleString()}`, color: '#15803D', size: 'xxl', weight: 'bold' },
                ],
              },
              {
                type: 'box', layout: 'vertical', flex: 1, contents: [
                  { type: 'text', text: '📏 ระยะทาง', color: '#166534', size: 'xs', align: 'end' },
                  { type: 'text', text: `~${booking.estimated_distance} กม.`, color: '#15803D', size: 'lg', weight: 'bold', align: 'end' },
                ],
              },
            ],
          },
          { type: 'separator', margin: 'md' },
          ...specialTag,
          infoRow('📍 รับที่', booking.pickup_address),
          infoRow('🏥 ส่งที่', booking.dropoff_address),
          infoRow('🕐 เวลารับ', formatThaiDate(booking.scheduled_at)),
          ...noteContent,
          { type: 'separator', margin: 'md' },
          {
            type: 'text',
            text: '⏱️ กรุณาตอบรับภายใน 3 นาที',
            size: 'xs',
            color: '#EF4444',
            wrap: true,
          },
        ],
      },
      footer: {
        type: 'box',
        layout: 'horizontal',
        spacing: 'sm',
        paddingAll: '12px',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: '#1D9E75',
            flex: 2,
            height: 'sm',
            action: {
              type: 'postback',
              label: '✅ รับงาน',
              data: `action=accept_job&booking_id=${booking.id}`,
              displayText: `รับงาน #${booking.booking_number}`,
            },
          },
          {
            type: 'button',
            style: 'secondary',
            flex: 1,
            height: 'sm',
            action: {
              type: 'postback',
              label: '❌ ปฏิเสธ',
              data: `action=reject_job&booking_id=${booking.id}`,
              displayText: `ปฏิเสธงาน #${booking.booking_number}`,
            },
          },
        ],
      },
    },
  };
  return client.pushMessage({ to: driverLineUserId, messages: [msg] });
}

/**
 * แจ้งคนขับที่ "ปิดรับงาน" แต่เปิด notify_when_offline
 * header สีน้ำเงิน — งานพิเศษนอกเวลา
 */
async function sendJobToOfflineDriver(driverLineUserId, booking) {
  const driverEarnings = booking.driver_earnings
    ? Math.round(booking.driver_earnings)
    : estimateDriverEarnings(booking.estimated_distance, booking.car_type);

  const msg = {
    type: 'flex',
    altText: `💼 มีงานรอคุณ! ฿${driverEarnings} — แม้ปิดรับงานอยู่`,
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#1D4ED8',
        paddingAll: '16px',
        contents: [
          { type: 'text', text: '💼 มีงานรอคุณ!', color: '#ffffff', size: 'xl', weight: 'bold' },
          { type: 'text', text: 'คุณปิดรับงานอยู่ แต่งานนี้อยู่ใกล้บ้านคุณ', color: '#BFDBFE', size: 'xs', margin: 'xs', wrap: true },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        paddingAll: '16px',
        contents: [
          // Earnings highlight
          {
            type: 'box',
            layout: 'horizontal',
            backgroundColor: '#EFF6FF',
            borderColor: '#BFDBFE',
            borderWidth: '1px',
            cornerRadius: '8px',
            paddingAll: '12px',
            contents: [
              {
                type: 'box', layout: 'vertical', flex: 1, contents: [
                  { type: 'text', text: '💰 รายได้งานนี้', color: '#1E3A8A', size: 'xs' },
                  { type: 'text', text: `฿${driverEarnings.toLocaleString()}`, color: '#1D4ED8', size: 'xxl', weight: 'bold' },
                ],
              },
              {
                type: 'box', layout: 'vertical', flex: 1, contents: [
                  { type: 'text', text: '📏 ระยะทาง', color: '#1E3A8A', size: 'xs', align: 'end' },
                  { type: 'text', text: `~${booking.estimated_distance} กม.`, color: '#1D4ED8', size: 'lg', weight: 'bold', align: 'end' },
                ],
              },
            ],
          },
          { type: 'separator', margin: 'md' },
          infoRow('📍 รับที่', booking.pickup_address),
          infoRow('🏥 ส่งที่', booking.dropoff_address),
          infoRow('🕐 เวลารับ', formatThaiDate(booking.scheduled_at)),
          booking.passenger_note ? infoRow('📝 ความต้องการ', booking.passenger_note) : null,
          { type: 'separator', margin: 'md' },
          {
            type: 'text',
            text: '💡 กดรับงานนี้ — ระบบจะเปิดรับสำหรับงานนี้เท่านั้น',
            size: 'xs',
            color: '#6B7280',
            wrap: true,
          },
        ].filter(Boolean),
      },
      footer: {
        type: 'box',
        layout: 'horizontal',
        spacing: 'sm',
        paddingAll: '12px',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: '#1D4ED8',
            flex: 2,
            height: 'sm',
            action: {
              type: 'postback',
              label: '🔓 รับงานนี้',
              data: `action=accept_job&booking_id=${booking.id}&from_offline=true`,
              displayText: `รับงาน #${booking.booking_number}`,
            },
          },
          {
            type: 'button',
            style: 'secondary',
            flex: 1,
            height: 'sm',
            action: {
              type: 'postback',
              label: 'ไม่รับ',
              data: `action=reject_job&booking_id=${booking.id}`,
              displayText: `ปฏิเสธงาน #${booking.booking_number}`,
            },
          },
        ],
      },
    },
  };
  return client.pushMessage({ to: driverLineUserId, messages: [msg] });
}

/**
 * ส่ง Checkpoint notification ให้ญาติ
 */
async function sendCheckpointAlert(familyLineUserId, passenger, checkpoint, booking) {
  const messages = {
    driver_arrived: `🚗 คนขับมาถึงแล้ว กำลังรอรับ ${passenger} ที่ ${booking.pickup_address}`,
    picked_up:      `✅ ${passenger} ขึ้นรถแล้ว กำลังเดินทางไป ${booking.dropoff_address}`,
    halfway:        `📍 ${passenger} กำลังเดินทาง ผ่านครึ่งทางแล้ว`,
    near_dropoff:   `🏥 ใกล้ถึงที่หมายแล้ว ${booking.dropoff_address}`,
    completed:      `🎉 ${passenger} ถึงที่หมายปลอดภัยแล้ว! ${booking.dropoff_address}`,
  };
  const text = messages[checkpoint] || `📍 อัปเดต: ${checkpoint}`;
  return client.pushMessage({ to: familyLineUserId, messages: [{ type: 'text', text: `[SMILE SERVICE]\n${text}` }] });
}

/**
 * ส่ง Receipt + Review request
 */
async function sendReceiptAndReview(lineUserId, booking) {
  const msg = {
    type: 'flex',
    altText: `🧾 ใบเสร็จ #${booking.booking_number}`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: '#0F6E56', paddingAll: '16px',
        contents: [{ type: 'text', text: '🎉 เดินทางถึงที่หมายแล้ว!', color: '#ffffff', size: 'lg', weight: 'bold' }],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: [
          infoRow('🔖 หมายเลข', booking.booking_number),
          infoRow('🚗 คนขับ', booking.driver_name),
          infoRow('📏 ระยะทาง', `${booking.final_distance} กม.`),
          infoRow('⏱️ เวลา', `${booking.trip_minutes} นาที`),
          { type: 'separator', margin: 'md' },
          infoRow('💰 ค่าบริการ', `฿${booking.final_price}`),
        ],
      },
      footer: {
        type: 'box', layout: 'vertical',
        contents: [{
          type: 'button', style: 'primary', color: '#1D9E75',
          action: {
            type: 'uri',
            label: '⭐ รีวิวคนขับ',
            uri: `https://liff.line.me/${process.env.LIFF_ID_BOOKING}?page=review&booking=${booking.id}`,
          },
        }],
      },
    },
  };
  return client.pushMessage({ to: lineUserId, messages: [msg] });
}

/**
 * ส่ง Earnings summary ให้คนขับ
 */
async function sendEarningsSummary(driverLineUserId, earnings) {
  const cameraNote = earnings.camera_fund_total < 4000
    ? `📷 กองทุนกล้อง: ${earnings.camera_fund_total} / 4,000 บาท (${Math.round(earnings.camera_fund_total/40)}%)`
    : `📷 ครบแล้ว! กล้องกำลังส่งให้คุณ 🎉`;
  const text = `💰 สรุปรายได้วันนี้\n\n` +
    `รายได้รวม: ฿${Math.round(earnings.gross || 0)}\n` +
    `ค่า commission: ฿${Math.round(earnings.fee || 0)}\n` +
    `Tip จากลูกค้า: ฿${Math.round(earnings.tips || 0)}\n` +
    `─────────────\n` +
    `รับจริง: ฿${Math.round(earnings.net || 0)}\n\n` +
    cameraNote;
  return client.pushMessage({ to: driverLineUserId, messages: [{ type: 'text', text }] });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function infoRow(label, value) {
  return {
    type: 'box',
    layout: 'horizontal',
    spacing: 'sm',
    contents: [
      { type: 'text', text: label, size: 'sm', color: '#8E8E93', flex: 3 },
      { type: 'text', text: value || '—', size: 'sm', flex: 5, wrap: true, color: '#1F2937' },
    ],
  };
}

function formatThaiDate(isoDate) {
  if (!isoDate) return '—';
  return new Date(isoDate).toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function translateCarType(type) {
  const map = { sedan: 'รถเก๋ง', van: 'รถตู้', wheelchair_van: 'รถวีลแชร์', ev_sedan: 'รถไฟฟ้าเก๋ง', ev_van: 'รถไฟฟ้าตู้' };
  return map[type] || type;
}

function carTypeEmoji(type) {
  const map = { sedan: '🚗', van: '🚐', wheelchair_van: '♿', ev_sedan: '⚡', ev_van: '⚡' };
  return map[type] || '🚗';
}

/** ประมาณรายได้คนขับ (หัก commission 15%) */
function estimateDriverEarnings(distanceKm = 10, carType = 'sedan') {
  const base = { sedan: 60, van: 80, wheelchair_van: 100, ev_sedan: 70, ev_van: 90 };
  const perKm = { sedan: 12, van: 15, wheelchair_van: 18, ev_sedan: 13, ev_van: 16 };
  const gross = (base[carType] || 60) + (perKm[carType] || 12) * distanceKm;
  return Math.round(gross * 0.85); // หัก commission 15%
}

module.exports = {
  client,
  createCustomerRichMenu,
  createDriverRichMenu,
  sendBookingConfirmation,
  sendNewJobToDriver,
  sendJobToOfflineDriver,
  sendCheckpointAlert,
  sendReceiptAndReview,
  sendEarningsSummary,
};
