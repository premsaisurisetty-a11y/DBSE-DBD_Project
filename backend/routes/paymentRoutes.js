const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authMiddleware');
const { getAllPayments, createPayment } = require('../controllers/paymentController');
const { createCashfreeOrder, verifyCashfreeOrder } = require('../controllers/cashfreeController');

router.use(authenticate);
router.get('/', getAllPayments);
router.post('/', createPayment);
router.post('/cashfree/create-order', createCashfreeOrder);
router.post('/cashfree/verify-order', verifyCashfreeOrder);

module.exports = router;

