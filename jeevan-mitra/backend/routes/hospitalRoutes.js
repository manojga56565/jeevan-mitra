const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Hospital = require('../models/Hospital');
const Donor = require('../models/Donor');
const Request = require('../models/Request');
const { Alert } = require('../models/Other');
const { auth } = require('../middleware/auth');

// ═══ PART 2: HOSPITAL AUTH ═══
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ success: false, message: 'Email and password required' });

    const hospital = await Hospital.findOne({ email: email.toLowerCase() });
    if (!hospital) return res.status(404).json({ success: false, message: 'Hospital not found' });
    if (hospital.isVerified === false) return res.status(403).json({ success: false, message: 'Account pending admin verification' });

    const isMatch = await bcrypt.compare(password, hospital.password);
    if (!isMatch) return res.status(401).json({ success: false, message: 'Invalid credentials' });

    const token = jwt.sign({ id: hospital._id, role: 'hospital' }, process.env.JWT_SECRET || 'default_secret_key', { expiresIn: '24h' });
    res.json({ success: true, token, hospital: { _id: hospital._id, hospitalName: hospital.hospitalName } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══ PART 2: BLOOD REQUESTS & MATCHING ENGINE ═══
router.get(['/requests', '/request'], auth('hospital'), async (req, res) => {
  try {
    const requests = await Request.find({ hospitalId: req.user.id }).sort({ createdAt: -1 });
    res.json({ success: true, requests });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post(['/requests', '/request'], auth('hospital'), async (req, res) => {
  try {
    const bloodGroup = req.body.bloodGroup || req.body.bloodGroupRequired;
    const urgency = req.body.urgencyLevel || req.body.urgency || 'normal';

    if (!bloodGroup) return res.status(400).json({ success: false, message: 'Blood group required' });

    const newRequest = new Request({
      hospitalId: req.user.id,
      bloodGroup,
      units: req.body.units || 1,
      urgency,
      patientName: req.body.patientName,
      doctorRefNo: req.body.doctorRefNo,
      notes: req.body.notes,
      status: 'pending'
    });
    await newRequest.save();

    // 90-Day Cooldown Check applied to matching donors
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const matchingDonors = await Donor.find({
      bloodGroup: bloodGroup,
      isActive: true,
      availabilityStatus: 'available',
      $or: [{ lastDonationDate: { $exists: false } }, { lastDonationDate: { $lte: ninetyDaysAgo } }]
    });

    if (matchingDonors.length > 0) {
      const alerts = matchingDonors.map(d => ({ donorId: d._id, requestId: newRequest._id, status: 'pending' }));
      await Alert.insertMany(alerts);
    }

    const io = req.app.get('io');
    if (io) matchingDonors.forEach(d => io.to(`donor_${d._id}`).emit('new_alert', { request: newRequest }));

    res.status(201).json({ success: true, request: newRequest, alerted: matchingDonors.length });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══ PART 2: MARK COMPLETED & AWARD POINTS ═══
router.put('/requests/:id/complete', auth('hospital'), async (req, res) => {
  try {
    const request = await Request.findOne({ _id: req.params.id, hospitalId: req.user.id });
    if (!request) return res.status(404).json({ success: false, message: 'Request not found' });

    request.status = 'completed';
    await request.save();

    // Award Points based on Urgency Level (Step 11)
    if (request.acceptedBy) {
      const donor = await Donor.findById(request.acceptedBy);
      if (donor) {
        let points = 10; // Normal
        if (request.urgency === 'urgent') points = 20;
        if (request.urgency === 'emergency' || request.urgency === 'critical') points = 30;

        donor.points = (donor.points || 0) + points;
        donor.totalDonations = (donor.totalDonations || 0) + 1;
        donor.lastDonationDate = new Date(); // Start 90-day cooldown
        await donor.save();
      }
    }

    res.json({ success: true, message: 'Request completed. Points awarded to donor.', request });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;