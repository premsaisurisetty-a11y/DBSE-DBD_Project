const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authMiddleware');
const { getAuditLogs } = require('../controllers/auditController');

router.use(authenticate);
router.get('/', getAuditLogs);

module.exports = router;
