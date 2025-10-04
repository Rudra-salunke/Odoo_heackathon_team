require('dotenv').config();
const { query } = require('../src/config/db');

async function migrate() {
  await query(`CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('ADMIN','MANAGER','EMPLOYEE') NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`);

  await query(`CREATE TABLE IF NOT EXISTS employee_managers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    employee_id INT NOT NULL,
    manager_id INT NOT NULL,
    UNIQUE KEY uniq_employee (employee_id),
    INDEX idx_manager (manager_id),
    CONSTRAINT fk_em_employee FOREIGN KEY (employee_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_em_manager FOREIGN KEY (manager_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`);

  await query(`CREATE TABLE IF NOT EXISTS approval_rules (
    id INT AUTO_INCREMENT PRIMARY KEY,
    manager_id INT NOT NULL,
    category VARCHAR(50) NULL,
    employee_id INT NULL,
    max_amount DECIMAL(12,2) NOT NULL,
    INDEX idx_rules_manager (manager_id),
    CONSTRAINT fk_rules_manager FOREIGN KEY (manager_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_rules_employee FOREIGN KEY (employee_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`);

  await query(`CREATE TABLE IF NOT EXISTS expenses (
    id INT AUTO_INCREMENT PRIMARY KEY,
    employee_id INT NOT NULL,
    manager_id INT NOT NULL,
    amount DECIMAL(12,2) NOT NULL,
    category VARCHAR(50) NOT NULL,
    description TEXT NULL,
    status ENUM('PENDING','MANAGER_APPROVED','ADMIN_REVIEW','ADMIN_APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING',
    manager_comment VARCHAR(255) NULL,
    admin_comment VARCHAR(255) NULL,
    receipt_path VARCHAR(255) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    manager_decision_at TIMESTAMP NULL,
    admin_decision_at TIMESTAMP NULL,
    INDEX idx_exp_status (status),
    INDEX idx_exp_manager (manager_id),
    INDEX idx_exp_employee (employee_id),
    CONSTRAINT fk_exp_employee FOREIGN KEY (employee_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_exp_manager FOREIGN KEY (manager_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`);

  await query(`CREATE TABLE IF NOT EXISTS receipts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    expense_id INT NOT NULL UNIQUE,
    file_path VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_receipt_expense FOREIGN KEY (expense_id) REFERENCES expenses(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`);

  console.log('Migration completed');
}

migrate().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
