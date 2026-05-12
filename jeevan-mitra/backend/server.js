require('dotenv').config();
const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB Connected'))
  .catch(err => console.error('❌ MongoDB Error:', err));

// Routes - Fixed to accept both singular and plural paths
app.use('/api/auth', require('./routes/authRoutes'));
app.use(['/api/donor', '/api/donors'], require('./routes/donorRoutes'));
app.use(['/api/hospital', '/api/hospitals'], require('./routes/hospitalRoutes'));
app.use('/api/admin', require('./routes/adminRoutes'));

// 🛡️ JSON Fallback for 404s (Prevents the <!DOCTYPE error)
app.use((req, res) => {
  res.status(404).json({ 
    success: false, 
    message: `The URL ${req.originalUrl} was not found. Check your frontend API call!` 
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🚀 Server live on port ${PORT}`));