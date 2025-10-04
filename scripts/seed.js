require('dotenv').config();
const bcrypt = require('bcryptjs');
const { query } = require('../src/config/db');

async function seed() {
  // Clear tables (optional) - comment out in production
  // await query('DELETE FROM receipts');
  // await query('DELETE FROM expenses');
  // await query('DELETE FROM approval_rules');
  // await query('DELETE FROM employee_managers');
  // await query('DELETE FROM users');

  const [existingAdmin] = await query(`SELECT id FROM users WHERE email = ?`, ['admin@example.com']);
  if (!existingAdmin) {
    const adminHash = await bcrypt.hash('admin123', 10);
    await query(`INSERT INTO users (name, email, password_hash, role) VALUES ('Alice Admin', 'admin@example.com', ?, 'ADMIN')`, [adminHash]);
  }

  const [existingManager] = await query(`SELECT id, email FROM users WHERE email = ?`, ['manager@example.com']);
  let managerId;
  if (!existingManager) {
    const managerHash = await bcrypt.hash('manager123', 10);
    const result = await query(`INSERT INTO users (name, email, password_hash, role) VALUES ('Mark Manager', 'manager@example.com', ?, 'MANAGER')`, [managerHash]);
    managerId = result.insertId;
  } else {
    managerId = existingManager.id;
  }

  // Employees
  const employees = [
    { name: 'Eve Employee', email: 'employee1@example.com' },
    { name: 'Erin Employee', email: 'employee2@example.com' }
  ];

  for (const emp of employees) {
    const [existingEmp] = await query(`SELECT id FROM users WHERE email = ?`, [emp.email]);
    let empId;
    if (!existingEmp) {
      const hash = await bcrypt.hash('employee123', 10);
      const res = await query(`INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'EMPLOYEE')`, [emp.name, emp.email, hash]);
      empId = res.insertId;
    } else {
      empId = existingEmp.id;
    }

    const [assigned] = await query(`SELECT id FROM employee_managers WHERE employee_id = ?`, [empId]);
    if (!assigned) {
      await query(`INSERT INTO employee_managers (employee_id, manager_id) VALUES (?, ?)`, [empId, managerId]);
    }
  }

  // Rules
  const defaults = await query(`SELECT id FROM approval_rules WHERE manager_id = ? AND employee_id IS NULL AND category IS NULL`, [managerId]);
  if (!defaults.length) {
    await query(`INSERT INTO approval_rules (manager_id, category, employee_id, max_amount) VALUES (?, NULL, NULL, 50000)`, [managerId]);
  }
  const travelRule = await query(`SELECT id FROM approval_rules WHERE manager_id = ? AND category = 'TRAVEL' AND employee_id IS NULL`, [managerId]);
  if (!travelRule.length) {
    await query(`INSERT INTO approval_rules (manager_id, category, employee_id, max_amount) VALUES (?, 'TRAVEL', NULL, 30000)`, [managerId]);
  }
  // Employee-specific tighter limit for second employee
  const [emp2] = await query(`SELECT u.id FROM users u WHERE u.email = ?`, ['employee2@example.com']);
  if (emp2) {
    const empRule = await query(`SELECT id FROM approval_rules WHERE manager_id = ? AND employee_id = ?`, [managerId, emp2.id]);
    if (!empRule.length) {
      await query(`INSERT INTO approval_rules (manager_id, category, employee_id, max_amount) VALUES (?, NULL, ?, 20000)`, [managerId, emp2.id]);
    }
  }

  console.log('Seeding completed');
}

seed().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
