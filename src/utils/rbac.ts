import { User, ActiveView, UserPermission } from '../types';

export type RBACAction = 
  | 'view_patients'
  | 'add_patient'
  | 'edit_patient'
  | 'delete_patient'
  | 'add_session'
  | 'delete_session'
  | 'view_patient_finance'
  | 'collect_payment'
  | 'register_payment'
  | 'view_remaining_balance'
  | 'view_today_collections'
  | 'edit_payment'
  | 'delete_payment'
  | 'manage_appointments'
  | 'manage_lab'
  | 'view_lab_costs'
  | 'view_summary_reports'
  | 'view_expenses'
  | 'view_profits'
  | 'manage_prices'
  | 'financial_reports'
  | 'access_control_panel'
  | 'manage_users'
  | 'backup_restore'
  | 'print_prescription';

/**
 * Returns default permission preset for a specified role.
 */
export function getDefaultPermissionsForRole(role: 'doctor' | 'secretary' | 'admin'): UserPermission {
  if (role === 'doctor' || role === 'admin') {
    return {
      patientView: true,
      patientEdit: true,
      deletePatients: true,
      patientFinance: true,
      appointments: true,
      lab: true,
      labProfit: true,
      summary: true,
      controlPanel: true,
      registerPayment: true,
      viewRemainingBalance: true,
      viewTodayCollections: true,
      editPayment: true,
      deletePayment: true,
      viewExpenses: true,
      viewProfits: true,
      managePrices: true,
      financialReports: true,
    };
  }

  // Secretary Role Default Presets
  return {
    patientView: true,
    patientEdit: true,
    deletePatients: false,
    patientFinance: true,
    appointments: true,
    lab: true,
    labProfit: false,
    summary: false, // Secretary MUST NOT see full Financial summary
    controlPanel: false,
    registerPayment: true,
    viewRemainingBalance: true,
    viewTodayCollections: true,
    editPayment: false,
    deletePayment: false,
    viewExpenses: false,
    viewProfits: false,
    managePrices: false,
    financialReports: false,
  };
}

/**
 * Checks whether a given user has permission to access a specific view.
 */
export function canAccessView(user: User | null, view: ActiveView): boolean {
  if (!user || user.isActive === false || !['doctor', 'admin', 'secretary'].includes(user.role)) return false;

  // Doctor or Admin has full unrestricted access to everything
  if (user.role === 'doctor' || user.role === 'admin') {
    return true;
  }

  const perms = user.permissions;
  if (!perms || typeof perms !== 'object' || Array.isArray(perms)) return false;

  switch (view) {
    case 'secretary-desk':
      return true; // Collections & Secretary desk
    case 'home':
      return true;
    case 'patients':
    case 'patient-file':
      return perms.patientView === true;
    case 'appointments':
      return perms.appointments === true;
    case 'lab':
    case 'lab-detail':
      return perms.lab === true;
    case 'summary':
      // Only users with summary / viewProfits / financialReports access can view Full Finance
      return perms.summary === true;
    case 'settings':
      return perms.controlPanel === true;
    default:
      return false;
  }
}

/**
 * Checks whether a given user has permission for a specific action.
 */
export function canPerformAction(user: User | null, action: RBACAction): boolean {
  if (!user || user.isActive === false || !['doctor', 'admin', 'secretary'].includes(user.role)) return false;

  // Doctor or Admin can perform all actions
  if (user.role === 'doctor' || user.role === 'admin') {
    return true;
  }

  const perms = user.permissions;
  if (!perms || typeof perms !== 'object' || Array.isArray(perms)) return false;

  switch (action) {
    case 'view_patients':
      return perms.patientView === true;
    case 'add_patient':
    case 'edit_patient':
    case 'add_session':
      return perms.patientEdit === true;
    case 'delete_patient':
    case 'delete_session':
      return perms.deletePatients === true;
    case 'view_patient_finance':
      return perms.patientFinance === true;
    case 'collect_payment':
    case 'register_payment':
      return perms.registerPayment !== undefined ? perms.registerPayment === true : perms.patientFinance === true;
    case 'view_remaining_balance':
      return perms.viewRemainingBalance !== undefined ? perms.viewRemainingBalance === true : perms.patientFinance === true;
    case 'view_today_collections':
      return perms.viewTodayCollections !== undefined ? perms.viewTodayCollections === true : perms.patientFinance === true;
    case 'edit_payment':
      return perms.editPayment === true;
    case 'delete_payment':
      return perms.deletePayment === true;
    case 'manage_appointments':
      return perms.appointments === true;
    case 'manage_lab':
      return perms.lab === true;
    case 'view_lab_costs':
      return perms.labProfit === true;
    case 'view_summary_reports':
      return perms.summary === true;
    case 'view_expenses':
      return perms.viewExpenses !== undefined ? perms.viewExpenses === true : perms.summary === true;
    case 'view_profits':
      return perms.viewProfits !== undefined ? perms.viewProfits === true : perms.summary === true;
    case 'manage_prices':
      return perms.managePrices !== undefined ? perms.managePrices === true : perms.controlPanel === true;
    case 'financial_reports':
      return perms.financialReports !== undefined ? perms.financialReports === true : perms.summary === true;
    case 'access_control_panel':
    case 'manage_users':
    case 'backup_restore':
      return perms.controlPanel === true;
    case 'print_prescription':
      return perms.patientView === true;
    default:
      return false;
  }
}

/**
 * Automatically determines the initial default landing view based on user role and device.
 */
export function getDefaultViewForUser(user: User, isMobile: boolean): ActiveView {
  return 'home';
}
