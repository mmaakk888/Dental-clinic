import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  getDocs,
  getDoc,
  deleteDoc,
  query,
  orderBy
} from 'firebase/firestore';
import firebaseConfigData from '../../firebase-applet-config.json';

export interface FirebaseBackupMeta {
  id: string;
  timestamp: string;
  clinicName: string;
  patientCount: number;
  appointmentCount: number;
  expenseCount: number;
  labCaseCount: number;
  uploadedBy?: string;
  data?: any;
}

const firebaseConfig = {
  apiKey: firebaseConfigData.apiKey,
  authDomain: firebaseConfigData.authDomain,
  projectId: firebaseConfigData.projectId,
  storageBucket: firebaseConfigData.storageBucket,
  messagingSenderId: firebaseConfigData.messagingSenderId,
  appId: firebaseConfigData.appId
};

// Initialize Firebase App
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

// Initialize Firestore with specific database ID if available
export const db = getFirestore(
  app,
  firebaseConfigData.firestoreDatabaseId && firebaseConfigData.firestoreDatabaseId !== ''
    ? firebaseConfigData.firestoreDatabaseId
    : '(default)'
);

// Upload current local state to Firebase Firestore
export async function saveBackupToFirebase(fullData: any, clinicName: string): Promise<FirebaseBackupMeta> {
  const backupId = `backup_${Date.now()}`;
  const now = new Date();
  const timestampStr = `${now.toLocaleDateString('ar-EG')} - ${now.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}`;

  const meta: FirebaseBackupMeta = {
    id: backupId,
    timestamp: timestampStr,
    clinicName: clinicName || 'عيادة الأسنان',
    patientCount: Array.isArray(fullData.patients) ? fullData.patients.length : 0,
    appointmentCount: Array.isArray(fullData.appointments) ? fullData.appointments.length : 0,
    expenseCount: Array.isArray(fullData.expenses) ? fullData.expenses.length : 0,
    labCaseCount: Array.isArray(fullData.labCases) ? fullData.labCases.length : 0,
    uploadedBy: 'طبيب العيادة (مدير النظام)',
    data: fullData
  };

  const backupRef = doc(collection(db, 'backups'), backupId);
  await setDoc(backupRef, meta);

  return meta;
}

// Fetch list of cloud backups from Firestore
export async function fetchFirebaseBackups(): Promise<FirebaseBackupMeta[]> {
  const backupsCol = collection(db, 'backups');
  const q = query(backupsCol, orderBy('id', 'desc'));
  const snapshot = await getDocs(q);

  const list: FirebaseBackupMeta[] = [];
  snapshot.forEach(docSnap => {
    const data = docSnap.data() as FirebaseBackupMeta;
    list.push({
      id: docSnap.id,
      timestamp: data.timestamp,
      clinicName: data.clinicName,
      patientCount: data.patientCount || 0,
      appointmentCount: data.appointmentCount || 0,
      expenseCount: data.expenseCount || 0,
      labCaseCount: data.labCaseCount || 0,
      uploadedBy: data.uploadedBy || 'مدير العيادة',
      data: data.data
    });
  });

  return list;
}

// Get single backup full data by ID
export async function fetchSingleFirebaseBackup(backupId: string): Promise<any | null> {
  const backupRef = doc(db, 'backups', backupId);
  const snap = await getDoc(backupRef);
  if (snap.exists()) {
    return snap.data().data;
  }
  return null;
}

// Delete backup from Firestore
export async function removeFirebaseBackup(backupId: string): Promise<void> {
  const backupRef = doc(db, 'backups', backupId);
  await deleteDoc(backupRef);
}
