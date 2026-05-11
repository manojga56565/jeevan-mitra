const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const axios = require('axios');

const Donor = require('../models/Donor');
const Hospital = require('../models/Hospital');

const JWT_SECRET  = process.env.JWT_SECRET || 'jeevanmitra_secret';
const AUTH_KEY    = process.env.MSG91_AUTH_KEY || process.env.MSG91_API_KEY;
const TEMPLATE_ID = process.env.MSG91_TEMPLATE_ID || "69f2c392c83ddd4fd90ff3d2";

const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

// ─── DONOR SEND OTP ────────────────────────────────────────
router.post('/donor/send-otp', async (req, res) => {
  try {
    const { phone, fullName, name, city, bloodGroup, dob, age, weight, password } = req.body;
    const donorName = fullName || name;
    if (!phone) return res.status(400).json({ success: false, message: 'Phone required' });

    let donor = await Donor.findOne({ phone });
    if (!donor) {
      if (!donorName || !city || !bloodGroup) {
        return res.status(400).json({ success: false, message: 'Name, city and blood group required' });
      }
      donor = new Donor({
        name: donorName, phone, city, bloodGroup,
        dob: dob || null,
        age: age || 18,
        weight: weight || 50,
        password: password || Math.random().toString(36).slice(2)
      });
    } else {
      if (donorName) donor.name = donorName;
      if (city) donor.city = city;
      if (bloodGroup) donor.bloodGroup = bloodGroup;
      if (dob) donor.dob = dob;
    }

    const otp = generateOTP();

    // Send via MSG91
    try {
      if (AUTH_KEY && AUTH_KEY !== 'undefined') {
        await axios.post(
          "https://api.msg91.com/api/v5/flow/",
          { flow_id: TEMPLATE_ID, mobiles: `91${phone.replace('+91','')}`, OTP: otp },
          { headers: { authkey: AUTH_KEY, "content-type": "application/json" } }
        );
        console.log("✅ OTP sent via MSG91:", otp);
      } else {
        console.log("📱 DEV OTP for", phone, ":", otp);
      }
    } catch (err) {
      console.log("❌ MSG91 ERROR:", err.response?.data || err.message);
    }

    donor.otpCode = otp;
    donor.otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await donor.save();

    const isDev = !AUTH_KEY || AUTH_KEY === 'undefined';
    res.json({ success: true, message: 'OTP sent', phone, ...(isDev && { otp }) });
  } catch (err) {
    console.error('send-otp error:', err.message);
    res.status(500).json({ success: false, message: 'OTP send failed: ' + err.message });
  }
});

// ─── DONOR VERIFY OTP ──────────────────────────────────────
router.post('/donor/verify-otp', async (req, res) => {
  try {
    const { phone, otp } = req.body;
    const donor = await Donor.findOne({ phone });
    if (!donor) return res.status(404).json({ success: false, message: 'Donor not found' });
    if (donor.otpCode !== otp) return res.status(400).json({ success: false, message: 'Invalid OTP' });
    if (new Date() > donor.otpExpiresAt) return res.status(400).json({ success: false, message: 'OTP expired' });

    donor.isPhoneVerified = true;
    donor.isVerified = true;
    donor.otpCode = null;
    donor.otpExpiresAt = null;
    await donor.save();

    const token = jwt.sign({ id: donor._id, role: 'donor' }, JWT_SECRET, { expiresIn: '7d' });
    res.json({
      success: true, message: 'Verified successfully', token,
      user: {
        _id: donor._id, name: donor.name, fullName: donor.name,
        phone: donor.phone, bloodGroup: donor.bloodGroup,
        city: donor.city, dob: donor.dob,
        points: donor.points || 0,
        totalDonations: donor.totalDonations || 0,
        donationCount: donor.totalDonations || 0,
        isAvailable: donor.availabilityStatus === 'available',
        availabilityStatus: donor.availabilityStatus,
        cooldownUntil: donor.nextEligibleDate,
        referralCode: donor.referralCode,
        role: 'donor'
      }
    });
  } catch (err) {
    res.status(400).json({ success: false, message: 'OTP verification failed: ' + err.message });
  }
});

// ─── DONOR QUICK LOGIN ─────────────────────────────────────
router.post('/donor/quick-login', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ success: false, message: 'Phone required' });

    const donor = await Donor.findOne({ phone });
    if (!donor) return res.status(404).json({ success: false, message: 'Donor not found. Please register first.' });

    const otp = generateOTP();
    try {
      if (AUTH_KEY && AUTH_KEY !== 'undefined') {
        await axios.post(
          "https://api.msg91.com/api/v5/flow/",
          { flow_id: TEMPLATE_ID, mobiles: `91${phone.replace('+91','')}`, OTP: otp },
          { headers: { authkey: AUTH_KEY, "content-type": "application/json" } }
        );
      } else {
        console.log("📱 DEV Quick Login OTP:", otp);
      }
    } catch (err) {
      console.log("MSG91 ERROR:", err.response?.data || err.message);
    }

    donor.otpCode = otp;
    donor.otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await donor.save();

    const isDev = !AUTH_KEY || AUTH_KEY === 'undefined';
    res.json({ success: true, message: 'OTP sent', ...(isDev && { otp }) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── DONOR LOGIN (phone + password) ───────────────────────
router.post('/donor/login', async (req, res) => {
  try {
    const { phone, email, password } = req.body;
    const donor = await Donor.findOne(phone ? { phone } : { email });
    if (!donor) return res.status(404).json({ success: false, message: 'Donor not found' });

    const match = await donor.comparePassword(password);
    if (!match) return res.status(401).json({ success: false, message: 'Invalid password' });

    const token = jwt.sign({ id: donor._id, role: 'donor' }, JWT_SECRET, { expiresIn: '7d' });
    res.json({
      success: true, message: 'Login successful', token,
      user: {
        _id: donor._id, name: donor.name, fullName: donor.name,
        phone: donor.phone, bloodGroup: donor.bloodGroup,
        city: donor.city, points: donor.points || 0,
        totalDonations: donor.totalDonations || 0,
        donationCount: donor.totalDonations || 0,
        isAvailable: donor.availabilityStatus === 'available',
        availabilityStatus: donor.availabilityStatus,
        cooldownUntil: donor.nextEligibleDate,
        role: 'donor'
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── HOSPITAL LOGIN ────────────────────────────────────────
router.post('/hospital/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ success: false, message: 'Email and password required' });

    const hospital = await Hospital.findOne({ email: email.toLowerCase().trim() });
    if (!hospital)
      return res.status(404).json({ success: false, message: 'Hospital not found. Contact admin.' });

    const match = await hospital.comparePassword(password);
    if (!match)
      return res.status(401).json({ success: false, message: 'Invalid password' });

    if (!hospital.isVerified)
      return res.status(403).json({ success: false, message: 'Account pending verification. Contact admin.' });

    if (!hospital.isActive)
      return res.status(403).json({ success: false, message: 'Account is deactivated. Contact admin.' });

    const token = jwt.sign({ id: hospital._id, role: 'hospital' }, JWT_SECRET, { expiresIn: '7d' });
    res.json({
      success: true, message: 'Login successful', token,
      user: {
        _id: hospital._id,
        hospitalName: hospital.hospitalName,
        email: hospital.email,
        phone: hospital.phone,
        city: hospital.city,
        address: hospital.address,
        contactPerson: hospital.contactPerson,
        totalRequests: hospital.totalRequests,
        fulfilledRequests: hospital.fulfilledRequests,
        role: 'hospital'
      }
    });
  } catch (err) {
    console.error('hospital login error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── ADMIN LOGIN ───────────────────────────────────────────
router.post('/admin/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const adminEmail    = process.env.ADMIN_EMAIL    || 'admin@jeevanmitra.in';
    const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@JM2026';

    if (email !== adminEmail || password !== adminPassword)
      return res.status(401).json({ success: false, message: 'Invalid admin credentials' });

    const token = jwt.sign({ id: 'admin', role: 'admin', email }, JWT_SECRET, { expiresIn: '7d' });
    res.json({
      success: true, message: 'Admin login successful', token,
      user: { email, role: 'admin' }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
