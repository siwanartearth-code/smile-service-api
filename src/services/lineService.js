const line = require('@line/bot-sdk');

const client = new line.messagingApi.MessagingApiClient({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
});

// ── Rich Menu ─────────────────────────────────────────────────────────────────

/**
 * สร้าง Rich Menu สำหรับลูกค้า
 */
async function createCustomerRichMenu() {
  const richMenu = {
    size: { width: 2500, height: 843 },
    selected: true,
    name: 'Customer Menu',
    chatBarText: 'เมนู',
    areas: [
      {
        bounds: { x: 0, y: 0, width: 833, height: 843 },
        action: {
          type: 'uri',
          uri: `https://liff.line.me/${process.env.LIFF_ID_BOOKING}`,
          label: 'จองรถ',
        },
      },
      {
        bounds: { x: 833, y: 0, width: 834, height: 843 },
        action: {
          type: 'message',
          text: 'ดูประวัติการจอง',
          label: 'ประวัติ',
        },
      },
      {
        bounds: { x: 1667, y: 0, width: 833, height: 843 },
        action: {
          type: 'message',
          text: 'บัญชีของฉัน',
          label: 'บัญชี',
        },
      },
    ],
  };
  const res = await client.createRichMenu(richMenu);
  return res.richMenuId;
}

/**
 * สร้าง Rich Menu สำหรับคนขับ
 */
async function createDriverRichMenu() {
  const richMenu = {
    size: { width: 2500, height: 843 },
    selected: true,
    name: 'Driver Menu',
    chatBarText: 'เมนูคนขับ',
    areas: [
      {
        bounds: { x: 0, y: 0, width: 833, height: 843 },
        action: {
          type: 'uri',
          uri: `https://liff.line.me/${process.env.LIFF_ID_DRIVER_DASHBOARD}`,
          label: 'งานของฉัน',
        },
      },
      {
        bounds: { x: 833, y: 0, width: 834, height: 843 },
        action: { type: 'message', text: 'เปิดรับงาน', label: 'เปิดรับงาน' },
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
        contents: [{
          type: 'text',
          text: '✅ ยืนยันการจองแล้ว',
          color: '#ffffff',
          size: 'lg',
          weight: 'bold',
        }],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          infoRow('🔖 หมายเลข', booking.booking_number),
          infoRow('👤 ผู้โดยสาร', booking.passenger_name),
          infoRow('📍 รับที่', booking.pickup_address),
          infoRow('🏥 ส่งที่', booking.dropoff_address),
          infoRow('🕐 เวลา', formatThaiDate(booking.scheduled_at)),
          infoRow('🚗 ประเภทรถ', translateCarType(booking.car_type)),
          { type: 'separator', margin: 'md' },
          infoRow('💰 ราคาประมาณ', `${booking.estimated_price || '—'} บาท`),
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
 * แจ้งคนขับว่ามีงานใหม่
 */
async function sendNewJobToDriver(driverLineUserId, booking) {
  const msg = {
    type: 'flex',
    altText: `🔔 มีงานใหม่ใกล้คุณ!`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#F97316',
        contents: [{
          type: 'text',
          text: '🔔 มีงานใหม่!',
          color: '#ffffff',
          size: 'lg',
          weight: 'bold',
        }],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          infoRow('📍 รับที่', booking.pickup_address),
          infoRow('🏥 ส่งที่', booking.dropoff_address),
          infoRow('🕐 เวลา', formatThaiDate(booking.scheduled_at)),
          infoRow('📏 ระยะ', `~${booking.estimated_distance} กม.`),
          infoRow('💰 รายได้', `~${booking.driver_earnings} บาท`),
          booking.passenger_note
            ? infoRow('📝 หมายเหตุ', booking.passenger_note)
            : null,
        ].filter(Boolean),
      },
      footer: {
        type: 'box',
        layout: 'horizontal',
        spacing: 'sm',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: '#1D9E75',
            flex: 2,
            action: { type: 'message', label: '✅ รับงาน', text: `รับงาน ${booking.id}` },
          },
          {
            type: 'button',
            style: 'secondary',
            flex: 1,
            action: { type: 'message', label: '❌ ปฏิเสธ', text: `ปฏิเสธงาน ${booking.id}` },
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
  return client.pushMessage({
    to: familyLineUserId,
    messages: [{ type: 'text', text: `[SMILE SERVICE]\n${text}` }],
  });
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
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#0F6E56',
        contents: [{
          type: 'text',
          text: '🎉 เดินทางถึงที่หมายแล้ว!',
          color: '#ffffff',
          size: 'lg',
          weight: 'bold',
        }],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          infoRow('🔖 หมายเลข', booking.booking_number),
          infoRow('🚗 คนขับ', booking.driver_name),
          infoRow('📏 ระยะทาง', `${booking.final_distance} กม.`),
          infoRow('⏱️ เวลา', `${booking.trip_minutes} นาที`),
          { type: 'separator', margin: 'md' },
          infoRow('💰 ค่าบริการ', `${booking.final_price} บาท`),
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [{
          type: 'button',
          style: 'primary',
          color: '#1D9E75',
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
    `รายได้รวม: ${earnings.gross} บาท\n` +
    `ค่า commission: ${earnings.fee} บาท\n` +
    `Tip จากลูกค้า: ${earnings.tips} บาท\n` +
    `─────────────\n` +
    `รับจริง: ${earnings.net} บาท\n\n` +
    cameraNote;
  return client.pushMessage({ to: driverLineUserId, messages: [{ type: 'text', text }] });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function infoRow(label, value) {
  return {
    type: 'box',
    layout: 'horizontal',
    contents: [
      { type: 'text', text: label, size: 'sm', color: '#8E8E93', flex: 2 },
      { type: 'text', text: value || '—', size: 'sm', flex: 3, wrap: true },
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
  const map = {
    sedan: 'รถเก๋ง', van: 'รถตู้',
    wheelchair_van: 'รถวีลแชร์', ev_sedan: 'รถไฟฟ้าเก๋ง', ev_van: 'รถไฟฟ้าตู้',
  };
  return map[type] || type;
}

module.exports = {
  client,
  createCustomerRichMenu,
  createDriverRichMenu,
  sendBookingConfirmation,
  sendNewJobToDriver,
  sendCheckpointAlert,
  sendReceiptAndReview,
  sendEarningsSummary,
};
