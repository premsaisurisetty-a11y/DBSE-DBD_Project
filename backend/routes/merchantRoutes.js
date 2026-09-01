const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authMiddleware');
const { authorize } = require('../middleware/roleMiddleware');
const { getAllMerchants, getMerchantById, setMerchantStatus } = require('../controllers/merchantController');

router.use(authenticate);
router.get('/', authorize('ADMIN'), getAllMerchants);
router.get('/:id', authorize('ADMIN'), getMerchantById);
router.put('/:id/status', authorize('ADMIN'), setMerchantStatus);

module.exports = router;
