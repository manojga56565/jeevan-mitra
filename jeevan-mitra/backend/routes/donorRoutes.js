const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const Donor = require('../models/Donor');
const Request = require('../models/Request');
const { Alert } = require('../models/Other');
const { auth } = require('../middleware/auth');

const JWT_SECRET = process.env.JWT_SECRET || 'jeevanmitra_secret';

// POST /api/donor/register
router.post('/register', async (req, res) => {
  try {
    const { name, phone, email, city, bloodGroup, age, weight, password } = req.body;
    if (!name || !phone || !city || !bloodGroup || !age || !weight || !password)
      return res.status(400).json({ success: false, message: 'All fields required' });

    const exists = await Donor.findOne({ phone });
    if (exists) return res.status(409).json({ success: false, message: 'Phone already registered' });

    const donor = new Donor({ name, phone, email, city, bloodGroup, age, weight, password });
    await donor.save();
    res.status(201).json({ success: true, message: 'Registered. Please verify OTP.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/donor/profile
router.get('/profile', auth('donor'), async (req, res) => {
  try {
    const donor = await Donor.findById(req.user.id).select('-password -otpCode -otpExpiresAt');
    if (!donor) return res.status(404).json({ success: false, message: 'Donor not found' });
    res.json({ success: true, donor });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/donor/profile
router.put('/profile', auth('donor'), async (req, res) => {
  try {
    const { name, email, city, availabilityStatus, dob } = req.body;
    const updates = {};
    if (name) updates.name = name;
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

// POST /api/donor/change-password
router.post('/change-password', auth('donor'), async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    const donor = await Donor.findById(req.user.id);
    const match = await donor.comparePassword(oldPassword);
    if (!match) return res.status(401).json({ success: false, message: 'Wrong current password' });
    donor.password = newPassword;
    await donor.save();
    res.json({ success: true, message: 'Password changed' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/donor/alerts
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

// POST /api/donor/alerts/:id/accept
router.post('/alerts/:id/accept', auth('donor'), async (req, res) => {
  try {
    const alert = await Alert.findById(req.params.id);
    if (!alert) return res.status(404).json({ success: false, message: 'Alert not found' });

    const request = await Request.findById(alert.requestId);
    if (!request || request.status !== 'pending')
      return res.status(400).json({ success: false, message: 'Request no longer available' });

    const donor = await Donor.findById(req.user.id);

    // Update request
    request.status = 'accepted';
    request.acceptedBy = donor._id;
    request.acceptedDonorName = donor.name;
    request.acceptedDonorPhone = donor.phone;
    request.acceptedAt = new Date();
    await request.save();

    // Update this alert
    alert.status = 'accepted';
    alert.respondedAt = new Date();
    await alert.save();

    // Expire other alerts
    await Alert.updateMany(
      { requestId: request._id, _id: { $ne: alert._id } },
      { $set: { status: 'expired' } }
    );

    // Notify hospital via Socket.IO
    const io = req.app.get('io');
    if (io) {
      io.to(`hospital_${request.hospitalId}`).emit('request_accepted', {
        requestId: request._id,
        donor: { name: donor.name, phone: donor.phone, bloodGroup: donor.bloodGroup }
      });
    }

    res.json({ success: true, message: 'Request accepted! Hospital will contact you.', request });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/donor/alerts/:id/decline
router.post('/alerts/:id/decline', auth('donor'), async (req, res) => {
  try {
    await Alert.findByIdAndUpdate(req.params.id, { status: 'declined', respondedAt: new Date() });
    res.json({ success: true, message: 'Request declined' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/donor/history
router.get('/history', auth('donor'), async (req, res) => {
  try {
    const history = await Request.find({
      acceptedBy: req.user.id,
      status: { $in: ['accepted','completed'] }
    }).populate('hospitalId', 'hospitalName city phone').sort({ createdAt: -1 });
    res.json({ success: true, history });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/donor/points
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

// GET /api/donor/leaderboard
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

// PUT /api/donor/availability
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

// POST /api/donor/deactivate
router.post('/deactivate', auth('donor'), async (req, res) => {
  try {
    await Donor.findByIdAndUpdate(req.user.id, { isActive: false });
    res.json({ success: true, message: 'Account deactivated' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
