const express = require('express');
const router = express.Router();
const Hospital = require('../models/Hospital');
const Donor = require('../models/Donor');
const Request = require('../models/Request');
const { Alert } = require('../models/Other');
const { auth } = require('../middleware/auth');

// Blood group compatibility
const compatibility = {
  'O+':  ['O+','O-'],
  'O-':  ['O-'],
  'A+':  ['A+','A-','O+','O-'],
  'A-':  ['A-','O-'],
  'B+':  ['B+','B-','O+','O-'],
  'B-':  ['B-','O-'],
  'AB+': ['A+','A-','B+','B-','O+','O-','AB+','AB-'],
  'AB-': ['A-','B-','O-','AB-']
};

// POST /api/hospital/register
router.post('/register', async (req, res) => {
  try {
    const { hospitalName, registrationNumber, address, city, pincode, contactPerson, designation, phone, email, password } = req.body;
    if (!hospitalName || !registrationNumber || !address || !city || !pincode || !contactPerson || !phone || !email || !password)
      return res.status(400).json({ success: false, message: 'All required fields must be filled' });

    const exists = await Hospital.findOne({ $or: [{ email }, { registrationNumber }] });
    if (exists) return res.status(409).json({ success: false, message: 'Email or registration number already exists' });

    const hospital = new Hospital({ hospitalName, registrationNumber, address, city, pincode, contactPerson, designation, phone, email, password });
    await hospital.save();
    res.status(201).json({ success: true, message: 'Hospital registered. Awaiting admin verification.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/hospital/profile
router.get('/profile', auth('hospital'), async (req, res) => {
  try {
    const hospital = await Hospital.findById(req.user.id).select('-password');
    res.json({ success: true, hospital });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/hospital/profile
router.put('/profile', auth('hospital'), async (req, res) => {
  try {
    const { hospitalName, phone, city, address, contactPerson } = req.body;
    const updates = {};
    if (hospitalName)   updates.hospitalName   = hospitalName;
    if (phone)          updates.phone          = phone;
    if (city)           updates.city           = city;
    if (address)        updates.address        = address;
    if (contactPerson)  updates.contactPerson  = contactPerson;

    const hospital = await Hospital.findByIdAndUpdate(req.user.id, { $set: updates }, { new: true }).select('-password');
    res.json({ success: true, message: 'Profile updated', hospital });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/hospital/request — Create blood request
router.post('/request', auth('hospital'), async (req, res) => {
  try {
    const hospital = await Hospital.findById(req.user.id);
    if (!hospital) return res.status(404).json({ success: false, message: 'Hospital not found' });
    if (!hospital.isVerified) return res.status(403).json({ success: false, message: 'Hospital not verified by admin' });

    const { bloodGroup, urgency, quantity, patientName, patientReason, doctorRefNo, patientAge, patientGender } = req.body;
    if (!bloodGroup) return res.status(400).json({ success: false, message: 'Blood group required' });

    const request = new Request({
      hospitalId:   hospital._id,
      hospitalName: hospital.hospitalName,
      hospitalCity: hospital.city,
      hospitalPhone: hospital.phone,
      bloodGroup, urgency: urgency || 'normal',
      quantity: quantity || 1,
      patientName:   patientName   || '',
      patientReason: patientReason || '',
      doctorRefNo:   doctorRefNo   || '',
      patientAge, patientGender,
      status: 'pending'
    });
    await request.save();

    // Match donors
    const compatibleGroups = compatibility[bloodGroup] || [bloodGroup];
    const donors = await Donor.find({
      bloodGroup: { $in: compatibleGroups },
      city: { $regex: hospital.city, $options: 'i' },
      isActive: true,
      availabilityStatus: 'available',
      $or: [{ nextEligibleDate: null }, { nextEligibleDate: { $lte: new Date() } }]
    }).limit(50);

    // Create alerts for matching donors
    const alerts = donors.map(d => ({
      requestId:    request._id,
      donorId:      d._id,
      donorPhone:   d.phone,
      bloodGroup,
      hospitalName: hospital.hospitalName,
      urgency:      urgency || 'normal',
      status:       'sent'
    }));
    if (alerts.length > 0) await Alert.insertMany(alerts);

    // Emit via Socket.IO
    const io = req.app.get('io');
    if (io) {
      io.to(hospital.city).emit('new_blood_request', {
        ...request.toObject(),
        hospital: { hospitalName: hospital.hospitalName, city: hospital.city, phone: hospital.phone }
      });
    }

    hospital.totalRequests += 1;
    await hospital.save();

    res.status(201).json({
      success: true, message: `Request posted! ${donors.length} donors alerted.`,
      request, matchedDonors: donors.length
    });
  } catch (err) {
    console.error('createRequest error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/hospital/requests
router.get('/requests', auth('hospital'), async (req, res) => {
  try {
    const requests = await Request.find({ hospitalId: req.user.id })
      .sort({ createdAt: -1 }).limit(50);
    res.json({ success: true, requests });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/hospital/request/:id
router.get('/request/:id', auth('hospital'), async (req, res) => {
  try {
    const request = await Request.findOne({ _id: req.params.id, hospitalId: req.user.id });
    if (!request) return res.status(404).json({ success: false, message: 'Request not found' });
    res.json({ success: true, request });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/hospital/request/:id/cancel
router.put('/request/:id/cancel', auth('hospital'), async (req, res) => {
  try {
    const request = await Request.findOne({ _id: req.params.id, hospitalId: req.user.id });
    if (!request) return res.status(404).json({ success: false, message: 'Request not found' });
    if (request.status !== 'pending') return res.status(400).json({ success: false, message: 'Can only cancel pending requests' });

    request.status = 'cancelled';
    request.cancelledAt = new Date();
    request.cancelReason = req.body.reason || 'Cancelled by hospital';
    await request.save();

    await Alert.updateMany({ requestId: request._id }, { $set: { status: 'expired' } });
    res.json({ success: true, message: 'Request cancelled' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/hospital/request/:id/complete
router.put('/request/:id/complete', auth('hospital'), async (req, res) => {
  try {
    const request = await Request.findOne({ _id: req.params.id, hospitalId: req.user.id });
    if (!request) return res.status(404).json({ success: false, message: 'Request not found' });
    if (request.status !== 'accepted') return res.status(400).json({ success: false, message: 'Request must be accepted first' });

    request.status = 'completed';
    request.completedAt = new Date();
    await request.save();

    // Award points and set cooldown
    if (request.acceptedBy) {
      const pts = request.pointsEarned || (request.urgency === 'emergency' ? 30 : request.urgency === 'urgent' ? 20 : 10);
      const cooldown = new Date();
      cooldown.setDate(cooldown.getDate() + 90);

      await Donor.findByIdAndUpdate(request.acceptedBy, {
        $inc: { points: pts, totalDonations: 1 },
        $set: { lastDonationDate: new Date(), nextEligibleDate: cooldown, availabilityStatus: 'not available' }
      });

      const io = req.app.get('io');
      if (io) {
        io.to(`donor_${request.acceptedBy}`).emit('donation_confirmed', {
          points: pts, message: `Donation confirmed! +${pts} points earned 🎉`
        });
      }
    }

    await Hospital.findByIdAndUpdate(req.user.id, { $inc: { fulfilledRequests: 1 } });
    res.json({ success: true, message: 'Donation completed! Points awarded.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/hospital/request/:id/donors
router.get('/request/:id/donors', auth('hospital'), async (req, res) => {
  try {
    const alerts = await Alert.find({ requestId: req.params.id })
      .populate('donorId', 'name city bloodGroup points');
    res.json({ success: true, alerts });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/hospital/request/:id/donor-contact
router.get('/request/:id/donor-contact', auth('hospital'), async (req, res) => {
  try {
    const request = await Request.findOne({ _id: req.params.id, hospitalId: req.user.id });
    if (!request) return res.status(404).json({ success: false, message: 'Request not found' });
    if (request.status !== 'accepted') return res.status(400).json({ success: false, message: 'Donor has not accepted yet' });
    res.json({ success: true, donor: { name: request.acceptedDonorName, phone: request.acceptedDonorPhone } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/hospital/reports
router.get('/reports', auth('hospital'), async (req, res) => {
  try {
    const hospital = await Hospital.findById(req.user.id).select('-password');
    const total     = await Request.countDocuments({ hospitalId: req.user.id });
    const fulfilled = await Request.countDocuments({ hospitalId: req.user.id, status: 'completed' });
    const pending   = await Request.countDocuments({ hospitalId: req.user.id, status: 'pending' });
    const cancelled = await Request.countDocuments({ hospitalId: req.user.id, status: 'cancelled' });
    res.json({ success: true, reports: { total, fulfilled, pending, cancelled, fulfillmentRate: total > 0 ? Math.round((fulfilled/total)*100) : 0 } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
