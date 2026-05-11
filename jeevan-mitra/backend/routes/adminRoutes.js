const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const Donor = require('../models/Donor');
const Hospital = require('../models/Hospital');
const Request = require('../models/Request');
const { Alert, SystemLog } = require('../models/Other');
const { adminAuth } = require('../middleware/auth');

// Helper: log admin action
async function log(req, action, target, targetId, details) {
  try {
    await SystemLog.create({
      adminId: req.user?.id !== 'admin' ? req.user?.id : null,
      adminEmail: req.user?.email || 'admin',
      action, target, targetId, details,
      ipAddress: req.ip
    });
  } catch (e) { console.log('Log error:', e.message); }
}

// ═══ DONORS ══════════════════════════════════════════════════

// GET /api/admin/donors
router.get('/donors', adminAuth, async (req, res) => {
  try {
    const { bloodGroup, city, status, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (bloodGroup) filter.bloodGroup = bloodGroup;
    if (city) filter.city = { $regex: city, $options: 'i' };
    if (status === 'active') filter.isActive = true;
    if (status === 'inactive') filter.isActive = false;

    const donors = await Donor.find(filter)
      .select('-password -otpCode -otpExpiresAt')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));
    const total = await Donor.countDocuments(filter);
    res.json({ success: true, donors, total, page: parseInt(page) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/admin/donor/:id
router.get('/donor/:id', adminAuth, async (req, res) => {
  try {
    const donor = await Donor.findById(req.params.id).select('-password -otpCode -otpExpiresAt');
    if (!donor) return res.status(404).json({ success: false, message: 'Donor not found' });
    res.json({ success: true, donor });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/admin/donor/:id
router.put('/donor/:id', adminAuth, async (req, res) => {
  try {
    const { name, phone, city, bloodGroup, isAvailable, isActive, dob } = req.body;
    const updates = {};
    if (name !== undefined)        updates.name = name;
    if (phone !== undefined)       updates.phone = phone;
    if (city !== undefined)        updates.city = city;
    if (bloodGroup !== undefined)  updates.bloodGroup = bloodGroup;
    if (isAvailable !== undefined) updates.availabilityStatus = isAvailable ? 'available' : 'not available';
    if (isActive !== undefined)    updates.isActive = isActive;
    if (dob !== undefined)         updates.dob = dob;

    const donor = await Donor.findByIdAndUpdate(req.params.id, { $set: updates }, { new: true })
      .select('-password -otpCode -otpExpiresAt');
    if (!donor) return res.status(404).json({ success: false, message: 'Donor not found' });
    await log(req, `Edited donor: ${donor.name}`, 'donor', donor._id, JSON.stringify(updates));
    res.json({ success: true, message: 'Donor updated', donor });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/admin/donor/:id
router.delete('/donor/:id', adminAuth, async (req, res) => {
  try {
    const donor = await Donor.findByIdAndDelete(req.params.id);
    if (!donor) return res.status(404).json({ success: false, message: 'Donor not found' });
    await log(req, `Deleted donor: ${donor.name}`, 'donor', donor._id, '');
    res.json({ success: true, message: 'Donor permanently deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/admin/donor/:id/toggle
router.put('/donor/:id/toggle', adminAuth, async (req, res) => {
  try {
    const donor = await Donor.findById(req.params.id);
    if (!donor) return res.status(404).json({ success: false, message: 'Donor not found' });
    donor.isActive = !donor.isActive;
    await donor.save();
    await log(req, `${donor.isActive ? 'Activated' : 'Deactivated'} donor: ${donor.name}`, 'donor', donor._id, '');
    res.json({ success: true, message: `Donor ${donor.isActive ? 'activated' : 'deactivated'}`, donor });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/admin/donor/:id/reset-password
router.post('/donor/:id/reset-password', adminAuth, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 6)
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    const hashed = await bcrypt.hash(password, 10);
    const donor = await Donor.findByIdAndUpdate(req.params.id, { $set: { password: hashed } }, { new: true });
    if (!donor) return res.status(404).json({ success: false, message: 'Donor not found' });
    await log(req, `Reset password for donor: ${donor.name}`, 'donor', donor._id, '');
    res.json({ success: true, message: 'Password reset successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══ HOSPITALS ═══════════════════════════════════════════════

// GET /api/admin/hospitals
router.get('/hospitals', adminAuth, async (req, res) => {
  try {
    const { city, verified, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (city) filter.city = { $regex: city, $options: 'i' };
    if (verified === 'true') filter.isVerified = true;
    if (verified === 'false') filter.isVerified = false;

    const hospitals = await Hospital.find(filter)
      .select('-password')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));
    const total = await Hospital.countDocuments(filter);
    res.json({ success: true, hospitals, total });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/admin/hospitals — Add hospital manually
router.post('/hospitals', adminAuth, async (req, res) => {
  try {
    const { hospitalName, email, phone, city, address, pincode, contactPerson, registrationNumber, password, type } = req.body;
    if (!hospitalName || !email || !password || !city)
      return res.status(400).json({ success: false, message: 'Name, email, city and password required' });

    const exists = await Hospital.findOne({ email: email.toLowerCase() });
    if (exists) return res.status(409).json({ success: false, message: 'Email already registered' });

    const hospital = new Hospital({
      hospitalName, email: email.toLowerCase(), phone: phone || '',
      city, address: address || '', pincode: pincode || '000000',
      contactPerson: contactPerson || hospitalName,
      registrationNumber: registrationNumber || 'ADM-' + Date.now(),
      password, isVerified: true, isActive: true
    });
    await hospital.save();
    await log(req, `Admin added hospital: ${hospitalName}`, 'hospital', hospital._id, '');
    res.status(201).json({ success: true, message: 'Hospital added and verified', hospital });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/admin/hospital/:id
router.get('/hospital/:id', adminAuth, async (req, res) => {
  try {
    const hospital = await Hospital.findById(req.params.id).select('-password');
    if (!hospital) return res.status(404).json({ success: false, message: 'Hospital not found' });
    res.json({ success: true, hospital });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/admin/hospital/:id
router.put('/hospital/:id', adminAuth, async (req, res) => {
  try {
    const { hospitalName, phone, city, email, address, contactPerson } = req.body;
    const updates = {};
    if (hospitalName)  updates.hospitalName  = hospitalName;
    if (phone)         updates.phone         = phone;
    if (city)          updates.city          = city;
    if (email)         updates.email         = email.toLowerCase();
    if (address)       updates.address       = address;
    if (contactPerson) updates.contactPerson = contactPerson;

    const hospital = await Hospital.findByIdAndUpdate(req.params.id, { $set: updates }, { new: true }).select('-password');
    if (!hospital) return res.status(404).json({ success: false, message: 'Hospital not found' });
    await log(req, `Edited hospital: ${hospital.hospitalName}`, 'hospital', hospital._id, '');
    res.json({ success: true, message: 'Hospital updated', hospital });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/admin/hospital/:id/toggle
router.put('/hospital/:id/toggle', adminAuth, async (req, res) => {
  try {
    const hospital = await Hospital.findById(req.params.id);
    if (!hospital) return res.status(404).json({ success: false, message: 'Hospital not found' });
    hospital.isVerified = !hospital.isVerified;
    await hospital.save();
    await log(req, `${hospital.isVerified ? 'Verified' : 'Unverified'} hospital: ${hospital.hospitalName}`, 'hospital', hospital._id, '');
    res.json({ success: true, message: `Hospital ${hospital.isVerified ? 'verified' : 'unverified'}`, hospital });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/admin/hospital/:id
router.delete('/hospital/:id', adminAuth, async (req, res) => {
  try {
    const hospital = await Hospital.findByIdAndDelete(req.params.id);
    if (!hospital) return res.status(404).json({ success: false, message: 'Hospital not found' });
    await log(req, `Deleted hospital: ${hospital.hospitalName}`, 'hospital', hospital._id, '');
    res.json({ success: true, message: 'Hospital permanently deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/admin/hospital/:id/reset-password
router.post('/hospital/:id/reset-password', adminAuth, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 6)
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    const hashed = await bcrypt.hash(password, 10);
    const hospital = await Hospital.findByIdAndUpdate(req.params.id, { $set: { password: hashed } }, { new: true });
    if (!hospital) return res.status(404).json({ success: false, message: 'Hospital not found' });
    await log(req, `Reset password for hospital: ${hospital.hospitalName}`, 'hospital', hospital._id, '');
    res.json({ success: true, message: 'Password reset successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══ REQUESTS ════════════════════════════════════════════════

// GET /api/admin/requests
router.get('/requests', adminAuth, async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const filter = status ? { status } : {};
    const requests = await Request.find(filter)
      .populate('hospitalId', 'hospitalName city')
      .populate('acceptedBy', 'name phone bloodGroup')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));
    const total = await Request.countDocuments(filter);
    res.json({ success: true, requests, total });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/admin/request/:id/cancel
router.put('/request/:id/cancel', adminAuth, async (req, res) => {
  try {
    const request = await Request.findByIdAndUpdate(
      req.params.id,
      { $set: { status: 'cancelled', cancelledAt: new Date(), cancelReason: req.body.reason || 'Cancelled by admin' } },
      { new: true }
    );
    if (!request) return res.status(404).json({ success: false, message: 'Request not found' });
    await Alert.updateMany({ requestId: request._id }, { $set: { status: 'expired' } });
    await log(req, `Cancelled request: ${request._id}`, 'request', request._id, '');
    res.json({ success: true, message: 'Request cancelled' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/admin/request/:id
router.delete('/request/:id', adminAuth, async (req, res) => {
  try {
    await Request.findByIdAndDelete(req.params.id);
    await Alert.deleteMany({ requestId: req.params.id });
    res.json({ success: true, message: 'Request deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══ ANALYTICS ═══════════════════════════════════════════════

// GET /api/admin/analytics
router.get('/analytics', adminAuth, async (req, res) => {
  try {
    const [totalDonors, activeDonors, totalHospitals, verifiedHospitals,
           totalRequests, fulfilledRequests, pendingRequests] = await Promise.all([
      Donor.countDocuments(),
      Donor.countDocuments({ isActive: true }),
      Hospital.countDocuments(),
      Hospital.countDocuments({ isVerified: true }),
      Request.countDocuments(),
      Request.countDocuments({ status: 'completed' }),
      Request.countDocuments({ status: 'pending' }),
    ]);
    res.json({
      success: true,
      analytics: {
        totalDonors, activeDonors, totalHospitals, verifiedHospitals,
        totalRequests, fulfilledRequests, pendingRequests,
        successRate: totalRequests > 0 ? Math.round((fulfilledRequests / totalRequests) * 100) : 0
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/admin/broadcast
router.post('/broadcast', adminAuth, async (req, res) => {
  try {
    const { target, message } = req.body;
    if (!message) return res.status(400).json({ success: false, message: 'Message required' });
    const io = req.app.get('io');
    if (io) io.emit('admin_broadcast', { target, message });
    await log(req, `Broadcast to ${target}: "${message.slice(0, 50)}"`, 'admin', null, message);
    res.json({ success: true, message: 'Broadcast sent successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/admin/logs
router.get('/logs', adminAuth, async (req, res) => {
  try {
    const logs = await SystemLog.find().sort({ createdAt: -1 }).limit(50);
    res.json({ success: true, logs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/admin/create-admin
router.post('/create-admin', adminAuth, async (req, res) => {
  try {
    const { email, password } = req.body;
    await log(req, `Created new admin: ${email}`, 'admin', null, '');
    res.json({ success: true, message: `Admin account created for ${email}` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
