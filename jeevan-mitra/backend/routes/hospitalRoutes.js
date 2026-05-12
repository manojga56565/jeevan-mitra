// POST a new blood request (Fully Synced with your Model)
router.post(['/', '/requests', '/request', '/create'], auth('hospital'), async (req, res) => {
  try {
    // 1. Fetch Hospital details for the required model fields
    const hospital = await Hospital.findById(req.user.id);
    if (!hospital) return res.status(404).json({ success: false, message: 'Hospital not found' });

    // 2. Create the request using your specific Model fields
    const newRequest = new Request({
      hospitalId: hospital._id,
      hospitalName: hospital.hospitalName,
      hospitalCity: hospital.city,
      hospitalPhone: hospital.phone,
      bloodGroup: req.body.bloodGroup || req.body.bloodGroupRequired,
      urgency: req.body.urgencyLevel || req.body.urgency || 'normal',
      quantity: req.body.units || req.body.unitsRequired || 1, // Matches your 'quantity' field
      patientName: req.body.patientName || '',
      patientReason: req.body.notes || '', // Mapping 'notes' to 'patientReason'
      doctorRefNo: req.body.doctorRefNo || '',
      // patientAge and patientGender are optional in your model
    });

    await newRequest.save();

    // 3. THE MATCHING ENGINE
    const matchingDonors = await Donor.find({
      bloodGroup: newRequest.bloodGroup,
      city: hospital.city, // Now matching by city too!
      isActive: true,
      availabilityStatus: 'available'
    });

    if (matchingDonors.length > 0) {
      const alerts = matchingDonors.map(donor => ({
        donorId: donor._id,
        requestId: newRequest._id,
        status: 'pending'
      }));
      await Alert.insertMany(alerts);
    }

    // 4. Real-time Socket Trigger
    const io = req.app.get('io');
    if (io) {
      matchingDonors.forEach(donor => {
        io.to(`donor_${donor._id}`).emit('new_alert', { request: newRequest });
      });
    }

    res.status(201).json({ 
      success: true, 
      message: 'Blood request posted and donors alerted!', 
      request: newRequest 
    });
  } catch (err) {
    console.error("Critical Route Error:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});