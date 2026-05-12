// PUT /api/admin/hospitals/:id/verify
router.put('/hospitals/:id/verify', auth('admin'), async (req, res) => {
  try {
    const { action } = req.body; // Expects 'approve' or 'reject'
    const hospital = await Hospital.findById(req.params.id);
    
    if (!hospital) return res.status(404).json({ success: false, message: 'Hospital not found' });

    if (action === 'approve') {
      hospital.isVerified = true;
      await hospital.save();
      return res.json({ success: true, message: 'Hospital verified and approved.' });
    } else if (action === 'reject') {
      await Hospital.findByIdAndDelete(req.params.id);
      return res.json({ success: true, message: 'Hospital rejected and removed.' });
    }
    
    res.status(400).json({ success: false, message: 'Invalid action.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});