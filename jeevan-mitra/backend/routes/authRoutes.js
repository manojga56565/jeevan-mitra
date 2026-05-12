const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const Donor = require('../models/Donor');

// Temporary in-memory store for OTPs
const otpStore = {};

// POST /api/auth/donor/send-otp
router.post('/donor/send-otp', async (req, res) => {
  try {
    const { phone, fullName, city, bloodGroup, dob, age } = req.body;
    if (!phone) return res.status(400).json({ success: false, message: 'Phone is required' });

    // Generate a 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Store it temporarily (expires in 5 mins)
    otpStore[phone] = { otp, fullName, city, bloodGroup, dob, age, expires: Date.now() + 300000 };

    // Send the OTP in the JSON response so the frontend "hint" UI can display it for easy testing
    res.json({ success: true, message: 'OTP sent', otp });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/auth/donor/verify-otp
router.post('/donor/verify-otp', async (req, res) => {
  try {
    const { phone, otp } = req.body;
    
    const record = otpStore[phone];
    if (!record) return res.status(400).json({ success: false, message: 'OTP expired or not requested' });
    if (record.otp !== otp) return res.status(400).json({ success: false, message: 'Invalid OTP' });
    if (Date.now() > record.expires) return res.status(400).json({ success: false, message: 'OTP expired' });

    // Check if donor already exists
    let donor = await Donor.findOne({ phone });
    
    if (!donor) {
      // Auto-register new donor using the details they provided during the OTP step
      donor = new Donor({
        name: record.fullName || 'User',
        phone: phone,
        city: record.city || 'Telangana',
        bloodGroup: record.bloodGroup || 'O+',
        dob: record.dob,
        age: record.age || 18,
        weight: 50, // default weight
        password: 'otp_login_user' // bypass password requirement for OTP users
      });
      await donor.save();
    }

    // Generate login token
    const token = jwt.sign(
      { id: donor._id, phone: donor.phone, role: 'donor' },
      process.env.JWT_SECRET || 'default_secret_key',
      { expiresIn: '30d' }
    );

    delete otpStore[phone]; // clear OTP

    res.json({ 
      success: true, 
      token, 
      donor: {
        _id: donor._id,
        fullName: donor.name,
        phone: donor.phone,
        city: donor.city,
        bloodGroup: donor.bloodGroup,
        points: donor.points || 0,
        donationCount: donor.totalDonations || 0
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;