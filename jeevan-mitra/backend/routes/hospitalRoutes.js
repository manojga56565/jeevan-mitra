const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Hospital = require('../models/Hospital');
const Donor = require('../models/Donor');
const Request = require('../models/Request');
const { Alert } = require('../models/Other');
const { auth } = require('../middleware/auth');

// ═══ HOSPITAL LOGIN ═══
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const hospital = await Hospital.findOne({ email: email.toLowerCase() });
    if (!hospital) return res.status(404).json({ success: false, message: 'Hospital not found' });
    if (!hospital.isVerified) return res.status(403).json({ success: false, message: 'Account pending admin verification' });

    const isMatch = await bcrypt.compare(password, hospital.password);
    if (!isMatch) return res.status(401).json({ success: false, message: 'Invalid credentials' });

    const token = jwt.sign({ id: hospital._id, role: 'hospital' }, process.env.JWT_SECRET || 'secret', { expiresIn: '24h' });
    res.json({ success: true, token, hospital });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══ THE BLOOD REQUEST ROUTE (BULLETPROOF) ═══
// This captures: /requests, /request, /create, and /
router.post(['/', '/requests', '/request', '/create'], auth('hospital'), async (req, res) => {
  try {
    const { bloodGroup, units, urgencyLevel, patientName, doctorRefNo, notes } = req.body;

    const newRequest = new Request({
      hospitalId: req.user.id,
      bloodGroup: bloodGroup || req.body.bloodGroupRequired,
      units: units || 1,
      urgency: urgencyLevel || 'normal',
      patientName,
      doctorRefNo,
      notes,
      status: 'pending'
    });

    await newRequest.save();

    // Matching Logic
    const matchingDonors = await Donor.find({
      bloodGroup: newRequest.bloodGroup,
      availabilityStatus: 'available',
      isActive: true
    });

    if (matchingDonors.length > 0) {
      const alerts = matchingDonors.map(d => ({
        donorId: d._id,
        requestId: newRequest._id,
        status: 'pending'
      }));
      await Alert.insertMany(alerts);
    }

    res.status(201).json({ 
      success: true, 
      message: 'Request posted and donors alerted!', 
      request: newRequest 
    });
  } catch (err) {
    console.error("POST Request Error:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══ GET HOSPITAL REQUESTS ═══
router.get(['/', '/requests', '/request'], auth('hospital'), async (req, res) => {
  try {
    const requests = await Request.find({ hospitalId: req.user.id }).sort({ createdAt: -1 });
    res.json({ success: true, requests });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;