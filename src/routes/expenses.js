const express = require('express');
const Joi = require('joi');
const fs = require('fs');
const { query } = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { getAssignedManagerIdForEmployee, evaluateExpenseAgainstRules } = require('../services/approvalRulesService');

const router = express.Router();

const submitExpenseSchema = Joi.object({
  amount: Joi.number().positive().max(100000000).required(),
  category: Joi.string().max(50).required(),
  description: Joi.string().allow('', null)
});

router.post('/', requireAuth, requireRole('EMPLOYEE', 'MANAGER'), async (req, res, next) => {
  try {
    const { error, value } = submitExpenseSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.message });

    const { amount, category, description } = value;
    const employeeId = req.user.id;

    const managerId = await getAssignedManagerIdForEmployee(employeeId);
    if (!managerId) {
      return res.status(400).json({ error: 'No manager assigned to employee' });
    }

    const result = await query(
      `INSERT INTO expenses (employee_id, manager_id, amount, category, description, status)
       VALUES (?, ?, ?, ?, ?, 'PENDING')`,
      [employeeId, managerId, amount, category, description || null]
    );

    res.status(201).json({ id: result.insertId, employee_id: employeeId, manager_id: managerId, amount, category, description, status: 'PENDING' });
  } catch (err) {
    next(err);
  }
});

router.get('/my', requireAuth, requireRole('EMPLOYEE', 'MANAGER'), async (req, res, next) => {
  try {
    const rows = await query(
      `SELECT e.* FROM expenses e WHERE e.employee_id = ? ORDER BY e.created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.get('/assigned', requireAuth, requireRole('MANAGER'), async (req, res, next) => {
  try {
    const rows = await query(
      `SELECT e.*,
              u.name AS employee_name
       FROM expenses e
       JOIN users u ON u.id = e.employee_id
       WHERE e.manager_id = ?
       ORDER BY e.created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

const managerDecisionSchema = Joi.object({
  action: Joi.string().valid('approve', 'reject').required(),
  comment: Joi.string().max(255).allow('', null)
});

router.post('/:id/manager/decision', requireAuth, requireRole('MANAGER'), async (req, res, next) => {
  try {
    const expenseId = Number(req.params.id);
    const { error, value } = managerDecisionSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.message });

    const [expense] = await query(`SELECT * FROM expenses WHERE id = ?`, [expenseId]);
    if (!expense) return res.status(404).json({ error: 'Expense not found' });
    if (expense.manager_id !== req.user.id) return res.status(403).json({ error: 'Not your assigned expense' });
    if (!['PENDING', 'ADMIN_REVIEW'].includes(expense.status)) {
      return res.status(400).json({ error: `Cannot act on expense in status ${expense.status}` });
    }

    if (value.action === 'reject') {
      await query(`UPDATE expenses SET status = 'REJECTED', manager_comment = ?, manager_decision_at = NOW() WHERE id = ?`, [value.comment || null, expenseId]);
      return res.json({ id: expenseId, status: 'REJECTED' });
    }

    // Approve path with conditional rules
    const evaluation = await evaluateExpenseAgainstRules({
      managerId: expense.manager_id,
      employeeId: expense.employee_id,
      amount: expense.amount,
      category: expense.category
    });

    if (evaluation.allowed) {
      await query(`UPDATE expenses SET status = 'MANAGER_APPROVED', manager_comment = ?, manager_decision_at = NOW() WHERE id = ?`, [value.comment || null, expenseId]);
      return res.json({ id: expenseId, status: 'MANAGER_APPROVED', rule: evaluation.rule });
    } else {
      await query(`UPDATE expenses SET status = 'ADMIN_REVIEW', manager_comment = ?, manager_decision_at = NOW() WHERE id = ?`, [value.comment || evaluation.reason || null, expenseId]);
      return res.json({ id: expenseId, status: 'ADMIN_REVIEW', reason: evaluation.reason });
    }
  } catch (err) {
    next(err);
  }
});

// Download receipt (employee owner or admin)
router.get('/:id/receipt', requireAuth, requireRole('EMPLOYEE', 'ADMIN'), async (req, res, next) => {
  try {
    const expenseId = Number(req.params.id);
    const [expense] = await query(`SELECT * FROM expenses WHERE id = ?`, [expenseId]);
    if (!expense) return res.status(404).json({ error: 'Expense not found' });

    if (req.user.role !== 'ADMIN' && expense.employee_id !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    if (expense.status !== 'ADMIN_APPROVED' || !expense.receipt_path) {
      return res.status(400).json({ error: 'Receipt not available' });
    }

    const path = expense.receipt_path;
    if (!fs.existsSync(path)) {
      return res.status(404).json({ error: 'Receipt file missing' });
    }

    res.download(path);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
