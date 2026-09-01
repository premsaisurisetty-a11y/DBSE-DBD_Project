const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authMiddleware');
const { authorize } = require('../middleware/roleMiddleware');
const { getAllSales, getSaleById, createSale } = require('../controllers/salesController');

router.use(authenticate);
router.get('/', getAllSales);
router.get('/:id', getSaleById);
router.post('/', authorize('MERCHANT'), createSale);

module.exports = router;
