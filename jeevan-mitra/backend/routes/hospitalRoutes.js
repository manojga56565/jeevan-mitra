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
    if (hospital.isVerified === false) return res.status(403).json({ success: false, message: 'Pending Admin Verification' });

    const isMatch = await bcrypt.compare(password, hospital.password);
    if (!isMatch) return res.status(401).json({ success: false, message: 'Invalid credentials' });

    const token = jwt.sign(
      { id: hospital._id, role: 'hospital' }, 
      process.env.JWT_SECRET || 'jeevanmitra_secret', 
      { expiresIn: '24h' }
    );

    res.json({ success: true, token, hospital });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══ CREATE REQUEST (Synced with your Mongoose Model) ═══
router.post(['/', '/requests', '/request'], auth('hospital'), async (req, res) => {
  try {
    // Fetch hospital details for required model fields
    const hospital = await Hospital.findById(req.user.id);
    if (!hospital) return res.status(404).json({ success: false, message: 'Hospital not found' });

    const newRequest = new Request({
      hospitalId: hospital._id,
      hospitalName: hospital.hospitalName,
      hospitalCity: hospital.city,
      hospitalPhone: hospital.phone,
      bloodGroup: req.body.bloodGroup,
      urgency: req.body.urgency || 'normal',
      quantity: req.body.quantity || 1, // Matches frontend 'quantity'
      patientName: req.body.patientName || '',
      patientReason: req.body.patientReason || '', // Matches frontend 'patientReason'
      doctorRefNo: req.body.doctorRefNo || '',
      status: 'pending'
    });

    await newRequest.save();

    // Matching Engine: Local city matching
    const matchingDonors = await Donor.find({
      bloodGroup: newRequest.bloodGroup,
      city: hospital.city,
      isActive: true,
      availabilityStatus: 'available'
    });

    if (matchingDonors.length > 0) {
      const alerts = matchingDonors.map(d => ({ 
        donorId: d._id, 
        requestId: newRequest._id, 
        status: 'pending' 
      }));
      await Alert.insertMany(alerts);
    }

    res.status(201).json({ success: true, message: 'Request posted successfully!', request: newRequest });
  } catch (err) {
    console.error("Backend Error:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══ GET ALL HOSPITAL REQUESTS ═══
router.get(['/', '/requests', '/request'], auth('hospital'), async (req, res) => {
  try {
    const requests = await Request.find({ hospitalId: req.user.id }).sort({ createdAt: -1 });
    res.json({ success: true, requests });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;