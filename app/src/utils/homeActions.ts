import type { User } from '../types';
import { canAccessView, canPerformAction } from './rbac';

/** Shared by the dashboard and the dialog mount guards; not server authorization. */
export function getHomeActionAccess(user: User | null) {
  const patients = canAccessView(user, 'patients');
  const payment = patients && canPerformAction(user, 'register_payment');
  return {
    walkIn: payment && canPerformAction(user, 'add_patient') && canPerformAction(user, 'add_session'),
    schedule: patients && canPerformAction(user, 'manage_appointments'),
    payment,
    invoice: canAccessView(user, 'summary') && canPerformAction(user, 'view_expenses'),
    report: patients && canPerformAction(user, 'view_today_collections'),
  };
}
