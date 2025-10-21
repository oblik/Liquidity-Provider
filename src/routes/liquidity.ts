import express from 'express';
import {
  createLiquidityPosition,
  getLiquidityPosition,
  updateBankAccount,
  getTransactionHistory,
  getWalletAddresses,
  initiateWithdrawal,
  getSupportedBanks,
  verifyBankAccount,
  refreshBalances,
  requestSettlement,
  getSettlementStatus,
  handleSettlementWebhook
} from '../controllers/liquidityController';
import { protect } from '../middleware/auth';
import { body, validationResult } from 'express-validator';

const router = express.Router();

// Validation middleware
const handleValidationErrors = (req: express.Request, res: express.Response, next: express.NextFunction): void => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
    return; // Ensure function exits after sending response
  }
  next();
};

// Bank account validation - ✅ FIXED: Bank code is 6 digits
const validateBankAccount = [
  body('bankAccount.accountNumber')
    .isLength({ min: 10, max: 10 })
    .withMessage('Account number must be exactly 10 digits')
    .isNumeric()
    .withMessage('Account number must contain only numbers'),

  body('bankAccount.bankCode')
    .isLength({ min: 6, max: 6 })  // ✅ FIXED: Changed from 3 to 6 digits
    .withMessage('Bank code must be exactly 6 digits')
    .isNumeric()
    .withMessage('Bank code must contain only numbers'),

  body('bankAccount.bankName')
    .isLength({ min: 2, max: 50 })
    .withMessage('Bank name must be between 2 and 50 characters')
    .trim(),

  body('bankAccount.accountName')
    .isLength({ min: 2, max: 50 })
    .withMessage('Account name must be between 2 and 50 characters')
    .trim()
];

// Withdrawal validation - ✅ UPDATED: Lower minimum to 0.5 USDC
const validateWithdrawal = [
  body('network')
    .isIn(['base', 'solana'])
    .withMessage('Network must be either "base" or "solana"'),

  body('amount')
    .isFloat({ min: 0.5 })  // ✅ CHANGED: From 10 to 0.5 USDC minimum
    .withMessage('Amount must be at least 0.5 USDC'),

  body('destinationAddress')
    .notEmpty()
    .withMessage('Destination address is required')
    .isLength({ min: 20 })
    .withMessage('Invalid destination address format')
];

/**
 * @swagger
 * /api/liquidity/create:
 *   post:
 *     summary: Create liquidity position
 *     tags: [Liquidity]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - bankAccount
 *             properties:
 *               liquidityType:
 *                 type: string
 *                 enum: [onramp, offramp]
 *                 default: onramp
 *                 example: onramp
 *               bankAccount:
 *                 type: object
 *                 required:
 *                   - accountNumber
 *                   - bankCode
 *                   - bankName
 *                   - accountName
 *                 properties:
 *                   accountNumber:
 *                     type: string
 *                     example: "1234567890"
 *                     description: 10-digit Nigerian bank account number
 *                   bankCode:
 *                     type: string
 *                     example: "000013"
 *                     description: 6-digit bank code (Updated from 3 to 6 digits)
 *                   bankName:
 *                     type: string
 *                     example: "Guaranty Trust Bank"
 *                   accountName:
 *                     type: string
 *                     example: "John Doe"
 *     responses:
 *       201:
 *         description: Liquidity position created successfully
 *       400:
 *         description: Validation error or user already has position
 *       401:
 *         description: Unauthorized
 */
router.post('/create', protect, validateBankAccount, handleValidationErrors, createLiquidityPosition);

/**
 * @swagger
 * /api/liquidity/position:
 *   get:
 *     summary: Get user's liquidity position
 *     tags: [Liquidity]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Liquidity position retrieved successfully
 *       404:
 *         description: No liquidity position found
 *       401:
 *         description: Unauthorized
 */
router.get('/position', protect, getLiquidityPosition);

/**
 * @swagger
 * /api/liquidity/wallets:
 *   get:
 *     summary: Get wallet addresses for funding
 *     tags: [Liquidity]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Wallet addresses retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     networks:
 *                       type: object
 *                       properties:
 *                         base:
 *                           type: object
 *                           properties:
 *                             address:
 *                               type: string
 *                             network:
 *                               type: string
 *                             token:
 *                               type: string
 *                             currentBalance:
 *                               type: number
 *       401:
 *         description: Unauthorized
 */
router.get('/wallets', protect, getWalletAddresses);

/**
 * @swagger
 * /api/liquidity/bank-account:
 *   put:
 *     summary: Update bank account details
 *     tags: [Liquidity]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - bankAccount
 *             properties:
 *               bankAccount:
 *                 type: object
 *                 properties:
 *                   accountNumber:
 *                     type: string
 *                   bankCode:
 *                     type: string
 *                   bankName:
 *                     type: string
 *                   accountName:
 *                     type: string
 *     responses:
 *       200:
 *         description: Bank account updated successfully
 *       400:
 *         description: Validation error
 *       404:
 *         description: No liquidity position found
 */
router.put('/bank-account', protect, validateBankAccount, handleValidationErrors, updateBankAccount);

/**
 * @swagger
 * /api/liquidity/withdraw:
 *   post:
 *     summary: Initiate gasless withdrawal
 *     tags: [Liquidity]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - network
 *               - amount
 *               - destinationAddress
 *             properties:
 *               network:
 *                 type: string
 *                 enum: [base, solana]
 *                 example: base
 *               amount:
 *                 type: number
 *                 minimum: 10
 *                 example: 100
 *                 description: Amount in USDC
 *               destinationAddress:
 *                 type: string
 *                 example: "0x742d35Cc6634C0532925a3b8D33aa42D8c8b0CeF"
 *                 description: Destination wallet address
 *     responses:
 *       202:
 *         description: Withdrawal initiated successfully
 *       400:
 *         description: Insufficient balance or validation error
 *       404:
 *         description: No liquidity position found
 */
router.post('/withdraw', protect, validateWithdrawal, handleValidationErrors, initiateWithdrawal);

/**
 * @swagger
 * /api/liquidity/transactions:
 *   get:
 *     summary: Get transaction history
 *     tags: [Liquidity]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [deposit, withdrawal]
 *       - in: query
 *         name: network
 *         schema:
 *           type: string
 *           enum: [base, solana]
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, confirmed, failed, cancelled]
 *     responses:
 *       200:
 *         description: Transaction history retrieved successfully
 */
router.get('/transactions', protect, getTransactionHistory);

/**
 * @swagger
 * /api/liquidity/refresh-balances:
 *   post:
 *     summary: Refresh wallet balances from blockchain
 *     tags: [Liquidity]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Balances refreshed successfully
 *       401:
 *         description: Unauthorized
 */
router.post('/refresh-balances', protect, refreshBalances);

/**
 * @swagger
 * /api/liquidity/service-status:
 *   get:
 *     summary: Get gasless service configuration status
 *     tags: [Liquidity]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Service status retrieved successfully
 */
// Ensure these types are imported from express

router.get('/service-status', protect, async (req: express.Request, res: express.Response) => {
  try {
    const gaslessService = (await import('../services/gaslessService')).default;
    const status = gaslessService.getServiceStatus();

    res.status(200).json({
      success: true,
      message: 'Service status retrieved',
      data: status
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get service status',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * @swagger
 * /api/liquidity/banks:
 *   get:
 *     summary: Get supported banks
 *     tags: [Liquidity]
 *     responses:
 *       200:
 *         description: List of supported banks
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     banks:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           code:
 *                             type: string
 *                           name:
 *                             type: string
 */
router.get('/banks', getSupportedBanks);

/**
 * @swagger
 * /api/liquidity/dashboard:
 *   get:
 *     summary: Get liquidity dashboard
 *     tags: [Liquidity]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Dashboard data retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 dashboard:
 *                   type: object
 *                   properties:
 *                     totalLiquidity:
 *                       type: number
 *                     availableLiquidity:
 *                       type: number
 *                     networks:
 *                       type: object
 *       401:
 *         description: Unauthorized
 */
router.get('/dashboard', async (req: express.Request, res: express.Response) => {
  try {
    // For now, return mock dashboard data
    // TODO: Implement real dashboard logic
    const dashboard = {
      totalLiquidity: 1000000,
      availableLiquidity: 950000,
      networks: {
        base: { available: 500000, total: 500000 },
        solana: { available: 300000, total: 300000 },
        ethereum: { available: 150000, total: 200000 }
      }
    };

    res.status(200).json({
      success: true,
      dashboard
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get dashboard',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * @swagger
 * /api/liquidity/verify-account:
 *   post:
 *     summary: Verify bank account details
 *     tags: [Liquidity]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - accountNumber
 *               - bankCode
 *             properties:
 *               accountNumber:
 *                 type: string
 *                 example: "1234567890"
 *               bankCode:
 *                 type: string
 *                 example: "000013"
 *                 description: 6-digit bank code
 *     responses:
 *       200:
 *         description: Bank account verified successfully
 *       400:
 *         description: Invalid account details
 */
router.post('/verify-account', [
  body('accountNumber').isLength({ min: 10, max: 10 }).isNumeric(),
  body('bankCode').isLength({ min: 6, max: 6 }).isNumeric()  // ✅ FIXED: Changed from 3 to 6 digits
], handleValidationErrors, verifyBankAccount);

// ================== SETTLEMENT ROUTES ==================

/**
 * @swagger
 * /api/liquidity/request-settlement:
 *   post:
 *     summary: Request settlement for business order
 *     description: Initiate USDC transfer to customer wallet for completed business order
 *     tags: [Liquidity]
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - orderId
 *               - customerWallet
 *               - amount
 *               - token
 *               - network
 *             properties:
 *               orderId:
 *                 type: string
 *                 example: "OR_1234567890_ABCDEF"
 *               customerWallet:
 *                 type: string
 *                 example: "0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b6"
 *               amount:
 *                 type: number
 *                 example: 100.50
 *               token:
 *                 type: string
 *                 example: "USDC"
 *               network:
 *                 type: string
 *                 example: "base"
 *               businessId:
 *                 type: string
 *                 example: "business_123"
 *               customerEmail:
 *                 type: string
 *                 example: "customer@example.com"
 *     responses:
 *       200:
 *         description: Settlement initiated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 settlementId:
 *                   type: string
 *                   example: "SETTLE_1234567890_ABCDEF"
 *                 status:
 *                   type: string
 *                   example: "initiated"
 *                 transactionHash:
 *                   type: string
 *                   example: "0x1234567890abcdef..."
 *                 estimatedTime:
 *                   type: string
 *                   example: "2-5 minutes"
 *       400:
 *         description: Missing required fields
 *       500:
 *         description: Settlement request failed
 */
router.post('/request-settlement', requestSettlement);

/**
 * @swagger
 * /api/liquidity/settlement-status/{settlementId}:
 *   get:
 *     summary: Check settlement status
 *     description: Get the current status of a settlement request
 *     tags: [Liquidity]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: settlementId
 *         required: true
 *         schema:
 *           type: string
 *         description: Settlement ID
 *         example: "SETTLE_1234567890_ABCDEF"
 *     responses:
 *       200:
 *         description: Settlement status retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 settlementId:
 *                   type: string
 *                 status:
 *                   type: string
 *                   enum: [initiated, processing, completed, failed]
 *                 transactionHash:
 *                   type: string
 *                 confirmations:
 *                   type: number
 *                 blockNumber:
 *                   type: number
 *                 completedAt:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Settlement ID is required
 *       500:
 *         description: Failed to check settlement status
 */
router.get('/settlement-status/:settlementId', getSettlementStatus);

/**
 * @swagger
 * /api/liquidity/settlement-webhook:
 *   post:
 *     summary: Handle settlement completion webhook
 *     description: Webhook endpoint for settlement completion notifications
 *     tags: [Liquidity]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               settlementId:
 *                 type: string
 *               status:
 *                 type: string
 *               transactionHash:
 *                 type: string
 *               confirmations:
 *                 type: number
 *               blockNumber:
 *                 type: number
 *     responses:
 *       200:
 *         description: Webhook processed successfully
 *       500:
 *         description: Failed to process webhook
 */
router.post('/settlement-webhook', handleSettlementWebhook);

export default router;