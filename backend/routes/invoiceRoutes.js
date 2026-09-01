const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authMiddleware');
const { getAllInvoices, getInvoiceById } = require('../controllers/invoiceController');

router.use(authenticate);
router.get('/', getAllInvoices);
router.get('/:id', getInvoiceById);

module.exports = router;
