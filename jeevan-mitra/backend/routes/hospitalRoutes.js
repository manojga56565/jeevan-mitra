const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Hospital = require('../models/Hospital');
const Donor = require('../models/Donor');
const Request = require('../models/Request');
const { Alert } = require('../models/Other');
const { auth } = require('../middleware/auth');

// ═══ HOSPITAL LOGIN ══════════════════════════════════════════
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ success: false, message: 'Email and password required' });

    const hospital = await Hospital.findOne({ email: email.toLowerCase() });
    if (!hospital) return res.status(404).json({ success: false, message: 'Hospital not found' });
    
    // Check Admin Verification Status
    if (hospital.isVerified === false) {
      return res.status(403).json({ success: false, message: 'Account pending admin verification' });
    }

    const isMatch = await bcrypt.compare(password, hospital.password);
    if (!isMatch) return res.status(401).json({ success: false, message: 'Invalid credentials' });

    const token = jwt.sign(
      { id: hospital._id, role: 'hospital' },
      process.env.JWT_SECRET || 'jeevanmitra_secret_key',
      { expiresIn: '24h' }
    );

    res.json({ 
      success: true, 
      token, 
      hospital: { _id: hospital._id, hospitalName: hospital.hospitalName, city: hospital.city } 
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══ CREATE BLOOD REQUEST (Synced with your Schema) ══════════
router.post(['/', '/requests', '/request', '/create'], auth('hospital'), async (req, res) => {
  try {
    // 1. Fetch Hospital details for the required model fields
    const hospital = await Hospital.findById(req.user.id);
    if (!hospital) return res.status(404).json({ success: false, message: 'Hospital data missing' });

    // 2. Create Request using all required fields from your RequestSchema
    const newRequest = new Request({
      hospitalId: hospital._id,
      hospitalName: hospital.hospitalName,
      hospitalCity: hospital.city,
      hospitalPhone: hospital.phone,
      bloodGroup: req.body.bloodGroup || req.body.bloodGroupRequired,
      urgency: req.body.urgencyLevel || req.body.urgency || 'normal',
      quantity: req.body.units || req.body.unitsRequired || 1, // Maps to your 'quantity' field
      patientName: req.body.patientName || '',
      patientReason: req.body.notes || '', // Maps to your 'patientReason' field
      doctorRefNo: req.body.doctorRefNo || '',
      status: 'pending'
    });

    await newRequest.save();

    // 3. THE MATCHING ENGINE: Find eligible donors
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const matchingDonors = await Donor.find({
      bloodGroup: newRequest.bloodGroup,
      city: hospital.city, // Local matching
      isActive: true,
      availabilityStatus: 'available',
      $or: [
        { lastDonationDate: { $exists: false } },
        { lastDonationDate: { $lte: ninetyDaysAgo } }
      ]
    });

    // 4. Create Alerts for each matching donor
    if (matchingDonors.length > 0) {
      const alerts = matchingDonors.map(donor => ({
        donorId: donor._id,
        requestId: newRequest._id,
        status: 'pending'
      }));
      await Alert.insertMany(alerts);
    }

    // 5. Trigger Real-time Socket.IO
    const io = req.app.get('io');
    if (io) {
      matchingDonors.forEach(donor => {
        io.to(`donor_${donor._id}`).emit('new_alert', { request: newRequest });
      });
    }

    res.status(201).json({ 
      success: true, 
      message: 'Blood request posted and donors alerted!', 
      request: newRequest 
    });
  } catch (err) {
    console.error("POST Error:", err.message);
    res.status(500).json({ success: false, message: "Server error: " + err.message });
  }
});

// ═══ GET ALL REQUESTS FOR THIS HOSPITAL ══════════════════════
router.get(['/', '/requests', '/request'], auth('hospital'), async (req, res) => {
  try {
    const requests = await Request.find({ hospitalId: req.user.id }).sort({ createdAt: -1 });
    res.json({ success: true, requests });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══ MARK REQUEST AS COMPLETED (Triggers Cooldown) ═══════════
router.put('/requests/:id/complete', auth('hospital'), async (req, res) => {
  try {
    const request = await Request.findOne({ _id: req.params.id, hospitalId: req.user.id });
    if (!request) return res.status(404).json({ success: false, message: 'Request not found' });

    request.status = 'completed';
    request.completedAt = new Date();
    await request.save();

    // Update Donor Stats if someone accepted
    if (request.acceptedBy) {
      const donor = await Donor.findById(request.acceptedBy);
      if (donor) {
        donor.totalDonations = (donor.totalDonations || 0) + 1;
        donor.points = (donor.points || 0) + (request.pointsEarned || 10);
        donor.lastDonationDate = new Date(); // Start 90-day cooldown
        await donor.save();
      }
    }

    res.json({ success: true, message: 'Request marked as completed', request });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;