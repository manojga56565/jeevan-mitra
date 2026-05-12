const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const Donor = require('../models/Donor');
const Request = require('../models/Request');
const { Alert } = require('../models/Other');
const { auth } = require('../middleware/auth');

// GET /api/donors/profile
router.get('/profile', auth('donor'), async (req, res) => {
  try {
    const donor = await Donor.findById(req.user.id).select('-password -otpCode -otpExpiresAt');
    if (!donor) return res.status(404).json({ success: false, message: 'Donor not found' });
    res.json({ success: true, donor });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/donors/profile
router.put('/profile', auth('donor'), async (req, res) => {
  try {
    const { fullName, email, city, availabilityStatus, dob } = req.body;
    const updates = {};
    if (fullName) updates.name = fullName; // Maps frontend fullName to backend name
    if (email) updates.email = email;
    if (city) updates.city = city;
    if (availabilityStatus) updates.availabilityStatus = availabilityStatus;
    if (dob) updates.dob = dob;

    const donor = await Donor.findByIdAndUpdate(req.user.id, { $set: updates }, { new: true })
      .select('-password -otpCode -otpExpiresAt');
    res.json({ success: true, message: 'Profile updated', donor });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/donors/change-password
router.put('/change-password', auth('donor'), async (req, res) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    }
    const hashed = await bcrypt.hash(password, 10);
    await Donor.findByIdAndUpdate(req.user.id, { $set: { password: hashed } });
    res.json({ success: true, message: 'Password changed successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/donors/alerts
router.get('/alerts', auth('donor'), async (req, res) => {
  try {
    const alerts = await Alert.find({
      donorId: req.user.id,
      status: { $nin: ['expired','declined'] }
    }).populate('requestId').sort({ sentAt: -1 });
    res.json({ success: true, alerts });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/donors/history
router.get('/history', auth('donor'), async (req, res) => {
  try {
    const history = await Request.find({
      acceptedBy: req.user.id,
      status: { $in: ['accepted','completed', 'fulfilled'] }
    }).populate('hospitalId', 'hospitalName city phone').sort({ createdAt: -1 });
    res.json({ success: true, history });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/donors/points
router.get('/points', auth('donor'), async (req, res) => {
  try {
    const donor = await Donor.findById(req.user.id).select('points name totalDonations');
    const leaderboard = await Donor.find({ isActive: true })
      .select('name city bloodGroup points totalDonations')
      .sort({ points: -1 }).limit(50);
    res.json({ success: true, points: donor.points, leaderboard });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/donors/leaderboard
router.get('/leaderboard', async (req, res) => {
  try {
    const { city } = req.query;
    const filter = { isActive: true };
    if (city) filter.city = { $regex: city, $options: 'i' };
    const leaderboard = await Donor.find(filter)
      .select('name city bloodGroup points totalDonations')
      .sort({ points: -1 }).limit(50);
    res.json({ success: true, leaderboard });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/donors/availability
router.put('/availability', auth('donor'), async (req, res) => {
  try {
    const donor = await Donor.findById(req.user.id);
    donor.availabilityStatus = donor.availabilityStatus === 'available' ? 'not available' : 'available';
    await donor.save();
    res.json({ success: true, availabilityStatus: donor.availabilityStatus });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/donors/deactivate
router.put('/deactivate', auth('donor'), async (req, res) => {
  try {
    await Donor.findByIdAndUpdate(req.user.id, { isActive: false });
    res.json({ success: true, message: 'Account deactivated' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;