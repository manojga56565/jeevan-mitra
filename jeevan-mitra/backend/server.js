require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET','POST','PUT','DELETE'] }
});

app.set('io', io);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(e => console.error('❌ MongoDB error:', e.message));

// Routes
app.use('/api/auth',     require('./routes/authRoutes'));
app.use('/api/donor',    require('./routes/donorRoutes'));
app.use('/api/hospital', require('./routes/hospitalRoutes'));
app.use('/api/admin',    require('./routes/adminRoutes'));

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Jeevan Mitra API',
    version: '2.0.0',
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    uptime: Math.floor(process.uptime()) + 's'
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  if (err.name === 'ValidationError') {
    return res.status(400).json({ success: false, message: err.message });
  }
  if (err.code === 11000) {
    return res.status(409).json({ success: false, message: 'Duplicate entry' });
  }
  if (err.name === 'CastError') {
    return res.status(400).json({ success: false, message: 'Invalid ID' });
  }
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
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
