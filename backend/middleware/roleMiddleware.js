// Usage: authorize('ADMIN') or authorize('ADMIN','MERCHANT')
function authorize(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    // OWNER has full master admin access to all ADMIN routes
    if (req.user.role === 'OWNER' && (allowedRoles.includes('ADMIN') || allowedRoles.includes('OWNER'))) {
      return next();
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Access denied for this role' });
    }

    next();
  };
}

module.exports = { authorize };
