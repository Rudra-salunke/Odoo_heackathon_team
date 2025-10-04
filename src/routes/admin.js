const express = require('express');
const Joi = require('joi');
const { query } = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { generateReceiptForExpense } = require('../services/receiptService');

const router = express.Router();

router.use(requireAuth, requireRole('ADMIN'));

router.get('/expenses', async (req, res, next) => {
  try {
    const { status } = req.query;
    let sql = `SELECT e.*, u1.name AS employee_name, u2.name AS manager_name
               FROM expenses e
               JOIN users u1 ON u1.id = e.employee_id
               JOIN users u2 ON u2.id = e.manager_id`;
    const params = [];
    if (status) {
      sql += ' WHERE e.status = ?';
      params.push(status);
    }
    sql += ' ORDER BY e.created_at DESC';
    const rows = await query(sql, params);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

const finalizeSchema = Joi.object({
  action: Joi.string().valid('approve', 'reject').required(),
  comment: Joi.string().max(255).allow('', null)
});

router.post('/expenses/:id/finalize', async (req, res, next) => {
  try {
    const expenseId = Number(req.params.id);
    const { error, value } = finalizeSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.message });

    const [expense] = await query(`SELECT * FROM expenses WHERE id = ?`, [expenseId]);
    if (!expense) return res.status(404).json({ error: 'Expense not found' });

    if (value.action === 'reject') {
      await query(`UPDATE expenses SET status = 'REJECTED', admin_comment = ?, admin_decision_at = NOW() WHERE id = ?`, [value.comment || null, expenseId]);
      return res.json({ id: expenseId, status: 'REJECTED' });
    }

    // Approve and generate receipt
    await query(`UPDATE expenses SET status = 'ADMIN_APPROVED', admin_comment = ?, admin_decision_at = NOW() WHERE id = ?`, [value.comment || null, expenseId]);
    const filePath = await generateReceiptForExpense(expenseId);
    res.json({ id: expenseId, status: 'ADMIN_APPROVED', receipt_path: filePath });
  } catch (err) {
    next(err);
  }
});

// Admin can create/update rules for managers
const upsertRuleSchema = Joi.object({
  managerId: Joi.number().integer().required(),
  category: Joi.string().max(50).allow(null, ''),
  employeeId: Joi.number().integer().allow(null),
  maxAmount: Joi.number().positive().required()
});

router.post('/rules', async (req, res, next) => {
  try {
    const { error, value } = upsertRuleSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.message });

    const { managerId, category, employeeId, maxAmount } = value;
    const result = await query(
      `INSERT INTO approval_rules (manager_id, category, employee_id, max_amount)
       VALUES (?, NULLIF(?, ''), ?, ?)`,
      [managerId, category || null, employeeId || null, maxAmount]
    );
    res.status(201).json({ id: result.insertId });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
