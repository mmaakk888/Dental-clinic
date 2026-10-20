-- MySQL 5.7+ / MariaDB 10.4+, InnoDB, utf8mb4. NO DROP/TRUNCATE or demo records.
CREATE TABLE IF NOT EXISTS dc_meta (id VARCHAR(64) PRIMARY KEY, value_json LONGTEXT NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS dc_users (
 id VARCHAR(128) PRIMARY KEY, username VARCHAR(191) NOT NULL UNIQUE, email VARCHAR(191) NULL,
 password_hash VARCHAR(255) NULL, profile_json LONGTEXT NOT NULL, credential_version INT NOT NULL DEFAULT 1,
 is_active TINYINT NOT NULL DEFAULT 1, created_at VARCHAR(30) NOT NULL,
 INDEX idx_user_email(email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS dc_sessions (
 token_hash CHAR(64) PRIMARY KEY, user_id VARCHAR(128) NOT NULL, credential_version INT NOT NULL,
 expires_at BIGINT NOT NULL, created_at BIGINT NOT NULL,
 FOREIGN KEY(user_id) REFERENCES dc_users(id) ON DELETE CASCADE, INDEX idx_session_expiry(expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS dc_login_limits (bucket CHAR(64) PRIMARY KEY, attempts INT NOT NULL, expires_at BIGINT NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS dc_password_resets (
 token_hash CHAR(64) PRIMARY KEY, user_id VARCHAR(128) NOT NULL, expires_at BIGINT NOT NULL,
 used_at BIGINT NULL, FOREIGN KEY(user_id) REFERENCES dc_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS dc_patients (
 id VARCHAR(128) PRIMARY KEY, file_no VARCHAR(128) COLLATE utf8mb4_bin NOT NULL UNIQUE, name VARCHAR(200) NOT NULL,
 phone VARCHAR(32) NOT NULL DEFAULT '', revision BIGINT NOT NULL DEFAULT 1, payload LONGTEXT NOT NULL,
 archived TINYINT NOT NULL DEFAULT 0, INDEX idx_patient_name(name), INDEX idx_patient_phone(phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS dc_visits (
 id VARCHAR(128) PRIMARY KEY, patient_id VARCHAR(128) NOT NULL, visit_date CHAR(10) NOT NULL,
 total_cents BIGINT NOT NULL, historical_paid_cents BIGINT NOT NULL DEFAULT 0, payload LONGTEXT NOT NULL, archived TINYINT NOT NULL DEFAULT 0,
 FOREIGN KEY(patient_id) REFERENCES dc_patients(id), INDEX idx_visit_patient(patient_id,visit_date), INDEX idx_visit_date(visit_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS dc_receipts (
 id VARCHAR(128) PRIMARY KEY, patient_id VARCHAR(128) NOT NULL, visit_id VARCHAR(128) NULL,
 amount_cents BIGINT NOT NULL, paid_date CHAR(10) NOT NULL, payload LONGTEXT NOT NULL,
 FOREIGN KEY(patient_id) REFERENCES dc_patients(id), FOREIGN KEY(visit_id) REFERENCES dc_visits(id),
 INDEX idx_receipt_patient(patient_id,paid_date), INDEX idx_receipt_day(paid_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS dc_contacts (
 id VARCHAR(128) PRIMARY KEY, name VARCHAR(200) NOT NULL, phone VARCHAR(32) NOT NULL,
 payload LONGTEXT NOT NULL, archived TINYINT NOT NULL DEFAULT 0,
 INDEX idx_contact_phone(phone), INDEX idx_contact_name(name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS dc_appointments (
 id VARCHAR(128) PRIMARY KEY, patient_id VARCHAR(128) NULL, appointment_date CHAR(10) NOT NULL,
 start_minute INT NOT NULL, duration_minutes INT NOT NULL, status VARCHAR(24) NOT NULL, payload LONGTEXT NOT NULL,
 FOREIGN KEY(patient_id) REFERENCES dc_patients(id), INDEX idx_appt_day(appointment_date,start_minute), INDEX idx_appt_patient(patient_id,appointment_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS dc_labs (id VARCHAR(128) PRIMARY KEY, name VARCHAR(191) NOT NULL, payload LONGTEXT NOT NULL, archived TINYINT NOT NULL DEFAULT 0) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS dc_lab_cases (
 id VARCHAR(128) PRIMARY KEY, patient_id VARCHAR(128) NOT NULL, visit_id VARCHAR(128) NULL, lab_id VARCHAR(128) NOT NULL,
 total_cost_cents BIGINT NOT NULL, payload LONGTEXT NOT NULL,
 FOREIGN KEY(patient_id) REFERENCES dc_patients(id), FOREIGN KEY(visit_id) REFERENCES dc_visits(id), FOREIGN KEY(lab_id) REFERENCES dc_labs(id),
 INDEX idx_case_patient(patient_id), INDEX idx_case_lab(lab_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS dc_lab_payments (
 id VARCHAR(128) PRIMARY KEY, lab_id VARCHAR(128) NOT NULL, amount_cents BIGINT NOT NULL, paid_date CHAR(10) NOT NULL, payload LONGTEXT NOT NULL,
 FOREIGN KEY(lab_id) REFERENCES dc_labs(id), INDEX idx_lab_payment_date(lab_id,paid_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS dc_lab_allocations (
 payment_id VARCHAR(128) NOT NULL, case_id VARCHAR(128) NOT NULL, amount_cents BIGINT NOT NULL,
 PRIMARY KEY(payment_id,case_id), FOREIGN KEY(payment_id) REFERENCES dc_lab_payments(id), FOREIGN KEY(case_id) REFERENCES dc_lab_cases(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS dc_expenses (
 id VARCHAR(128) PRIMARY KEY, expense_date CHAR(10) NOT NULL, category VARCHAR(32) NOT NULL,
 total_cents BIGINT NOT NULL, paid_cents BIGINT NOT NULL, payload LONGTEXT NOT NULL, archived TINYINT NOT NULL DEFAULT 0,
 INDEX idx_expense_date(expense_date,category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS dc_expense_items (
 id VARCHAR(128) PRIMARY KEY, expense_id VARCHAR(128) NOT NULL, material_key VARCHAR(191) NOT NULL,
 quantity_milli BIGINT NOT NULL, total_cents BIGINT NOT NULL, payload LONGTEXT NOT NULL,
 FOREIGN KEY(expense_id) REFERENCES dc_expenses(id), INDEX idx_material_purchase(material_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS dc_expense_payments (
 id VARCHAR(128) PRIMARY KEY, expense_id VARCHAR(128) NOT NULL, amount_cents BIGINT NOT NULL,
 paid_date CHAR(10) NOT NULL, payload LONGTEXT NOT NULL,
 FOREIGN KEY(expense_id) REFERENCES dc_expenses(id), INDEX idx_expense_payment_day(expense_id,paid_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS dc_material_usages (
 id VARCHAR(128) PRIMARY KEY, material_key VARCHAR(191) NOT NULL, usage_date CHAR(10) NOT NULL,
 quantity_milli BIGINT NOT NULL, cost_cents BIGINT NOT NULL, payload LONGTEXT NOT NULL, archived TINYINT NOT NULL DEFAULT 0,
 INDEX idx_material_usage(material_key,usage_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS dc_files (
 id VARCHAR(128) PRIMARY KEY, owner_kind VARCHAR(24) NOT NULL, owner_id VARCHAR(128) NOT NULL,
 mime VARCHAR(40) NOT NULL, byte_length INT NOT NULL, sha256 CHAR(64) NOT NULL, content MEDIUMBLOB NOT NULL,
 INDEX idx_file_owner(owner_kind,owner_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS dc_operations (
 id CHAR(36) PRIMARY KEY, actor_id VARCHAR(128) NOT NULL, action VARCHAR(64) NOT NULL,
 request_hash CHAR(64) NOT NULL, result_json LONGTEXT NOT NULL, created_at VARCHAR(30) NOT NULL,
 INDEX idx_operation_actor(actor_id,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS dc_audit (
 id VARCHAR(128) PRIMARY KEY, actor_id VARCHAR(128) NOT NULL, action VARCHAR(64) NOT NULL,
 entity_id VARCHAR(128) NOT NULL, created_at VARCHAR(30) NOT NULL, details_json LONGTEXT NOT NULL,
 INDEX idx_audit_date(created_at), INDEX idx_audit_actor(actor_id,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS dc_import_sources (source_key VARCHAR(191) PRIMARY KEY, source_hash CHAR(64) NOT NULL, imported_at VARCHAR(30) NOT NULL, details_json LONGTEXT NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
