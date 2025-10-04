const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const dayjs = require('dayjs');
const { query } = require('../config/db');

const RECEIPTS_DIR = path.resolve(process.cwd(), 'receipts');

async function ensureReceiptsDir() {
  await fs.promises.mkdir(RECEIPTS_DIR, { recursive: true });
}

async function generateReceiptForExpense(expenseId) {
  const [expense] = await query(
    `SELECT e.id, e.amount, e.category, e.description, e.created_at, e.manager_id, e.employee_id,
            u1.name AS employee_name, u2.name AS manager_name
     FROM expenses e
     JOIN users u1 ON u1.id = e.employee_id
     JOIN users u2 ON u2.id = e.manager_id
     WHERE e.id = ?`,
    [expenseId]
  );

  if (!expense) {
    throw Object.assign(new Error('Expense not found'), { status: 404 });
  }

  await ensureReceiptsDir();

  const filePath = path.join(RECEIPTS_DIR, `expense-${expense.id}.pdf`);
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const stream = fs.createWriteStream(filePath);
  doc.pipe(stream);

  doc.fontSize(20).text('Expense Receipt', { align: 'center' });
  doc.moveDown();

  doc.fontSize(12).text(`Receipt Date: ${dayjs().format('YYYY-MM-DD HH:mm')}`);
  doc.text(`Expense ID: ${expense.id}`);
  doc.text(`Employee: ${expense.employee_name} (ID: ${expense.employee_id})`);
  doc.text(`Manager: ${expense.manager_name} (ID: ${expense.manager_id})`);
  doc.text(`Category: ${expense.category}`);
  doc.text(`Amount: ${Number(expense.amount).toFixed(2)}`);
  doc.text(`Description: ${expense.description || '-'}`);
  doc.moveDown();
  doc.text('Approvals:', { underline: true });
  doc.text('Manager: Approved');
  doc.text('Admin: Approved');
  doc.end();

  await new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });

  // Insert or update receipts table
  await query(
    `INSERT INTO receipts (expense_id, file_path) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE file_path = VALUES(file_path)`,
    [expenseId, filePath]
  );

  // Also store on expense for convenience
  await query(`UPDATE expenses SET receipt_path = ? WHERE id = ?`, [filePath, expenseId]);

  return filePath;
}

module.exports = { generateReceiptForExpense };
