const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// ── ALERT ──────────────────────────────────────────────────
const AlertSchema = new mongoose.Schema({
  requestId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Request', required: true },
  donorId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Donor', required: true },
  donorPhone:   { type: String, required: true },
  bloodGroup:   { type: String, required: true },
  hospitalName: { type: String, required: true },
  urgency:      { type: String, required: true },
  status:       { type: String, enum: ['sent','delivered','seen','accepted','declined','expired'], default: 'sent' },
  sentAt:       { type: Date, default: Date.now },
  deliveredAt:  { type: Date },
  seenAt:       { type: Date },
  respondedAt:  { type: Date },
});
AlertSchema.index({ donorId: 1 });
AlertSchema.index({ requestId: 1 });
AlertSchema.index({ status: 1 });
const Alert = mongoose.model('Alert', AlertSchema);

// ── ADMIN ──────────────────────────────────────────────────
const AdminSchema = new mongoose.Schema({
  name:      { type: String, required: true },
  email:     { type: String, required: true, unique: true },
  password:  { type: String, required: true },
  role:      { type: String, enum: ['super_admin','moderator'], default: 'moderator' },
  isActive:  { type: Boolean, default: true },
  lastLogin: { type: Date },
}, { timestamps: true });

AdminSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});
AdminSchema.methods.comparePassword = async function(pwd) {
  return bcrypt.compare(pwd, this.password);
};
const Admin = mongoose.model('Admin', AdminSchema);

// ── SYSTEM LOG ─────────────────────────────────────────────
const LogSchema = new mongoose.Schema({
  adminId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  adminEmail: { type: String },
  action:     { type: String, required: true },
  target:     { type: String, enum: ['donor','hospital','request','admin'] },
  targetId:   { type: mongoose.Schema.Types.ObjectId },
  details:    { type: String },
  ipAddress:  { type: String },
}, { timestamps: true });
LogSchema.index({ adminId: 1 });
LogSchema.index({ createdAt: -1 });
const SystemLog = mongoose.model('SystemLog', LogSchema);

module.exports = { Alert, Admin, SystemLog };
