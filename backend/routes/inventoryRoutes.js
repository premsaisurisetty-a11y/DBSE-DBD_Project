const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authMiddleware');
const { getInventory, getLowStock, addStock } = require('../controllers/inventoryController');

router.use(authenticate);
router.get('/', getInventory);
router.get('/low-stock', getLowStock);
router.post('/stock', addStock);

module.exports = router;
