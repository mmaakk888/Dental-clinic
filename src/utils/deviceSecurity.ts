export interface PendingApprovalRequest {
  id: string;
  requestedBy: {
    userId: string;
    userName: string;
    role: string;
  };
  actionType: 'DELETE_PATIENT' | 'DELETE_SESSION' | 'DELETE_EXPENSE' | 'FINANCIAL_DISCOUNT_OVERRIDE' | 'MODIFY_SETTINGS';
  details: string;
  entityId: string;
  payload: any;
  createdAt: string;
  status: 'pending' | 'approved' | 'rejected';
  doctorNote?: string;
  processedAt?: string;
}

export interface ApprovedDevice {
  id: string;
  deviceName: string;
  browser: string;
  lastUsedAt: string;
  isApproved: boolean;
  ipAddress?: string;
}

const APPROVAL_QUEUE_KEY = 'dental_clinic_approval_queue';
const APPROVED_DEVICES_KEY = 'dental_clinic_approved_devices';

export const DeviceSecurity = {
  // Pending Doctor Approval Queue
  getApprovalRequests(): PendingApprovalRequest[] {
    try {
      const raw = localStorage.getItem(APPROVAL_QUEUE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  },

  saveApprovalRequests(requests: PendingApprovalRequest[]): void {
    try {
      localStorage.setItem(APPROVAL_QUEUE_KEY, JSON.stringify(requests));
    } catch (e) {
      console.error('Failed to save approval queue:', e);
    }
  },

  submitApprovalRequest(
    user: { id: string; name: string; role: string },
    actionType: PendingApprovalRequest['actionType'],
    details: string,
    entityId: string,
    payload: any
  ): PendingApprovalRequest {
    const queue = this.getApprovalRequests();
    const req: PendingApprovalRequest = {
      id: 'req_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      requestedBy: {
        userId: user.id,
        userName: user.name,
        role: user.role,
      },
      actionType,
      details,
      entityId,
      payload,
      createdAt: new Date().toLocaleString('ar-EG'),
      status: 'pending',
    };
    queue.unshift(req);
    this.saveApprovalRequests(queue);
    return req;
  },

  processApprovalRequest(id: string, approve: boolean, doctorNote?: string): PendingApprovalRequest | null {
    const queue = this.getApprovalRequests();
    const target = queue.find(q => q.id === id);
    if (!target) return null;

    target.status = approve ? 'approved' : 'rejected';
    target.doctorNote = doctorNote;
    target.processedAt = new Date().toLocaleString('ar-EG');

    this.saveApprovalRequests(queue);
    return target;
  },

  // Approved Devices
  getApprovedDevices(): ApprovedDevice[] {
    try {
      const raw = localStorage.getItem(APPROVED_DEVICES_KEY);
      if (raw) return JSON.parse(raw);

      // Register current device if empty
      const currentDevice: ApprovedDevice = {
        id: 'dev_primary',
        deviceName: 'الجهاز الرئيسي للعيادة',
        browser: navigator.userAgent.includes('Mobile') ? 'هاتف محمول / تاب' : 'كمبيوتر المكتب',
        lastUsedAt: new Date().toLocaleString('ar-EG'),
        isApproved: true,
      };
      this.saveApprovedDevices([currentDevice]);
      return [currentDevice];
    } catch {
      return [];
    }
  },

  saveApprovedDevices(devices: ApprovedDevice[]): void {
    try {
      localStorage.setItem(APPROVED_DEVICES_KEY, JSON.stringify(devices));
    } catch (e) {
      console.error('Failed to save approved devices:', e);
    }
  },

  registerCurrentDevice(): ApprovedDevice {
    const devices = this.getApprovedDevices();
    const existing = devices.find(d => d.id === 'dev_current');
    if (existing) {
      existing.lastUsedAt = new Date().toLocaleString('ar-EG');
      this.saveApprovedDevices(devices);
      return existing;
    }

    const newDevice: ApprovedDevice = {
      id: 'dev_' + Date.now(),
      deviceName: 'جهاز جديد ' + (devices.length + 1),
      browser: navigator.userAgent.includes('Mobile') ? 'جوال العيادة' : 'متصفح الكومبيوتر',
      lastUsedAt: new Date().toLocaleString('ar-EG'),
      isApproved: true,
    };
    devices.push(newDevice);
    this.saveApprovedDevices(devices);
    return newDevice;
  },
};
