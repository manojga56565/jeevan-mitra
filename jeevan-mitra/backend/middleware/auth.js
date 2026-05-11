const jwt = require('jsonwebtoken');

// General auth middleware
const auth = (role) => (req, res, next) => {
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : header;
  if (!token) return res.status(401).json({ success: false, message: 'No token provided' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
    req.user = decoded;
    if (role && decoded.role !== role) {
      return res.status(403).json({ success: false, message: `Access denied. Required: ${role}` });
    }
    next();
  } catch (e) {
    res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
};

// Admin auth middleware
const adminAuth = (req, res, next) => {
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : header;
  if (!token) return res.status(401).json({ success: false, message: 'No token provided' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
    if (decoded.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Admin access required' });
    }
    req.user = decoded;
    next();
  } catch (e) {
    res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
};

module.exports = { auth, adminAuth };
