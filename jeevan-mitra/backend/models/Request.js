const mongoose = require('mongoose');

const RequestSchema = new mongoose.Schema({
  hospitalId:         { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital', required: true },
  hospitalName:       { type: String, required: true },
  hospitalCity:       { type: String, required: true },
  hospitalPhone:      { type: String, required: true },
  bloodGroup:         { type: String, required: true, enum: ['A+','A-','B+','B-','O+','O-','AB+','AB-'] },
  urgency:            { type: String, enum: ['normal','urgent','emergency'], default: 'normal' },
  quantity:           { type: Number, required: true, min: 1, max: 10 },
  patientName:        { type: String, default: '' },
  patientReason:      { type: String, default: '' },
  doctorRefNo:        { type: String, default: '' },
  status:             { type: String, enum: ['pending','accepted','completed','cancelled','expired'], default: 'pending' },
  acceptedBy:         { type: mongoose.Schema.Types.ObjectId, ref: 'Donor' },
  pointsEarned:       { type: Number, default: 0 },
  expiresAt:          { type: Date, default: () => new Date(Date.now() + 2*60*60*1000) }, 
}, { timestamps: true });

RequestSchema.pre('save', function(next) {
  if (!this.pointsEarned) {
    if (this.urgency === 'emergency') this.pointsEarned = 30;
    else if (this.urgency === 'urgent') this.pointsEarned = 20;
    else this.pointsEarned = 10;
  }
  next();
});

module.exports = mongoose.model('Request', RequestSchema);