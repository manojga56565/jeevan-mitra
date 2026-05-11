const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const HospitalSchema = new mongoose.Schema({
  hospitalName:       { type: String, required: true, trim: true },
  registrationNumber: { type: String, required: true, unique: true },
  address:            { type: String, required: true },
  city:               { type: String, required: true },
  pincode:            { type: String, required: true },
  contactPerson:      { type: String, required: true },
  designation:        { type: String },
  phone:              { type: String, required: true },
  email:              { type: String, required: true, unique: true, lowercase: true },
  licenseDocument:    { type: String },
  isVerified:         { type: Boolean, default: false },
  isActive:           { type: Boolean, default: true },
  password:           { type: String, required: true },
  totalRequests:      { type: Number, default: 0 },
  fulfilledRequests:  { type: Number, default: 0 },
  averageResponseTime:{ type: Number, default: 0 },
}, { timestamps: true });

HospitalSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

HospitalSchema.methods.comparePassword = async function(pwd) {
  return bcrypt.compare(pwd, this.password);
};

HospitalSchema.index({ email: 1 });
HospitalSchema.index({ registrationNumber: 1 });
HospitalSchema.index({ city: 1 });

module.exports = mongoose.model('Hospital', HospitalSchema);
