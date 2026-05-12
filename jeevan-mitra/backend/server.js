require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const cron = require('node-cron'); // Added for Part 4 Background Tasks

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET','POST','PUT','DELETE'] }
});

app.set('io', io);

// Middleware
app.use(cors({ origin: '*', methods: ['GET','POST','PUT','DELETE','OPTIONS'], allowedHeaders: ['Content-Type','Authorization'] }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(e => console.error('❌ MongoDB error:', e.message));

// Routes (Bulletproofed Plurals)
app.use('/api/auth', require('./routes/authRoutes'));
app.use(['/api/donor', '/api/donors'], require('./routes/donorRoutes'));
app.use(['/api/hospital', '/api/hospitals'], require('./routes/hospitalRoutes'));
app.use('/api/admin', require('./routes/adminRoutes'));

// ═══ PART 4: SYSTEM BACKGROUND TASKS ═══
const Request = require('./models/Request');
const { Alert } = require('./models/Other');

// Runs every 15 minutes: Expires pending requests older than 2 hours
cron.schedule('*/15 * * * *', async () => {
  try {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const expiredRequests = await Request.find({ status: 'pending', createdAt: { $lt: twoHoursAgo } });

    for (const req of expiredRequests) {
      req.status = 'expired';
      await req.save();
      // Auto-expire all alerts sent to donors for this request
      await Alert.updateMany({ requestId: req._id }, { $set: { status: 'expired' } });
      
      // Optional: Notify Hospital via Socket
      io.to(`hospital_${req.hospitalId}`).emit('request_expired', { requestId: req._id });
    }
    if(expiredRequests.length > 0) console.log(`[System] Auto-expired ${expiredRequests.length} old blood requests.`);
  } catch (err) {
    console.error('[System Error]', err.message);
  }
});

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', uptime: Math.floor(process.uptime()) + 's' }));

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, message: err.message || 'Server error' });
});

// Socket.IO
io.on('connection', socket => {
  console.log('🔌 Connected:', socket.id);
  socket.on('join_city', city => { if (city) socket.join(city); });
  socket.on('join_donor', id => { if (id) socket.join(`donor_${id}`); });
  socket.on('join_hospital', id => { if (id) socket.join(`hospital_${id}`); });
  socket.on('disconnect', () => console.log('🔌 Disconnected:', socket.id));
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));