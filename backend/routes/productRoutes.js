const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authMiddleware');
const { authorize } = require('../middleware/roleMiddleware');
const {
  getAllProducts, createProduct, updateProduct, deleteProduct,
  getProductQuality, addProductQuality
} = require('../controllers/productController');

router.use(authenticate);
router.get('/', getAllProducts);
router.post('/', authorize('ADMIN'), createProduct);
router.put('/:id', authorize('ADMIN'), updateProduct);
router.delete('/:id', authorize('ADMIN'), deleteProduct);
router.get('/:id/quality', getProductQuality);
router.post('/:id/quality', addProductQuality);

module.exports = router;
