const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const DonorSchema = new mongoose.Schema({
  name:             { type: String, required: true, trim: true },
  phone:            { type: String, required: true, unique: true },
  email:            { type: String, default: '', lowercase: true },
  city:             { type: String, required: true },
  bloodGroup:       { type: String, required: true, enum: ['A+','A-','B+','B-','O+','O-','AB+','AB-'] },
  age:              { type: Number, required: true, min: 18, max: 65 },
  weight:           { type: Number, required: true, min: 45 },
  password:         { type: String, required: true },
  isPhoneVerified:  { type: Boolean, default: false },
  isActive:         { type: Boolean, default: true },
  isVerified:       { type: Boolean, default: false },
  availabilityStatus: { type: String, enum: ['available','not available'], default: 'available' },
  points:           { type: Number, default: 0 },
  totalDonations:   { type: Number, default: 0 },
  lastDonationDate: { type: Date },
  nextEligibleDate: { type: Date },
  otpCode:          { type: String },
  otpExpiresAt:     { type: Date },
  referralCode:     { type: String, unique: true, sparse: true },
  referredBy:       { type: String },
  referralCount:    { type: Number, default: 0 },
  lastActiveAt:     { type: Date },
}, { timestamps: true });

// Hash password before save
DonorSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

// Generate referral code
DonorSchema.pre('save', function(next) {
  if (!this.referralCode) {
    this.referralCode = 'JM' + Math.random().toString(36).slice(2,8).toUpperCase();
  }
  next();
});

DonorSchema.methods.comparePassword = async function(pwd) {
  return bcrypt.compare(pwd, this.password);
};

DonorSchema.methods.isEligibleToDonate = function() {
  return !this.nextEligibleDate || new Date() >= this.nextEligibleDate;
};

DonorSchema.methods.addPoints = function(amount) {
  this.points += amount;
};

DonorSchema.methods.deductPoints = function(amount) {
  this.points = Math.max(0, this.points - amount);
};

DonorSchema.index({ phone: 1 });
DonorSchema.index({ bloodGroup: 1, city: 1 });
DonorSchema.index({ referralCode: 1 });

module.exports = mongoose.model('Donor', DonorSchema);
