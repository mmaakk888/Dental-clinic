import React from 'react';
import { Home, Users, ContactRound, CalendarDays, WalletCards, Crown, Settings2 } from 'lucide-react';
import { ActiveView, User, Appointment, LabCase, UILabels } from '../../types';
import { getDeviceNavigationOrder, getNavigationItems } from '../../utils/clinicContent';
import { canAccessView } from '../../utils/rbac';
import { getDesktopDockAppearance, getDockAppearance } from '../../utils/dockAppearance';
import { ClinicDock } from './ClinicDock';

interface Props {
  activeView: ActiveView; labels: UILabels; tileOrder: string[]; currentUser: User | null;
  appointments?: Appointment[]; labCases?: LabCase[];
  onNavigate(view: ActiveView): void;
}
const navigationIcons = { home: Home, patients: Users, contacts: ContactRound, appointments: CalendarDays, lab: Crown, summary: WalletCards, settings: Settings2 };

export const MobileBottomNav = React.memo(({ activeView, labels, tileOrder, currentUser, onNavigate }: Props) => {
  const items = getNavigationItems(labels, tileOrder).filter(item => canAccessView(currentUser, item.key))
    .map(item => ({ ...item, icon: navigationIcons[item.key] }));
  const desktopItems = getNavigationItems(labels, getDeviceNavigationOrder(labels, tileOrder, 'desktop'))
    .filter(item => canAccessView(currentUser, item.key)).map(item => ({ ...item, icon: navigationIcons[item.key] }));
  const selected = activeView === 'patient-file' ? 'patients' : activeView === 'lab-detail' ? 'lab' : activeView === 'secretary-desk' ? 'home' : activeView;
  if (!currentUser) return null;
  return <ClinicDock items={items} desktopItems={desktopItems} appearance={getDockAppearance(labels)}
    desktopAppearance={getDesktopDockAppearance(labels)} selected={selected} onNavigate={key => {
      const target = items.find(item => item.key === key) ?? desktopItems.find(item => item.key === key);
      if (target) onNavigate(target.key);
    }} />;
});
MobileBottomNav.displayName = 'MobileBottomNav';

