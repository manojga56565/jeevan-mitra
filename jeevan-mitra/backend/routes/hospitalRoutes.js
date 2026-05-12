const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Hospital = require('../models/Hospital');
const Donor = require('../models/Donor');
const { auth } = require('../middleware/auth');

// ═══ AUTHENTICATION ══════════════════════════════════════════

// POST /api/hospitals/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required' });
    }

    const hospital = await Hospital.findOne({ email: email.toLowerCase() });
    if (!hospital) {
      return res.status(404).json({ success: false, message: 'Hospital not found' });
    }

    // Check if the admin has verified this hospital yet
    if (hospital.isVerified === false) {
      return res.status(403).json({ success: false, message: 'Account pending admin verification' });
    }

    const isMatch = await bcrypt.compare(password, hospital.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: hospital._id, email: hospital.email, role: 'hospital' },
      process.env.JWT_SECRET || 'default_secret_key',
      { expiresIn: '24h' }
    );

    res.json({ 
      success: true, 
      token, 
      hospital: {
        _id: hospital._id,
        hospitalName: hospital.hospitalName,
        email: hospital.email,
        city: hospital.city,
        phone: hospital.phone,
        type: hospital.type
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══ PROFILE MANAGEMENT ══════════════════════════════════════

// GET /api/hospitals/profile
router.get('/profile', auth('hospital'), async (req, res) => {
  try {
    const hospital = await Hospital.findById(req.user.id).select('-password');
    if (!hospital) return res.status(404).json({ success: false, message: 'Hospital not found' });
    res.json({ success: true, hospital });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/hospitals/profile
router.put('/profile', auth('hospital'), async (req, res) => {
  try {
    const { hospitalName, phone, city, email, type } = req.body;
    const updates = {};
    if (hospitalName) updates.hospitalName = hospitalName;
    if (phone) updates.phone = phone;
    if (city) updates.city = city;
    if (email) updates.email = email.toLowerCase();
    if (type) updates.type = type;

    const hospital = await Hospital.findByIdAndUpdate(req.user.id, { $set: updates }, { new: true }).select('-password');
    res.json({ success: true, message: 'Profile updated', hospital });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/hospitals/change-password
router.put('/change-password', auth('hospital'), async (req, res) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    }
    
    const hashed = await bcrypt.hash(password, 10);
    await Hospital.findByIdAndUpdate(req.user.id, { $set: { password: hashed } });
    
    res.json({ success: true, message: 'Password changed successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══ DONOR SCANNER / LOOKUP ══════════════════════════════════

// GET /api/hospitals/phone/:phone
router.get('/phone/:phone', auth('hospital'), async (req, res) => {
  try {
    const phoneParam = req.params.phone; // e.g., "+919876543210"
    const donor = await Donor.findOne({ phone: phoneParam }).select('-password -otpCode -otpExpiresAt');
    
    if (!donor) {
      return res.status(404).json({ success: false, message: 'Donor not found' });
    }
    
    res.json({ success: true, donor });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;