const { query } = require('../config/db');

async function getAssignedManagerIdForEmployee(employeeId) {
  const rows = await query(
    `SELECT manager_id FROM employee_managers WHERE employee_id = ? LIMIT 1`,
    [employeeId]
  );
  return rows.length ? rows[0].manager_id : null;
}

async function evaluateExpenseAgainstRules({ managerId, employeeId, amount, category }) {
  // Select most specific matching rule: employee-specific > category-specific > default
  const rules = await query(
    `SELECT id, manager_id, employee_id, category, max_amount
     FROM approval_rules
     WHERE manager_id = ? AND (employee_id = ? OR employee_id IS NULL) AND (category = ? OR category IS NULL)
     ORDER BY (employee_id IS NOT NULL) DESC, (category IS NOT NULL) DESC
     LIMIT 1`,
    [managerId, employeeId, category]
  );

  if (!rules.length) {
    return { allowed: false, reason: 'No matching rule; escalate to admin' };
  }

  const rule = rules[0];
  const allowed = Number(amount) <= Number(rule.max_amount);
  return {
    allowed,
    rule,
    reason: allowed ? 'Within limits' : `Exceeds limit ${rule.max_amount} for rule`
  };
}

module.exports = { getAssignedManagerIdForEmployee, evaluateExpenseAgainstRules };
