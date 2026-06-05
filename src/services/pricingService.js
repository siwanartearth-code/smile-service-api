const { query } = require('../config/database');

/**
 * คำนวณราคาเที่ยวเดินทาง
 * @param {string} carType - sedan | van | wheelchair_van | ev_sedan | ev_van
 * @param {number} distanceKm
 * @param {number} durationMin
 * @returns {{ baseFare, distanceFare, timeFare, total, driverEarnings, platformFee, pricingId }}
 */
async function calculatePrice(carType, distanceKm, durationMin) {
  const res = await query(
    `SELECT * FROM pricing_config WHERE car_type = $1 AND is_active = true ORDER BY effective_from DESC LIMIT 1`,
    [carType]
  );
  if (res.rows.length === 0) throw new Error(`No pricing config for car type: ${carType}`);
  const p = res.rows[0];

  const baseFare      = parseFloat(p.base_fare);
  const distanceFare  = distanceKm * parseFloat(p.per_km_rate) * parseFloat(p.fuel_adjust_rate);
  const timeFare      = durationMin * parseFloat(p.per_min_rate);
  const total         = Math.ceil(baseFare + distanceFare + timeFare);
  const platformFee   = Math.round(total * (parseFloat(p.platform_fee_pct) / 100));
  const cameraDeduct  = 75;  // หัก 75 บาท/เที่ยว เข้ากองทุนกล้อง (ถ้าไม่มีกล้อง)
  const driverEarnings = total - platformFee;

  return {
    baseFare:       Math.round(baseFare),
    distanceFare:   Math.round(distanceFare),
    timeFare:       Math.round(timeFare),
    total,
    driverEarnings,
    cameraDeductBase: cameraDeduct,
    platformFee,
    platformFeePct: parseFloat(p.platform_fee_pct),
    pricingId:      p.id,
  };
}

/**
 * คำนวณรายได้จริงของคนขับ (หักกองทุนกล้องถ้าไม่มีกล้อง)
 */
function calcDriverNet(total, platformFee, hasCamera, tipAmount = 0) {
  const gross    = total - platformFee + tipAmount;
  const camFund  = hasCamera ? 0 : Math.min(75, gross * 0.05);  // หักสูงสุด 75 หรือ 5%
  const net      = gross - camFund;
  return { gross, cameraFund: camFund, net, tip: tipAmount };
}

/**
 * ปรับอัตราราคาตามราคาน้ำมัน/ไฟฟ้า
 * @param {string} carType
 * @param {number} newFuelAdjustRate  เช่น 1.05 = แพงขึ้น 5%
 */
async function updateFuelAdjustRate(carType, newFuelAdjustRate, note = '') {
  await query(
    `UPDATE pricing_config SET fuel_adjust_rate = $1, note = $2 WHERE car_type = $3 AND is_active = true`,
    [newFuelAdjustRate, note, carType]
  );
}

/**
 * ดึงราคาแพ็กเกจ Fix Cost ทั้งหมด
 */
async function getPackages() {
  const res = await query(`SELECT * FROM packages WHERE is_active = true ORDER BY price_per_month`);
  return res.rows;
}

module.exports = { calculatePrice, calcDriverNet, updateFuelAdjustRate, getPackages };
