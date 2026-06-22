require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');

const webhookRouter   = require('./routes/webhook');
const bookingsRouter  = require('./routes/bookings');
const driversRouter   = require('./routes/drivers');
const pricingRouter   = require('./routes/pricing');
const authRouter      = require('./routes/auth');
const addressesRouter = require('./routes/addresses');
const paymentsRouter  = require('./routes/payments');
const adminRouter     = require('./routes/admin');

const app = express();

// ── Security ──────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ── LINE Webhook needs raw body for signature verify ──────────
app.use('/webhook', express.raw({ type: 'application/json' }));

// ── Regular JSON for everything else ─────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Routes ────────────────────────────────────────────────────
app.use('/webhook',   webhookRouter);
app.use('/auth',      authRouter);
app.use('/bookings',  bookingsRouter);
app.use('/drivers',   driversRouter);
app.use('/pricing',   pricingRouter);
app.use('/addresses', addressesRouter);
app.use('/payments',  paymentsRouter);
app.use('/admin',     adminRouter);

// ── Health check ─────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'Smile Service API', time: new Date().toISOString() });
});

// ── Debug: ทดสอบ token ──────────────────────────────────────
const { authenticate, requireAdmin } = require('./middleware/auth');
app.get('/debug-token', authenticate, (req, res) => {
  res.json({ ok: true, user: { id: req.user?.id, role: req.user?.role, is_active: req.user?.is_active } });
});
app.get('/debug-admin', authenticate, requireAdmin, (req, res) => {
  res.json({ ok: true, role: req.user?.role });
});

// ── Test page (same-origin ไม่มีปัญหา CORS) ──────────────────
const path = require('path');
app.get('/test', (req, res) => {
  res.setHeader('Content-Security-Policy', "default-src 'self' 'unsafe-inline'