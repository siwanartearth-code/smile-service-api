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

const app = express();

// ── Security ──────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: [
    process.env.FRONTEND_URL,
    'https://liff.line.me',
    'http://localhost:5173',
  ],
  credentials: true,
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

// ── Health check ─────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'Smile Service API', time: new Date().toISOString() });
});

// ── 404 ───────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ── Error handler ─────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚗 Smile Service API running on port ${PORT}`);
});

module.exports = app;
