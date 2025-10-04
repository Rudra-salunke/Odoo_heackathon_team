const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Joi = require('joi');
const { query } = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');

const router = express.Router();

const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(6).required()
});

router.post('/login', async (req, res, next) => {
  try {
    const { error, value } = loginSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.message });

    const { email, password } = value;
    const rows = await query(`SELECT id, name, email, password_hash, role FROM users WHERE email = ?`, [email]);
    if (!rows.length) return res.status(401).json({ error: 'Invalid credentials' });

    const user = rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { id: user.id, role: user.role, name: user.name, email: user.email },
      process.env.JWT_SECRET || 'dev_secret',
      { expiresIn: '12h' }
    );
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    next(err);
  }
});

const createUserSchema = Joi.object({
  name: Joi.string().min(2).required(),
  email: Joi.string().email().required(),
  password: Joi.string().min(6).required(),
  role: Joi.string().valid('ADMIN', 'MANAGER', 'EMPLOYEE').required(),
  managerId: Joi.number().integer().optional() // Only for employee assignment
});

router.post('/users', requireAuth, requireRole('ADMIN'), async (req, res, next) => {
  try {
    const { error, value } = createUserSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.message });

    const { name, email, password, role, managerId } = value;
    const existing = await query(`SELECT id FROM users WHERE email = ?`, [email]);
    if (existing.length) return res.status(409).json({ error: 'Email already in use' });

    const password_hash = await bcrypt.hash(password, 10);
    const result = await query(
      `INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)`,
      [name, email, password_hash, role]
    );
    const userId = result.insertId;

    if (role === 'EMPLOYEE') {
      const mgr = managerId || null;
      if (!mgr) {
        return res.status(400).json({ error: 'managerId required for EMPLOYEE' });
      }
      await query(`INSERT INTO employee_managers (employee_id, manager_id) VALUES (?, ?)`, [userId, mgr]);
    }

    res.status(201).json({ id: userId, name, email, role });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
