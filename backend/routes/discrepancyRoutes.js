const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authMiddleware');
const { authorize } = require('../middleware/roleMiddleware');
const {
  getPaymentDiscrepancies, getStockDiscrepancies, getAdminSummary, getMerchantSummary
} = require('../controllers/discrepancyController');

router.use(authenticate);
router.get('/payment', authorize('ADMIN'), getPaymentDiscrepancies);
router.get('/stock', authorize('ADMIN'), getStockDiscrepancies);
router.get('/summary/admin', authorize('ADMIN'), getAdminSummary);
router.get('/summary/merchant', authorize('MERCHANT'), getMerchantSummary);

module.exports = router;
